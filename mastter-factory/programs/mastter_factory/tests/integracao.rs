//! Testes de integração: executam as instruções REAIS do programa em um banco
//! Solana simulado (solana-program-test), com CPIs reais ao SPL Token e ATA.
//!
//! Rodar: `cargo test -p casa_da_moeda --test integracao`

use anchor_lang::prelude::{AccountInfo, Pubkey};
use anchor_lang::solana_program::entrypoint::ProgramResult;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use mastter_factory::errors::CasaError;
use mastter_factory::instructions::InitializePoolParams;
use mastter_factory::state::{DepositRecord, Pool, DEPOSIT_SEED, POOL_SEED, QUOTE_VAULT_SEED, TOKEN_VAULT_SEED};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::instruction::{Instruction, InstructionError};
use solana_sdk::program_option::COption;
use solana_sdk::program_pack::Pack;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::system_instruction;
use solana_sdk::transaction::{Transaction, TransactionError};

const USDC: u64 = 1_000_000;
const TK: u64 = 1_000_000_000;
const P0: u64 = 1_000 * 1_000_000_000; // US$ 0,001 por token
const MAX_SUPPLY: u64 = 1_000_000 * TK; // 1.000.000 tokens → US$ 1.000 na fase 1
const FEE: u16 = 100; // 1%

fn process<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    data: &'d [u8],
) -> ProgramResult {
    // Ajuste de lifetimes exigido pelo entrypoint do Anchor no modo nativo.
    let accounts: &'c [AccountInfo<'c>] = unsafe { std::mem::transmute(accounts) };
    mastter_factory::entry(program_id, accounts, data)
}

struct Env {
    ctx: ProgramTestContext,
    usdc_mint: Keypair,
    token_mint: Keypair,
    admin: Keypair,
    pool: Pubkey,
    token_vault: Pubkey,
    quote_vault: Pubkey,
}

fn err_code(e: CasaError) -> u32 {
    u32::from(e)
}

fn custom_code(r: Result<(), BanksClientError>) -> Option<u32> {
    match r {
        Err(BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(c),
        ))) => Some(c),
        Err(BanksClientError::SimulationError {
            err: TransactionError::InstructionError(_, InstructionError::Custom(c)),
            ..
        }) => Some(c),
        _ => None,
    }
}

