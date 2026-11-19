//! Instruções administrativas da Factory.
use crate::constants::*;
use crate::errors::FactoryError;
use crate::events::*;
use crate::program::MastterFactory;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::Mint as SplMint;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeFactoryArgs {
    pub oracle_program: Pubkey,
    pub sol_price_account: Pubkey,
    pub usdc_price_account: Pubkey,
    pub sol_feed_id: [u8; 32],
    pub usdc_feed_id: [u8; 32],
    pub max_price_age_secs: u64,
    pub max_conf_bps: u16,
    pub ops_utc_offset_secs: i32,
}

fn validate_oracle_params(max_price_age_secs: u64, max_conf_bps: u16) -> Result<()> {
    require!(
        max_price_age_secs > 0 && max_price_age_secs <= MAX_PRICE_AGE_LIMIT_SECS,
        FactoryError::InvalidOracleConfig
    );
    require!(
        max_conf_bps > 0 && max_conf_bps <= MAX_CONF_BPS_LIMIT,
        FactoryError::InvalidOracleConfig
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeFactory<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + FactoryConfig::INIT_SPACE,
        seeds = [SEED_CONFIG],
        bump
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    /// O próprio programa: usado para localizar a conta ProgramData.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ FactoryError::InvalidProgramData
    )]
    pub program: Program<'info, MastterFactory>,
    /// Somente a upgrade authority atual pode inicializar (anti front-running).
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key()) @ FactoryError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    /// Mint do USDC: obrigatoriamente SPL Token clássico (sem extensões).
    pub usdc_mint: Account<'info, SplMint>,
    /// CHECK: carteira de receita; validada como conta de sistema (wallet).
    #[account(owner = system_program::ID @ FactoryError::InvalidRevenueWallet)]
    pub revenue_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_factory(ctx: Context<InitializeFactory>, args: InitializeFactoryArgs) -> Result<()> {
    validate_oracle_params(args.max_price_age_secs, args.max_conf_bps)?;
    require!(args.oracle_program != Pubkey::default(), FactoryError::InvalidOracleConfig);
    require!(
        args.sol_price_account != Pubkey::default()
            && args.usdc_price_account != Pubkey::default()
            && args.sol_price_account != args.usdc_price_account
            && args.sol_feed_id != args.usdc_feed_id,
        FactoryError::InvalidOracleConfig
    );
    require!(
        ctx.accounts.revenue_wallet.key() != Pubkey::default(),
        FactoryError::InvalidRevenueWallet
    );

    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = Pubkey::default();
    config.revenue_wallet = ctx.accounts.revenue_wallet.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.usdc_decimals = ctx.accounts.usdc_mint.decimals;
    config.oracle_program = args.oracle_program;
    config.sol_price_account = args.sol_price_account;
    config.usdc_price_account = args.usdc_price_account;
    config.sol_feed_id = args.sol_feed_id;
    config.usdc_feed_id = args.usdc_feed_id;
    config.max_price_age_secs = args.max_price_age_secs;
    config.max_conf_bps = args.max_conf_bps;
    config.default_fee_bps = DEFAULT_PLATFORM_FEE_BPS;
    config.ops_utc_offset_secs = args.ops_utc_offset_secs;
    config.paused = false;
    config.entity_count = 0;
    config.bump = ctx.bumps.config;
    config.reserved = [0u8; 64];

    emit!(FactoryInitialized {
        admin: config.admin,
        revenue_wallet: config.revenue_wallet,
        usdc_mint: config.usdc_mint,
        oracle_program: config.oracle_program,
        timestamp: now,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateFactoryConfigArgs {
    pub oracle_program: Option<Pubkey>,
    pub sol_price_account: Option<Pubkey>,
    pub usdc_price_account: Option<Pubkey>,
    pub sol_feed_id: Option<[u8; 32]>,
    pub usdc_feed_id: Option<[u8; 32]>,
    pub max_price_age_secs: Option<u64>,
    pub max_conf_bps: Option<u16>,
    pub ops_utc_offset_secs: Option<i32>,
}

#[derive(Accounts)]
pub struct UpdateFactoryConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
    /// CHECK: nova carteira de receita padrão (opcional); validada como conta de sistema.
    #[account(owner = system_program::ID @ FactoryError::InvalidRevenueWallet)]
    pub new_revenue_wallet: Option<UncheckedAccount<'info>>,
}

pub fn update_factory_config(
    ctx: Context<UpdateFactoryConfig>,
    args: UpdateFactoryConfigArgs,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(v) = args.oracle_program {
        require!(v != Pubkey::default(), FactoryError::InvalidOracleConfig);
        config.oracle_program = v;
    }
    if let Some(v) = args.sol_price_account {
        config.sol_price_account = v;
    }
    if let Some(v) = args.usdc_price_account {
        config.usdc_price_account = v;
    }
    if let Some(v) = args.sol_feed_id {
        config.sol_feed_id = v;
    }
    if let Some(v) = args.usdc_feed_id {
        config.usdc_feed_id = v;
    }
    if let Some(v) = args.max_price_age_secs {
        config.max_price_age_secs = v;
    }
    if let Some(v) = args.max_conf_bps {
        config.max_conf_bps = v;
    }
    if let Some(v) = args.ops_utc_offset_secs {
        require!((-43_200..=50_400).contains(&v), FactoryError::InvalidAmount);
        config.ops_utc_offset_secs = v;
    }
    if let Some(w) = &ctx.accounts.new_revenue_wallet {
        require!(w.key() != Pubkey::default(), FactoryError::InvalidRevenueWallet);
        config.revenue_wallet = w.key();
    }
    validate_oracle_params(config.max_price_age_secs, config.max_conf_bps)?;
    require!(
        config.sol_price_account != Pubkey::default()
            && config.usdc_price_account != Pubkey::default()
            && config.sol_price_account != config.usdc_price_account
            && config.sol_feed_id != config.usdc_feed_id,
        FactoryError::InvalidOracleConfig
    );

    emit!(AdministrativeConfigurationUpdated {
        scope: ConfigScope::Factory,
        entity_id: 0,
        target: config.key(),
        admin: ctx.accounts.admin.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ FactoryError::Unauthorized
    )]
    pub config: Box<Account<'info, FactoryConfig>>,
}

/// Pausa emergencial global (afeta todos os cofres).
pub fn set_factory_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = paused;
    let now = Clock::get()?.unix_timestamp;
    if paused {
        emit!(VaultPaused {
            entity_id: 0,
            vault: config.key(),
            admin: ctx.accounts.admin.key(),
            factory_wide: true,
            timestamp: now,
        });
    } else {
        emit!(VaultResumed {
            entity_id: 0,
            vault: config.key(),
            admin: ctx.accounts.admin.key(),
            factory_wide: true,
            timestamp: now,
        });
    }
    Ok(())
}

/// Passo 1 da transferência de administração (two-step).
pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    require!(new_admin != Pubkey::default(), FactoryError::Unauthorized);
    ctx.accounts.config.pending_admin = new_admin;
    emit!(AdministrativeConfigurationUpdated {
        scope: ConfigScope::AdminTransfer,
        entity_id: 0,
        target: new_admin,
        admin: ctx.accounts.admin.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FactoryConfig>>,
}

/// Passo 2: o novo administrador aceita assinando.
pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.pending_admin != Pubkey::default(), FactoryError::NoPendingAdmin);
    require_keys_eq!(
        config.pending_admin,
        ctx.accounts.new_admin.key(),
        FactoryError::Unauthorized
    );
    config.admin = config.pending_admin;
    config.pending_admin = Pubkey::default();
    emit!(AdministrativeConfigurationUpdated {
        scope: ConfigScope::AdminTransfer,
        entity_id: 0,
        target: config.admin,
        admin: config.admin,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
