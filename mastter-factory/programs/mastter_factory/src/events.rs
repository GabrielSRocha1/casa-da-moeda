//! Eventos on-chain para auditoria e indexação externa.
use crate::state::{ConfigScope, PaymentAsset};
use anchor_lang::prelude::*;

#[event]
pub struct FactoryInitialized {
    pub admin: Pubkey,
    pub revenue_wallet: Pubkey,
    pub usdc_mint: Pubkey,
    pub oracle_program: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EntityVaultInitialized {
    pub entity_id: u64,
    pub contract_number: u64,
    pub vault: Pubkey,
    pub registry: Pubkey,
    pub authority: Pubkey,
    pub verum_wallet: Pubkey,
    pub revenue_wallet: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub decimals: u8,
    pub hard_cap: u64,
    pub min_buy: u64,
    pub max_buy: u64,
    pub max_wallet: u64,
    pub platform_fee_bps: u16,
    pub initial_pool_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct EntityVaultActivated {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub sol_treasury: Pubkey,
    pub usdc_treasury: Pubkey,
    pub vesting: Pubkey,
    pub vesting_allocation: u64,
    pub vesting_cliff_ts: i64,
    pub vesting_end_ts: i64,
    pub initial_pool_amount: u64,
    pub token_uri: String,
    pub image_sha256: [u8; 32],
    pub funder: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokenPurchased {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub buyer: Pubkey,
    pub asset: PaymentAsset,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
    pub tokens_minted: u64,
    pub circulating_supply: u64,
    pub reference_supply: u64,
    pub sol_backing: u64,
    pub usdc_backing: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokenRedeemed {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub seller: Pubkey,
    pub asset: PaymentAsset,
    pub tokens_burned: u64,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
    pub circulating_supply: u64,
    pub reference_supply: u64,
    pub sol_backing: u64,
    pub usdc_backing: u64,
    pub timestamp: i64,
}

#[event]
pub struct ProfitInjected {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub injector: Pubkey,
    pub origin: String,
    pub reference_id: u64,
    pub asset: PaymentAsset,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
    pub sol_backing: u64,
    pub usdc_backing: u64,
    pub reference_supply: u64,
    pub local_hour: u8,
    pub local_weekday: u8,
    pub within_recommended_window: bool,
    pub timestamp: i64,
}

#[event]
pub struct VestedTokensClaimed {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub beneficiary: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub total_released: u64,
    pub remaining: u64,
    pub timestamp: i64,
}

#[event]
pub struct PlatformFeeCollected {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub payer: Pubkey,
    pub revenue_wallet: Pubkey,
    pub asset: PaymentAsset,
    pub fee_amount: u64,
    pub fee_bps: u16,
    /// 0 = compra, 1 = resgate, 2 = injeção de lucro
    pub operation: u8,
    pub timestamp: i64,
}

#[event]
pub struct HardCapReached {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub hard_cap: u64,
    pub circulating_supply: u64,
    pub vesting_locked_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultPaused {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub factory_wide: bool,
    pub timestamp: i64,
}

#[event]
pub struct VaultResumed {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub factory_wide: bool,
    pub timestamp: i64,
}

#[event]
pub struct AdministrativeConfigurationUpdated {
    pub scope: ConfigScope,
    pub entity_id: u64,
    pub target: Pubkey,
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VaultSnapshot {
    pub entity_id: u64,
    pub vault: Pubkey,
    pub sol_backing: u64,
    pub usdc_backing: u64,
    pub circulating_supply: u64,
    pub vesting_locked_supply: u64,
    /// NAV total em nano-USD (preço médio do oráculo).
    pub nav_nano_usd: u128,
    /// Preço por token inteiro em nano-USD.
    pub price_per_token_nano_usd: u128,
    /// Parcela do lastro reservada para resgates do supply circulante (nano-USD).
    pub reserved_for_redemptions_nano_usd: u128,
    /// Parcela do lastro vinculada aos tokens bloqueados em vesting (nano-USD).
    pub vesting_backing_nano_usd: u128,
    pub sol_fees_collected: u64,
    pub usdc_fees_collected: u64,
    pub sol_profit_injected: u64,
    pub usdc_profit_injected: u64,
    pub timestamp: i64,
}
