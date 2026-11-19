//! Ciclo de vida do cofre da entidade: cadastro, ativação, configuração,
//! pausa, atualização cadastral e encerramento de cunhagem.
use crate::constants::*;
use crate::errors::FactoryError;
use crate::events::*;
use crate::math::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint as SplMint, Token, TokenAccount as SplTokenAccount};
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::token_interface::{
    token_metadata_initialize, token_metadata_update_authority, token_metadata_update_field, Mint,
    TokenAccount, TokenMetadataInitialize, TokenMetadataUpdateAuthority, TokenMetadataUpdateField,
};
use spl_pod::optional_keys::OptionalNonZeroPubkey;
use spl_token_metadata_interface::state::Field;

/// Chave do campo adicional de metadados que guarda o hash da imagem.
pub const IMAGE_HASH_FIELD: &str = "image_sha256";

fn to_hex(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

// ---------------------------------------------------------------------------
// initialize_entity_vault
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeEntityVaultArgs {
    // Identificação do token
    pub token_name: String,
    pub token_symbol: String,
    pub decimals: u8,
    pub entity_id: u64,
    pub contract_number: u64,
    // Dados cadastrais
    pub company_name: String,
    pub address: String,
    pub phone: String,
    pub country: String,
    pub directors_names: String,
    pub payer_name: String,
    pub verum_wallet_address: Pubkey,
    // Parâmetros financeiros
    /// Lastro inicial em USDC (unidades-base), aportado em `activate_entity_vault`.
    pub initial_pool_amount: u64,
    /// Hard Cap em tokens inteiros: 25_000_000, 50_000_000 ou 100_000_000.
    pub hard_cap: u64,
    /// Limites anti-whale em unidades-base do token.
    pub min_buy: u64,
    pub max_buy: u64,
    pub max_wallet: u64,
    /// Taxa de plataforma em basis points (padrão 119 = 1,19%).
    pub platform_fee: u16,
    // Operação
    pub profit_injector: Pubkey,
    pub charge_fee_on_profit: bool,
}

#[derive(Accounts)]
#[instruction(args: InitializeEntityVaultArgs)]
pub struct InitializeEntityVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + EntityVault::INIT_SPACE,
        seeds = [SEED_VAULT, &args.entity_id.to_le_bytes()],
        bump
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    #[account(
        init,
        payer = admin,
        space = 8 + RegistryData::INIT_SPACE,
        seeds = [SEED_REGISTRY, vault.key().as_ref()],
        bump
    )]
    pub registry: Box<Account<'info, RegistryData>>,
    #[account(
        init,
        payer = admin,
        space = 8 + BackingLedger::INIT_SPACE,
        seeds = [SEED_LEDGER, vault.key().as_ref()],
        bump
    )]
    pub ledger: Box<Account<'info, BackingLedger>>,
    /// CHECK: Verum Wallet da entidade. Validada on-chain: conta de sistema (wallet),
    /// igual ao parâmetro `verum_wallet_address`, distinta de admin/receita/PDAs do cofre.
    #[account(
        owner = system_program::ID @ FactoryError::InvalidVerumWallet,
        constraint = verum_wallet.key() == args.verum_wallet_address @ FactoryError::InvalidVerumWallet
    )]
    pub verum_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_entity_vault(
    ctx: Context<InitializeEntityVault>,
    args: InitializeEntityVaultArgs,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, FactoryError::FactoryPaused);

    // --- validações ---
    check_str(&args.token_name, MAX_TOKEN_NAME_LEN, false)?;
    check_str(&args.token_symbol, MAX_TOKEN_SYMBOL_LEN, false)?;
    check_str(&args.company_name, MAX_COMPANY_NAME_LEN, false)?;
    check_str(&args.address, MAX_ADDRESS_LEN, false)?;
    check_str(&args.phone, MAX_PHONE_LEN, false)?;
    check_str(&args.country, MAX_COUNTRY_LEN, false)?;
    check_str(&args.directors_names, MAX_DIRECTORS_LEN, false)?;
    check_str(&args.payer_name, MAX_PAYER_NAME_LEN, false)?;

    require!(args.decimals <= MAX_DECIMALS, FactoryError::InvalidDecimals);
    require!(HARD_CAP_OPTIONS.contains(&args.hard_cap), FactoryError::InvalidHardCap);
    let hard_cap_base = to_u64(
        (args.hard_cap as u128)
            .checked_mul(pow10(args.decimals as u32)?)
            .ok_or(FactoryError::MathOverflow)?,
    )?;

    require!(args.platform_fee <= MAX_PLATFORM_FEE_BPS, FactoryError::InvalidFee);
    require!(args.initial_pool_amount > 0, FactoryError::InvalidAmount);
    require!(
        args.min_buy > 0
            && args.min_buy <= args.max_buy
            && args.max_buy <= args.max_wallet
            && args.max_wallet <= hard_cap_base,
        FactoryError::InvalidAntiWhaleParams
    );
    require!(args.profit_injector != Pubkey::default(), FactoryError::Unauthorized);

    let verum = ctx.accounts.verum_wallet.key();
    let vault_key = ctx.accounts.vault.key();
    require!(
        verum != Pubkey::default()
            && verum != system_program::ID
            && verum != vault_key
            && verum != ctx.accounts.config.key()
            && verum != ctx.accounts.registry.key()
            && verum != ctx.accounts.ledger.key()
            && verum != ctx.accounts.config.revenue_wallet,
        FactoryError::InvalidVerumWallet
    );

    let now = Clock::get()?.unix_timestamp;
    let admin_key = ctx.accounts.admin.key();

    // --- EntityVault ---
    let vault = &mut ctx.accounts.vault;
    vault.entity_id = args.entity_id;
    vault.contract_number = args.contract_number;
    vault.authority = admin_key;
    vault.profit_injector = args.profit_injector;
    vault.verum_wallet = verum;
    vault.revenue_wallet = ctx.accounts.config.revenue_wallet;
    vault.mint = Pubkey::default();
    vault.sol_treasury = Pubkey::default();
    vault.usdc_treasury = Pubkey::default();
    vault.ledger = ctx.accounts.ledger.key();
    vault.vesting = Pubkey::default();
    vault.registry = ctx.accounts.registry.key();
    vault.token_name = args.token_name.clone();
    vault.token_symbol = args.token_symbol.clone();
    vault.decimals = args.decimals;
    vault.hard_cap_tokens = args.hard_cap;
    vault.hard_cap = hard_cap_base;
    vault.initial_pool_amount = args.initial_pool_amount;
    vault.min_buy = args.min_buy;
    vault.max_buy = args.max_buy;
    vault.max_wallet = args.max_wallet;
    vault.platform_fee_bps = args.platform_fee;
    vault.charge_fee_on_profit = args.charge_fee_on_profit;
    vault.circulating_supply = 0;
    vault.vesting_locked_supply = 0;
    vault.total_minted = 0;
    vault.total_burned = 0;
    vault.status = VaultStatus::PendingActivation;
    vault.minting_closed = false;
    vault.created_at = now;
    vault.activated_at = 0;
    vault.bump = ctx.bumps.vault;
    vault.ledger_bump = ctx.bumps.ledger;
    vault.registry_bump = ctx.bumps.registry;
    vault.image_sha256 = [0u8; 32];
    vault.reserved = [0u8; 32];

    // --- RegistryData ---
    let registry = &mut ctx.accounts.registry;
    registry.vault = vault_key;
    registry.entity_id = args.entity_id;
    registry.contract_number = args.contract_number;
    registry.company_name = args.company_name;
    registry.address = args.address;
    registry.phone = args.phone;
    registry.country = args.country;
    registry.directors_names = args.directors_names;
    registry.payer_name = args.payer_name;
    registry.registered_by = admin_key;
    registry.registered_at = now;
    registry.last_updated_by = admin_key;
    registry.last_updated_at = now;
    registry.update_count = 0;
    registry.bump = ctx.bumps.registry;

    // --- BackingLedger ---
    let ledger = &mut ctx.accounts.ledger;
    ledger.vault = vault_key;
    ledger.bump = ctx.bumps.ledger;
    ledger.last_operation_ts = now;

    let config = &mut ctx.accounts.config;
    config.entity_count = config.entity_count.checked_add(1).ok_or(FactoryError::MathOverflow)?;

    emit!(EntityVaultInitialized {
        entity_id: args.entity_id,
        contract_number: args.contract_number,
        vault: vault_key,
        registry: ctx.accounts.registry.key(),
        authority: admin_key,
        verum_wallet: verum,
        revenue_wallet: ctx.accounts.vault.revenue_wallet,
        token_name: args.token_name,
        token_symbol: args.token_symbol,
        decimals: args.decimals,
        hard_cap: hard_cap_base,
        min_buy: args.min_buy,
        max_buy: args.max_buy,
        max_wallet: args.max_wallet,
        platform_fee_bps: args.platform_fee,
        initial_pool_amount: args.initial_pool_amount,
        timestamp: now,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// activate_entity_vault
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ActivateEntityVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// Quem aporta o lastro inicial em USDC (pode ser o próprio admin ou o pagador da entidade).
    pub funder: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump,
        constraint = vault.status == VaultStatus::PendingActivation @ FactoryError::InvalidVaultStatus
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    #[account(
        mut,
        seeds = [SEED_LEDGER, vault.key().as_ref()],
        bump = vault.ledger_bump,
        has_one = vault
    )]
    pub ledger: Box<Account<'info, BackingLedger>>,
    /// Mint Token-2022 da entidade: mint authority = PDA do cofre, freeze authority nula,
    /// extensões: MetadataPointer + TokenMetadata (somente).
    #[account(
        init,
        payer = admin,
        seeds = [SEED_MINT, vault.key().as_ref()],
        bump,
        mint::decimals = vault.decimals,
        mint::authority = vault,
        mint::token_program = token_2022_program,
        extensions::metadata_pointer::authority = vault,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        space = 8 + VestingAccount::INIT_SPACE,
        seeds = [SEED_VESTING, vault.key().as_ref()],
        bump
    )]
    pub vesting: Box<Account<'info, VestingAccount>>,
    #[account(
        init,
        payer = admin,
        seeds = [SEED_VESTING_ESCROW, vault.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault,
        token::token_program = token_2022_program,
    )]
    pub vesting_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: cofre SOL (PDA de sistema, sem dados). Validado pelas seeds.
    #[account(
        mut,
        seeds = [SEED_SOL_TREASURY, vault.key().as_ref()],
        bump
    )]
    pub sol_treasury: SystemAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [SEED_USDC_TREASURY, vault.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub usdc_treasury: Box<Account<'info, SplTokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, SplMint>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = funder,
    )]
    pub funder_usdc_account: Box<Account<'info, SplTokenAccount>>,
    pub token_2022_program: Program<'info, Token2022>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// A identidade do token (nome, símbolo, URI dos metadados e hash da imagem) é gravada