impl Env {
    async fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), BanksClientError> {
        let bh = self.ctx.get_new_latest_blockhash().await.unwrap();
        let mut all: Vec<&Keypair> = vec![&self.ctx.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(ixs, Some(&self.ctx.payer.pubkey()), &all, bh);
        self.ctx.banks_client.process_transaction(tx).await
    }

    async fn token_balance(&mut self, addr: Pubkey) -> u64 {
        let acc = self.ctx.banks_client.get_account(addr).await.unwrap().unwrap();
        spl_token::state::Account::unpack(&acc.data).unwrap().amount
    }

    async fn mint_state(&mut self, mint: Pubkey) -> spl_token::state::Mint {
        let acc = self.ctx.banks_client.get_account(mint).await.unwrap().unwrap();
        spl_token::state::Mint::unpack(&acc.data).unwrap()
    }

    async fn pool_state(&mut self) -> Pool {
        let acc = self.ctx.banks_client.get_account(self.pool).await.unwrap().unwrap();
        Pool::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    async fn new_user(&mut self, usdc: u64) -> Keypair {
        let u = Keypair::new();
        let payer = self.ctx.payer.pubkey();
        let ata = get_associated_token_address(&u.pubkey(), &self.usdc_mint.pubkey());
        let ixs = vec![
            system_instruction::transfer(&payer, &u.pubkey(), 2_000_000_000),
            anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
                &payer,
                &u.pubkey(),
                &self.usdc_mint.pubkey(),
                &spl_token::ID,
            ),
            spl_token::instruction::mint_to(&spl_token::ID, &self.usdc_mint.pubkey(), &ata, &payer, &[], usdc).unwrap(),
        ];
        self.send(&ixs, &[]).await.unwrap();
        u
    }

    fn usdc_ata(&self, owner: &Pubkey) -> Pubkey {
        get_associated_token_address(owner, &self.usdc_mint.pubkey())
    }

    fn tk_ata(&self, owner: &Pubkey) -> Pubkey {
        get_associated_token_address(owner, &self.token_mint.pubkey())
    }

    fn buy_ix(&self, buyer: &Pubkey, quote_in: u64, min_out: u64) -> Instruction {
        Instruction {
            program_id: mastter_factory::ID,
            accounts: mastter_factory::accounts::Buy {
                buyer: *buyer,
                pool: self.pool,
                token_mint: self.token_mint.pubkey(),
                quote_mint: self.usdc_mint.pubkey(),
                token_vault: self.token_vault,
                quote_vault: self.quote_vault,
                buyer_quote_account: self.usdc_ata(buyer),
                buyer_token_account: self.tk_ata(buyer),
                token_program: spl_token::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data: mastter_factory::instruction::Buy { quote_in, min_tokens_out: min_out }.data(),
        }
    }

    fn sell_ix(&self, seller: &Pubkey, tokens_in: u64, min_out: u64) -> Instruction {
        Instruction {
            program_id: mastter_factory::ID,
            accounts: mastter_factory::accounts::Sell {
                seller: *seller,
                pool: self.pool,
                token_mint: self.token_mint.pubkey(),
                quote_mint: self.usdc_mint.pubkey(),
                token_vault: self.token_vault,
                quote_vault: self.quote_vault,
                seller_token_account: self.tk_ata(seller),
                seller_quote_account: self.usdc_ata(seller),
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: mastter_factory::instruction::Sell { tokens_in, min_quote_out: min_out }.data(),
        }
    }

    fn deposit_pda(&self, reference: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[DEPOSIT_SEED, self.pool.as_ref(), reference], &mastter_factory::ID).0
    }

    fn inject_ix(&self, depositor: &Pubkey, amount: u64, reference: [u8; 32]) -> Instruction {
        Instruction {
            program_id: mastter_factory::ID,
            accounts: mastter_factory::accounts::InjectQuote {
                depositor: *depositor,
                pool: self.pool,
                token_mint: self.token_mint.pubkey(),
                quote_mint: self.usdc_mint.pubkey(),
                token_vault: self.token_vault,
                quote_vault: self.quote_vault,
                depositor_quote_account: self.usdc_ata(depositor),
                deposit_record: self.deposit_pda(&reference),
                token_program: spl_token::ID,
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data: mastter_factory::instruction::InjectQuote { amount, reference }.data(),
        }
    }

    fn admin_ix(&self, authority: &Pubkey, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: mastter_factory::ID,
            accounts: mastter_factory::accounts::AdminOnly { authority: *authority, pool: self.pool }
                .to_account_metas(None),
            data,
        }
    }
}

fn init_ix(
    admin: &Pubkey,
    token_mint: &Pubkey,
    usdc_mint: &Pubkey,
    params: InitializePoolParams,
) -> (Instruction, Pubkey, Pubkey, Pubkey) {
    let pool = Pubkey::find_program_address(&[POOL_SEED, token_mint.as_ref()], &mastter_factory::ID).0;
    let token_vault = Pubkey::find_program_address(&[TOKEN_VAULT_SEED, pool.as_ref()], &mastter_factory::ID).0;
    let quote_vault = Pubkey::find_program_address(&[QUOTE_VAULT_SEED, pool.as_ref()], &mastter_factory::ID).0;
    let ix = Instruction {
        program_id: mastter_factory::ID,
        accounts: mastter_factory::accounts::InitializePool {
            authority: *admin,
            pool,
            token_mint: *token_mint,
            quote_mint: *usdc_mint,
            token_vault,
            quote_vault,
            token_program: spl_token::ID,
            system_program: solana_sdk::system_program::ID,
            rent: solana_sdk::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: mastter_factory::instruction::InitializePool { params }.data(),
    };
    (ix, pool, token_vault, quote_vault)
}

fn default_params() -> InitializePoolParams {
    InitializePoolParams {
        token_decimals: 9,
        max_supply: MAX_SUPPLY,
        initial_price: P0,
        buy_fee_bps: FEE,
        sell_fee_bps: FEE,
    }
}

/// Sobe o banco, cria o USDC de teste e (opcionalmente) inicializa o cofre.
async fn setup(params: Option<InitializePoolParams>) -> (Env, Result<(), BanksClientError>) {
    let mut pt = ProgramTest::new("casa_da_moeda", mastter_factory::ID, processor!(process));
    pt.prefer_bpf(false);
    let ctx = pt.start_with_context().await;

    let usdc_mint = Keypair::new();
    let token_mint = Keypair::new();
    let admin = Keypair::new();
    let mut env = Env {
        ctx,
        usdc_mint,
        token_mint,
        admin,
        pool: Pubkey::default(),
        token_vault: Pubkey::default(),
        quote_vault: Pubkey::default(),
    };

    let payer = env.ctx.payer.pubkey();
    let rent = env.ctx.banks_client.get_rent().await.unwrap();
    let ixs = vec![
        system_instruction::create_account(
            &payer,
            &env.usdc_mint.pubkey(),
            rent.minimum_balance(spl_token::state::Mint::LEN),
            spl_token::state::Mint::LEN as u64,
            &spl_token::ID,
        ),
        spl_token::instruction::initialize_mint(&spl_token::ID, &env.usdc_mint.pubkey(), &payer, None, 6).unwrap(),
        system_instruction::transfer(&payer, &env.admin.pubkey(), 5_000_000_000),
    ];
    let usdc = env.usdc_mint.insecure_clone();
    env.send(&ixs, &[&usdc]).await.unwrap();

    let p = params.unwrap_or_else(default_params);
    let (ix, pool, tv, qv) = init_ix(&env.admin.pubkey(), &env.token_mint.pubkey(), &env.usdc_mint.pubkey(), p);
    env.pool = pool;
    env.token_vault = tv;
    env.quote_vault = qv;
    let admin = env.admin.insecure_clone();
    let tm = env.token_mint.insecure_clone();
    let r = env.send(&[ix], &[&admin, &tm]).await;
    (env, r)
}

// ---------------------------------------------------------------------------

#[tokio::test]
async fn t01_token_nasce_com_supply_zero_e_autoridade_do_cofre() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let mint = env.mint_state(env.token_mint.pubkey()).await;
    assert_eq!(mint.supply, 0);
    assert_eq!(mint.decimals, 9);
    assert_eq!(mint.mint_authority, COption::Some(env.pool));
    assert_eq!(mint.freeze_authority, COption::None, "ninguém pode congelar holders");
    let p = env.pool_state().await;
    assert_eq!(p.max_supply, MAX_SUPPLY);
    assert_eq!(p.initial_price, P0);
    assert!(!p.minting_completed);
    // cofres pertencem à PDA do pool
    let qv = env.ctx.banks_client.get_account(env.quote_vault).await.unwrap().unwrap();
    assert_eq!(spl_token::state::Account::unpack(&qv.data).unwrap().owner, env.pool);
}

#[tokio::test]
async fn t02_parametros_invalidos_rejeitados() {
    let mut p = default_params();
    p.buy_fee_bps = 1_001;
    assert_eq!(custom_code(setup(Some(p)).await.1), Some(err_code(CasaError::InvalidFee)));
    let mut p = default_params();
    p.token_decimals = 10;
    assert_eq!(custom_code(setup(Some(p)).await.1), Some(err_code(CasaError::InvalidDecimals)));
    let mut p = default_params();
    p.initial_price = 0;
    assert_eq!(custom_code(setup(Some(p)).await.1), Some(err_code(CasaError::InvalidPrice)));
    let mut p = default_params();
    p.max_supply = 0;
    assert_eq!(custom_code(setup(Some(p)).await.1), Some(err_code(CasaError::InvalidMaxSupply)));
}

#[tokio::test]
async fn t03_compra_fase1_cunha_no_ato() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let alice = env.new_user(1_000 * USDC).await;
    let ix = env.buy_ix(&alice.pubkey(), 100 * USDC, 99_000 * TK);
    env.send(&[ix], &[&alice]).await.unwrap();

    assert_eq!(env.token_balance(env.tk_ata(&alice.pubkey())).await, 99_000 * TK);
    assert_eq!(env.mint_state(env.token_mint.pubkey()).await.supply, 99_000 * TK);
    assert_eq!(env.token_balance(env.quote_vault).await, 100 * USDC, "taxa fica no cofre");
    assert_eq!(env.token_balance(env.usdc_ata(&alice.pubkey())).await, 900 * USDC);
    let p = env.pool_state().await;
    assert_eq!(p.minted_total, 99_000 * TK);
    assert!(!p.minting_completed);
}

