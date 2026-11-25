use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::CasaError;
use crate::events::PoolInitialized;
use crate::math::{MAX_FEE_BPS, MAX_TOKEN_DECIMALS};
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InitializePoolParams {
    pub token_decimals: u8,
    /// Teto de emissão em unidades atômicas.
    pub max_supply: u64,
    /// Unidades atômicas de quote por 1 token inteiro × 1e9.
    /// Ex.: US$ 0,001 com USDC (6 casas) = 1_000 × 1e9.
    pub initial_price: u64,
    pub buy_fee_bps: u16,
    pub sell_fee_bps: u16,
}

/// Cria o token do projeto (supply 0, autoridade de cunhagem = PDA do cofre,
/// sem autoridade de congelamento) e os dois cofres.
#[derive(Accounts)]
#[instruction(params: InitializePoolParams)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// Novo keypair: o token nasce aqui, sem nenhum token cunhado.
    #[account(
        init,
        payer = authority,
        mint::decimals = params.token_decimals,
        mint::authority = pool,
        mint::token_program = token_program,
    )]
    pub token_mint: Box<Account<'info, Mint>>,

    /// Moeda de cotação (USDC). Programa SPL Token clássico: sem taxa de
    /// transferência nem hooks que quebrariam a contabilidade.
    #[account(mint::token_program = token_program)]
    pub quote_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        seeds = [TOKEN_VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub token_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = authority,
        seeds = [QUOTE_VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_initialize_pool(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
    require!(params.token_decimals <= MAX_TOKEN_DECIMALS, CasaError::InvalidDecimals);
    require!(params.max_supply > 0, CasaError::InvalidMaxSupply);
    require!(params.initial_price > 0, CasaError::InvalidPrice);
    require!(
        params.buy_fee_bps <= MAX_FEE_BPS && params.sell_fee_bps <= MAX_FEE_BPS,
        CasaError::InvalidFee
    );
    require_keys_neq!(ctx.accounts.token_mint.key(), ctx.accounts.quote_mint.key(), CasaError::SameMint);

    let pool = &mut ctx.accounts.pool;
    pool.authority = ctx.accounts.authority.key();
    pool.pending_authority = Pubkey::default();
    pool.token_mint = ctx.accounts.token_mint.key();
    pool.quote_mint = ctx.accounts.quote_mint.key();
    pool.token_vault = ctx.accounts.token_vault.key();
    pool.quote_vault = ctx.accounts.quote_vault.key();
    pool.token_decimals = params.token_decimals;
    pool.quote_decimals = ctx.accounts.quote_mint.decimals;
    pool.max_supply = params.max_supply;
    pool.minted_total = 0;
    pool.initial_price = params.initial_price;
    pool.buy_fee_bps = params.buy_fee_bps;
    pool.sell_fee_bps = params.sell_fee_bps;
    pool.minting_completed = false;
    pool.minting_completed_at = 0;
    pool.paused = false;
    pool.total_quote_from_buys = 0;
    pool.total_quote_injected = 0;
    pool.total_quote_paid_on_sells = 0;
    pool.total_tokens_bought = 0;
    pool.total_tokens_sold = 0;
    pool.deposit_count = 0;
    pool.bump = ctx.bumps.pool;
    pool.token_vault_bump = ctx.bumps.token_vault;
    pool.quote_vault_bump = ctx.bumps.quote_vault;

    emit!(PoolInitialized {
        pool: pool.key(),
        authority: pool.authority,
        token_mint: pool.token_mint,
        quote_mint: pool.quote_mint,
        max_supply: pool.max_supply,
        initial_price: pool.initial_price,
        buy_fee_bps: pool.buy_fee_bps,
        sell_fee_bps: pool.sell_fee_bps,
    });
    Ok(())
}