/// aqui uma única vez e a autoridade de atualização dos metadados é revogada na mesma
/// transação: depois disso ninguém, nem o admin, consegue alterá-la.
pub fn activate_entity_vault(
    ctx: Context<ActivateEntityVault>,
    token_uri: String,
    image_sha256: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.config.paused, FactoryError::FactoryPaused);
    check_str(&token_uri, MAX_TOKEN_URI_LEN, false)?;
    require!(image_sha256 != [0u8; 32], FactoryError::InvalidImageHash);
    let image_hex = to_hex(&image_sha256);

    let now = Clock::get()?.unix_timestamp;
    let rent = Rent::get()?;
    let vault_key = ctx.accounts.vault.key();
    let entity_id_bytes = ctx.accounts.vault.entity_id.to_le_bytes();
    let vault_bump = [ctx.accounts.vault.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &entity_id_bytes, &vault_bump]];

    let initial_pool = ctx.accounts.vault.initial_pool_amount;
    require!(
        ctx.accounts.funder_usdc_account.amount >= initial_pool,
        FactoryError::InsufficientUserBalance
    );

    let vesting_allocation = to_u64(mul_div_floor(
        ctx.accounts.vault.hard_cap as u128,
        VESTING_ALLOCATION_PCT as u128,
        100,
    )?)?;
    let cliff_ts = now.checked_add(VESTING_CLIFF_SECS).ok_or(FactoryError::MathOverflow)?;
    let end_ts = now.checked_add(VESTING_TOTAL_SECS).ok_or(FactoryError::MathOverflow)?;

    // --- efeitos (estado) ---
    {
        let vault = &mut ctx.accounts.vault;
        vault.mint = ctx.accounts.mint.key();
        vault.sol_treasury = ctx.accounts.sol_treasury.key();
        vault.usdc_treasury = ctx.accounts.usdc_treasury.key();
        vault.vesting = ctx.accounts.vesting.key();
        vault.authority = ctx.accounts.admin.key();
        vault.vesting_locked_supply = vesting_allocation;
        vault.total_minted = vesting_allocation;
        vault.status = VaultStatus::Active;
        vault.image_sha256 = image_sha256;
        vault.activated_at = now;
        vault.mint_bump = ctx.bumps.mint;
        vault.sol_treasury_bump = ctx.bumps.sol_treasury;
        vault.usdc_treasury_bump = ctx.bumps.usdc_treasury;
        vault.vesting_bump = ctx.bumps.vesting;
        vault.vesting_escrow_bump = ctx.bumps.vesting_escrow;
        require!(
            vault.reference_supply()? <= vault.hard_cap,
            FactoryError::HardCapExceeded
        );
    }
    {
        let vesting = &mut ctx.accounts.vesting;
        vesting.vault = vault_key;
        vesting.mint = ctx.accounts.mint.key();
        vesting.escrow = ctx.accounts.vesting_escrow.key();
        vesting.beneficiary = ctx.accounts.vault.verum_wallet;
        vesting.total_allocated = vesting_allocation;
        vesting.released = 0;
        vesting.remaining = vesting_allocation;
        vesting.start_ts = now;
        vesting.cliff_ts = cliff_ts;
        vesting.end_ts = end_ts;
        vesting.last_claim_ts = 0;
        vesting.bump = ctx.bumps.vesting;
    }
    {
        let ledger = &mut ctx.accounts.ledger;
        ledger.usdc_backing = ledger
            .usdc_backing
            .checked_add(initial_pool)
            .ok_or(FactoryError::MathOverflow)?;
        ledger.last_operation_ts = now;
    }

    // --- interações ---
    // 1) Cofre SOL: garante isenção de aluguel (valor não contabilizado como lastro).
    let rent_min = rent.minimum_balance(0);
    let current = ctx.accounts.sol_treasury.lamports();
    if current < rent_min {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.sol_treasury.to_account_info(),
                },
            ),
            rent_min - current,
        )?;
    }

    // 2) Metadados do token (extensão TokenMetadata no próprio mint).
    let name = ctx.accounts.vault.token_name.clone();
    let symbol = ctx.accounts.vault.token_symbol.clone();
    let mint_info = ctx.accounts.mint.to_account_info();
    // TLV (4) + update_authority (32) + mint (32) + 3 strings (4 + len) + vec vazio (4)
    // + campo adicional: (4 + chave) + (4 + 64 caracteres hex)
    let metadata_space = 4 + 32 + 32 + (4 + name.len()) + (4 + symbol.len()) + (4 + token_uri.len()) + 4
        + (4 + IMAGE_HASH_FIELD.len()) + (4 + image_hex.len());
    let new_len = mint_info
        .data_len()
        .checked_add(metadata_space)
        .ok_or(FactoryError::MathOverflow)?;
    let needed = rent.minimum_balance(new_len);
    let have = mint_info.lamports();
    if needed > have {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: mint_info.clone(),
                },
            ),
            needed - have,
        )?;
    }
    token_metadata_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_2022_program.to_account_info(),
                mint: mint_info.clone(),
                metadata: mint_info.clone(),
                mint_authority: ctx.accounts.vault.to_account_info(),
                update_authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        name,
        symbol,
        token_uri.clone(),
    )?;

    // 2b) Hash da imagem como campo on-chain dos metadados.
    token_metadata_update_field(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            TokenMetadataUpdateField {
                program_id: ctx.accounts.token_2022_program.to_account_info(),
                metadata: mint_info.clone(),
                update_authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        Field::Key(IMAGE_HASH_FIELD.to_string()),
        image_hex,
    )?;

    // 2c) Revoga a autoridade de atualização: nome, símbolo, URI e hash ficam imutáveis.
    token_metadata_update_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            TokenMetadataUpdateAuthority {
                program_id: ctx.accounts.token_2022_program.to_account_info(),
                metadata: mint_info.clone(),
                current_authority: ctx.accounts.vault.to_account_info(),
                new_authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        OptionalNonZeroPubkey::default(),
    )?;

    // 3) Cunha os 30% do Hard Cap diretamente no escrow de vesting.
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            token_2022::MintTo {
                mint: mint_info.clone(),
                to: ctx.accounts.vesting_escrow.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        vesting_allocation,
    )?;

    // 4) Aporte do lastro inicial em USDC.
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::TransferChecked {
                from: ctx.accounts.funder_usdc_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.usdc_treasury.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        ),
        initial_pool,
        ctx.accounts.usdc_mint.decimals,
    )?;

    emit!(EntityVaultActivated {
        entity_id: ctx.accounts.vault.entity_id,
        vault: vault_key,
        mint: ctx.accounts.mint.key(),
        sol_treasury: ctx.accounts.sol_treasury.key(),
        usdc_treasury: ctx.accounts.usdc_treasury.key(),
        vesting: ctx.accounts.vesting.key(),
        vesting_allocation,
        vesting_cliff_ts: cliff_ts,
        vesting_end_ts: end_ts,
        initial_pool_amount: initial_pool,
        token_uri,
        image_sha256,
        funder: ctx.accounts.funder.key(),
        timestamp: now,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// update_entity_config / set_vault_paused / update_registry_data / close_minting
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateEntityConfigArgs {
    pub min_buy: Option<u64>,
    pub max_buy: Option<u64>,
    pub max_wallet: Option<u64>,
    pub platform_fee_bps: Option<u16>,
    pub profit_injector: Option<Pubkey>,
    pub charge_fee_on_profit: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateEntityConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    /// CHECK: nova carteira de receita do cofre (opcional); validada como conta de sistema.
    #[account(owner = system_program::ID @ FactoryError::InvalidRevenueWallet)]
    pub new_revenue_wallet: Option<UncheckedAccount<'info>>,
}

pub fn update_entity_config(
    ctx: Context<UpdateEntityConfig>,
    args: UpdateEntityConfigArgs,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    if let Some(v) = args.min_buy {
        vault.min_buy = v;
    }
    if let Some(v) = args.max_buy {
        vault.max_buy = v;
    }
    if let Some(v) = args.max_wallet {
        vault.max_wallet = v;
    }
    require!(
        vault.min_buy > 0
            && vault.min_buy <= vault.max_buy
            && vault.max_buy <= vault.max_wallet
            && vault.max_wallet <= vault.hard_cap,
        FactoryError::InvalidAntiWhaleParams
    );
    if let Some(v) = args.platform_fee_bps {
        require!(v <= MAX_PLATFORM_FEE_BPS, FactoryError::InvalidFee);
        vault.platform_fee_bps = v;
    }
    if let Some(v) = args.profit_injector {
        require!(v != Pubkey::default(), FactoryError::Unauthorized);
        vault.profit_injector = v;
    }
    if let Some(v) = args.charge_fee_on_profit {
        vault.charge_fee_on_profit = v;
    }
    if let Some(w) = &ctx.accounts.new_revenue_wallet {
        require!(
            w.key() != Pubkey::default() && w.key() != vault.verum_wallet,
            FactoryError::InvalidRevenueWallet
        );
        vault.revenue_wallet = w.key();
    }
    vault.authority = ctx.accounts.admin.key();

    emit!(AdministrativeConfigurationUpdated {
        scope: ConfigScope::EntityVault,
        entity_id: vault.entity_id,
        target: vault.key(),
        admin: ctx.accounts.admin.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct VaultAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, EntityVault>>,
}

/// Pausa/retomada emergencial de um cofre específico.
pub fn set_vault_paused(ctx: Context<VaultAdmin>, paused: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let now = Clock::get()?.unix_timestamp;
    if paused {
        require!(vault.status == VaultStatus::Active, FactoryError::InvalidVaultStatus);
        vault.status = VaultStatus::Paused;
        emit!(VaultPaused {
            entity_id: vault.entity_id,
            vault: vault.key(),
            admin: ctx.accounts.admin.key(),
            factory_wide: false,
            timestamp: now,
        });
    } else {
        require!(vault.status == VaultStatus::Paused, FactoryError::InvalidVaultStatus);
        vault.status = VaultStatus::Active;
        emit!(VaultResumed {
            entity_id: vault.entity_id,
            vault: vault.key(),
            admin: ctx.accounts.admin.key(),
            factory_wide: false,
            timestamp: now,
        });
    }
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateRegistryArgs {
    pub company_name: String,
    pub address: String,
    pub phone: String,
    pub country: String,
    pub directors_names: String,
    pub payer_name: String,
}

#[derive(Accounts)]
pub struct UpdateRegistryData<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    #[account(
        mut,
        seeds = [SEED_REGISTRY, vault.key().as_ref()],
        bump = registry.bump,
        has_one = vault
    )]
    pub registry: Box<Account<'info, RegistryData>>,
}

pub fn update_registry_data(ctx: Context<UpdateRegistryData>, args: UpdateRegistryArgs) -> Result<()> {
    check_str(&args.company_name, MAX_COMPANY_NAME_LEN, false)?;
    check_str(&args.address, MAX_ADDRESS_LEN, false)?;
    check_str(&args.phone, MAX_PHONE_LEN, false)?;
    check_str(&args.country, MAX_COUNTRY_LEN, false)?;
    check_str(&args.directors_names, MAX_DIRECTORS_LEN, false)?;
    check_str(&args.payer_name, MAX_PAYER_NAME_LEN, false)?;

    let now = Clock::get()?.unix_timestamp;
    let registry = &mut ctx.accounts.registry;
    registry.company_name = args.company_name;
    registry.address = args.address;
    registry.phone = args.phone;
    registry.country = args.country;
    registry.directors_names = args.directors_names;
    registry.payer_name = args.payer_name;
    registry.last_updated_by = ctx.accounts.admin.key();
    registry.last_updated_at = now;
    registry.update_count = registry.update_count.checked_add(1).ok_or(FactoryError::MathOverflow)?;

    emit!(AdministrativeConfigurationUpdated {
        scope: ConfigScope::Registry,
        entity_id: ctx.accounts.vault.entity_id,
        target: registry.key(),
        admin: ctx.accounts.admin.key(),
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseMinting<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump,
        has_one = mint
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_2022_program: Program<'info, Token2022>,
}

/// IRREVERSÍVEL: revoga a Mint Authority do token da entidade.
/// Depois disso `buy_tokens` deixa de funcionar para sempre neste cofre;
/// resgates, injeções de lucro e vesting (já cunhado) continuam operando.
pub fn close_minting(ctx: Context<CloseMinting>, confirm: bool) -> Result<()> {
    require!(confirm, FactoryError::ConfirmationRequired);
    require!(
        ctx.accounts.vault.status != VaultStatus::PendingActivation,
        FactoryError::InvalidVaultStatus
    );
    require!(!ctx.accounts.vault.minting_closed, FactoryError::MintingClosed);

    let entity_id_bytes = ctx.accounts.vault.entity_id.to_le_bytes();
    let vault_bump = [ctx.accounts.vault.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &entity_id_bytes, &vault_bump]];

    ctx.accounts.vault.minting_closed = true;

    token_2022::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            token_2022::SetAuthority {
                current_authority: ctx.accounts.vault.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            signer_seeds,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    emit!(AdministrativeConfigurationUpdated {
        scope: ConfigScope::MintAuthorityRevoked,
        entity_id: ctx.accounts.vault.entity_id,
        target: ctx.accounts.mint.key(),
        admin: ctx.accounts.admin.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