#[tokio::test]
async fn t04_slippage_e_valor_zero() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let alice = env.new_user(1_000 * USDC).await;
    let ix = env.buy_ix(&alice.pubkey(), 100 * USDC, 99_000 * TK + 1);
    assert_eq!(custom_code(env.send(&[ix], &[&alice]).await), Some(err_code(CasaError::SlippageExceeded)));
    let ix = env.buy_ix(&alice.pubkey(), 0, 0);
    assert_eq!(custom_code(env.send(&[ix], &[&alice]).await), Some(err_code(CasaError::ZeroAmount)));
}

#[tokio::test]
async fn t05_injecao_sem_token_nao_altera_supply_nem_preco_fase1() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let investor = env.new_user(10_000 * USDC).await;
    let reference = [7u8; 32];
    let ix = env.inject_ix(&investor.pubkey(), 5_000 * USDC, reference);
    env.send(&[ix], &[&investor]).await.unwrap();

    assert_eq!(env.mint_state(env.token_mint.pubkey()).await.supply, 0, "nenhum token emitido");
    assert_eq!(env.token_balance(env.quote_vault).await, 5_000 * USDC);
    let p = env.pool_state().await;
    assert_eq!(p.total_quote_injected, 5_000 * USDC);
    assert_eq!(p.deposit_count, 1);

    let rec_acc = env.ctx.banks_client.get_account(env.deposit_pda(&reference)).await.unwrap().unwrap();
    let rec = DepositRecord::try_deserialize(&mut rec_acc.data.as_slice()).unwrap();
    assert_eq!(rec.amount, 5_000 * USDC);
    assert_eq!(rec.depositor, investor.pubkey());
    assert!(!rec.during_capitalization);

    // preço da fase 1 continua fixo: 100 USDC ainda compram 99.000 tokens
    let alice = env.new_user(100 * USDC).await;
    let ix = env.buy_ix(&alice.pubkey(), 100 * USDC, 99_000 * TK);
    env.send(&[ix], &[&alice]).await.unwrap();
}

#[tokio::test]
async fn t06_deposito_duplicado_rejeitado() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let investor = env.new_user(10_000 * USDC).await;
    let reference = [9u8; 32];
    let ix = env.inject_ix(&investor.pubkey(), 100 * USDC, reference);
    env.send(&[ix], &[&investor]).await.unwrap();
    let ix = env.inject_ix(&investor.pubkey(), 100 * USDC, reference);
    assert!(env.send(&[ix], &[&investor]).await.is_err(), "mesma referência não pode entrar duas vezes");
    assert_eq!(env.token_balance(env.quote_vault).await, 100 * USDC);
}

#[tokio::test]
async fn t07_venda_fase1_preco_fixo_e_estoque_reaproveitado() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let alice = env.new_user(1_000 * USDC).await;
    let ix = env.buy_ix(&alice.pubkey(), 100 * USDC, 0);
    env.send(&[ix], &[&alice]).await.unwrap();

    let ix = env.sell_ix(&alice.pubkey(), 9_000 * TK, 8_910_000);
    env.send(&[ix], &[&alice]).await.unwrap(); // 9 USDC bruto − 1% = 8,91
    assert_eq!(env.token_balance(env.usdc_ata(&alice.pubkey())).await, 900 * USDC + 8_910_000);
    assert_eq!(env.token_balance(env.token_vault).await, 9_000 * TK, "tokens voltam ao estoque");
    assert_eq!(env.mint_state(env.token_mint.pubkey()).await.supply, 99_000 * TK, "venda não queima");

    // próxima compra usa o estoque antes de cunhar
    let bob = env.new_user(100 * USDC).await;
    let ix = env.buy_ix(&bob.pubkey(), 10 * USDC, 0); // 9.900 tokens
    env.send(&[ix], &[&bob]).await.unwrap();
    assert_eq!(env.token_balance(env.token_vault).await, 0);
    assert_eq!(env.pool_state().await.minted_total, 99_000 * TK + 900 * TK);
}

#[tokio::test]
async fn t08_ultimo_token_conclui_cunhagem_e_revoga_autoridade() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let whale = env.new_user(5_000 * USDC).await;
    // 1.000.000 tokens a US$ 0,001 = US$ 1.000 líquido; envia 5.000 e só paga o necessário
    let ix = env.buy_ix(&whale.pubkey(), 5_000 * USDC, MAX_SUPPLY);
    env.send(&[ix], &[&whale]).await.unwrap();

    let paid = 5_000 * USDC - env.token_balance(env.usdc_ata(&whale.pubkey())).await;
    assert_eq!(paid, 1_010_101_011, "ceil(1000 USDC / 0,99)");
    let mint = env.mint_state(env.token_mint.pubkey()).await;
    assert_eq!(mint.supply, MAX_SUPPLY);
    assert_eq!(mint.mint_authority, COption::None, "cunhagem encerrada para sempre");
    let p = env.pool_state().await;
    assert!(p.minting_completed);
    assert_eq!(p.minted_total, MAX_SUPPLY);

    // sem estoque e sem cunhagem: compra falha
    let bob = env.new_user(100 * USDC).await;
    let ix = env.buy_ix(&bob.pubkey(), 10 * USDC, 0);
    assert_eq!(custom_code(env.send(&[ix], &[&bob]).await), Some(err_code(CasaError::InsufficientInventory)));
}

#[tokio::test]
async fn t09_fase2_preco_reserva_sobre_circulacao() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let whale = env.new_user(5_000 * USDC).await;
    let ix = env.buy_ix(&whale.pubkey(), 5_000 * USDC, 0);
    env.send(&[ix], &[&whale]).await.unwrap();
    let reserve0 = env.token_balance(env.quote_vault).await; // 1.010,101011 USDC

    // capital injetado na fase 2 valoriza o token
    let investor = env.new_user(10_000 * USDC).await;
    let ix = env.inject_ix(&investor.pubkey(), 1_000 * USDC, [1u8; 32]);
    env.send(&[ix], &[&investor]).await.unwrap();
    let reserve = reserve0 + 1_000 * USDC;
    assert_eq!(env.token_balance(env.quote_vault).await, reserve);
    let rec_acc = env.ctx.banks_client.get_account(env.deposit_pda(&[1u8; 32])).await.unwrap().unwrap();
    assert!(DepositRecord::try_deserialize(&mut rec_acc.data.as_slice()).unwrap().during_capitalization);

    // venda: recebe tokens × reserva / circulação, menos 1%
    let sell_amt = 100_000 * TK;
    let gross = ((sell_amt as u128 * reserve as u128) / MAX_SUPPLY as u128) as u64;
    let net = gross - gross / 100;
    let before = env.token_balance(env.usdc_ata(&whale.pubkey())).await;
    let ix = env.sell_ix(&whale.pubkey(), sell_amt, net);
    env.send(&[ix], &[&whale]).await.unwrap();
    assert_eq!(env.token_balance(env.usdc_ata(&whale.pubkey())).await - before, net);

    // preço não caiu (taxa retida): reserva'/circ' ≥ reserva/circ
    let reserve2 = env.token_balance(env.quote_vault).await;
    let circ2 = MAX_SUPPLY - env.token_balance(env.token_vault).await;
    assert!(reserve2 as u128 * MAX_SUPPLY as u128 >= reserve as u128 * circ2 as u128);

    // compra na fase 2 sai do estoque, ao preço reserva/circulação, sem cunhar
    let bob = env.new_user(100 * USDC).await;
    let expected = ((99 * USDC) as u128 * circ2 as u128 / reserve2 as u128) as u64; // 100 − 1%
    let ix = env.buy_ix(&bob.pubkey(), 100 * USDC, expected);
    env.send(&[ix], &[&bob]).await.unwrap();
    assert_eq!(env.token_balance(env.tk_ata(&bob.pubkey())).await, expected);
    assert_eq!(env.mint_state(env.token_mint.pubkey()).await.supply, MAX_SUPPLY);
}

#[tokio::test]
async fn t10_pausa_bloqueia_compra_e_injecao_mas_nunca_a_venda() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let alice = env.new_user(1_000 * USDC).await;
    let ix = env.buy_ix(&alice.pubkey(), 100 * USDC, 0);
    env.send(&[ix], &[&alice]).await.unwrap();

    let admin = env.admin.insecure_clone();
    let ix = env.admin_ix(&admin.pubkey(), mastter_factory::instruction::SetPaused { paused: true }.data());
    env.send(&[ix], &[&admin]).await.unwrap();

    let ix = env.buy_ix(&alice.pubkey(), 10 * USDC, 0);
    assert_eq!(custom_code(env.send(&[ix], &[&alice]).await), Some(err_code(CasaError::Paused)));
    let ix = env.inject_ix(&alice.pubkey(), 10 * USDC, [3u8; 32]);
    assert_eq!(custom_code(env.send(&[ix], &[&alice]).await), Some(err_code(CasaError::Paused)));

    let ix = env.sell_ix(&alice.pubkey(), 1_000 * TK, 0);
    env.send(&[ix], &[&alice]).await.expect("venda funciona mesmo pausado");
}

#[tokio::test]
async fn t11_nao_existe_saque_de_usdc_sem_token() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let investor = env.new_user(10_000 * USDC).await;
    let ix = env.inject_ix(&investor.pubkey(), 5_000 * USDC, [5u8; 32]);
    env.send(&[ix], &[&investor]).await.unwrap();
    let attacker = env.new_user(10 * USDC).await;
    let ix = env.buy_ix(&attacker.pubkey(), 10 * USDC, 0); // atacante tem tokens legítimos
    env.send(&[ix], &[&attacker]).await.unwrap();
    let vault_before = env.token_balance(env.quote_vault).await;
    let admin = env.admin.insecure_clone();

    // (a) transferência SPL direta do cofre: ninguém tem a chave da PDA
    for who in [&attacker, &admin] {
        let ix = spl_token::instruction::transfer(
            &spl_token::ID,
            &env.quote_vault,
            &env.usdc_ata(&who.pubkey()),
            &who.pubkey(),
            &[],
            1,
        )
        .unwrap();
        assert!(env.send(&[ix], &[who]).await.is_err());
    }

    // (b) vender sem ter token
    let mut ix = env.sell_ix(&attacker.pubkey(), 1_000 * TK, 0);
    ix.accounts[6].pubkey = env.token_vault; // tenta usar o próprio cofre como origem
    assert!(env.send(&[ix], &[&attacker]).await.is_err());

    // (c) passar um cofre falso / trocar o cofre de destino
    let mut ix = env.sell_ix(&attacker.pubkey(), 1_000 * TK, 0);
    ix.accounts[5].pubkey = env.usdc_ata(&attacker.pubkey());
    assert!(env.send(&[ix], &[&attacker]).await.is_err());
    // (c2) receber o USDC em conta de outra pessoa
    let mut ix = env.sell_ix(&attacker.pubkey(), 1_000 * TK, 0);
    ix.accounts[7].pubkey = env.usdc_ata(&investor.pubkey());
    assert!(env.send(&[ix], &[&attacker]).await.is_err());
    // (c3) cofre de outro pool criado pelo atacante não é aceito (has_one)
    let mut ix = env.sell_ix(&attacker.pubkey(), 1_000 * TK, 0);
    ix.accounts[4].pubkey = env.tk_ata(&attacker.pubkey());
    assert!(env.send(&[ix], &[&attacker]).await.is_err());

    // (d) instrução inexistente (ex.: "withdraw") é recusada pelo programa
    let ix = Instruction {
        program_id: mastter_factory::ID,
        accounts: env.admin_ix(&admin.pubkey(), vec![]).accounts,
        data: solana_sdk::hash::hash(b"global:withdraw").to_bytes()[..8].to_vec(),
    };
    assert!(env.send(&[ix], &[&admin]).await.is_err());

    // (e) admin não pode cunhar direto
    let ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        &env.token_mint.pubkey(),
        &env.token_vault,
        &admin.pubkey(),
        &[],
        1,
    )
    .unwrap();
    assert!(env.send(&[ix], &[&admin]).await.is_err());

    assert_eq!(env.token_balance(env.quote_vault).await, vault_before, "cofre intacto");
    assert_eq!(env.token_balance(env.usdc_ata(&attacker.pubkey())).await, 0);
}

#[tokio::test]
async fn t12_somente_admin_pausa_e_transferencia_em_duas_etapas() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let stranger = env.new_user(0).await;
    let ix = env.admin_ix(&stranger.pubkey(), mastter_factory::instruction::SetPaused { paused: true }.data());
    assert!(env.send(&[ix], &[&stranger]).await.is_err());

    let admin = env.admin.insecure_clone();
    let new_admin = env.new_user(0).await;
    let ix = env.admin_ix(
        &admin.pubkey(),
        mastter_factory::instruction::ProposeAuthority { new_authority: new_admin.pubkey() }.data(),
    );
    env.send(&[ix], &[&admin]).await.unwrap();

    let accept = |who: Pubkey, pool: Pubkey| Instruction {
        program_id: mastter_factory::ID,
        accounts: mastter_factory::accounts::AcceptAuthority { new_authority: who, pool }.to_account_metas(None),
        data: mastter_factory::instruction::AcceptAuthority {}.data(),
    };
    let ix = accept(stranger.pubkey(), env.pool);
    assert_eq!(
        custom_code(env.send(&[ix], &[&stranger]).await),
        Some(err_code(CasaError::NotPendingAuthority))
    );
    let ix = accept(new_admin.pubkey(), env.pool);
    env.send(&[ix], &[&new_admin]).await.unwrap();
    assert_eq!(env.pool_state().await.authority, new_admin.pubkey());
}

#[tokio::test]
async fn t13_integridade_todos_conseguem_sair() {
    let (mut env, r) = setup(None).await;
    r.unwrap();
    let a = env.new_user(5_000 * USDC).await;
    let b = env.new_user(5_000 * USDC).await;
    let inv = env.new_user(5_000 * USDC).await;
    let ix = env.buy_ix(&a.pubkey(), 600 * USDC, 0);
    env.send(&[ix], &[&a]).await.unwrap();
    let ix = env.inject_ix(&inv.pubkey(), 300 * USDC, [2u8; 32]);
    env.send(&[ix], &[&inv]).await.unwrap();
    let ix = env.buy_ix(&b.pubkey(), 2_000 * USDC, 0); // completa a cunhagem
    env.send(&[ix], &[&b]).await.unwrap();
    assert!(env.pool_state().await.minting_completed);

    for u in [&a, &b] {
        let bal = env.token_balance(env.tk_ata(&u.pubkey())).await;
        let ix = env.sell_ix(&u.pubkey(), bal, 0);
        env.send(&[ix], &[u]).await.unwrap();
        assert_eq!(env.token_balance(env.tk_ata(&u.pubkey())).await, 0);
    }
    // tudo voltou ao estoque; sobra no cofre só a taxa retida + arredondamentos
    assert_eq!(env.token_balance(env.token_vault).await, MAX_SUPPLY);
    let p = env.pool_state().await;
    let reserve = env.token_balance(env.quote_vault).await;
    assert_eq!(
        reserve as u128,
        p.total_quote_from_buys as u128 + p.total_quote_injected as u128 - p.total_quote_paid_on_sells as u128
    );
}
