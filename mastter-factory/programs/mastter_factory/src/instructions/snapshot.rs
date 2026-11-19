//! emit_vault_snapshot — visão contábil consolidada (somente leitura + evento).
use crate::constants::*;
use crate::errors::FactoryError;
use crate::events::*;
use crate::math::*;
use crate::oracle::load_prices;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct EmitVaultSnapshot<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump,
        has_one = ledger,
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    #[account(
        seeds = [SEED_LEDGER, vault.key().as_ref()],
        bump = vault.ledger_bump,
        has_one = vault
    )]
    pub ledger: Box<Account<'info, BackingLedger>>,
    /// CHECK: conta de preço SOL/USD; endereço fixado na Factory e conteúdo validado em `oracle::load_price`.
    #[account(address = config.sol_price_account @ FactoryError::InvalidOracleAccount)]
    pub sol_price_feed: UncheckedAccount<'info>,
    /// CHECK: conta de preço USDC/USD; endereço fixado na Factory e conteúdo validado em `oracle::load_price`.
    #[account(address = config.usdc_price_account @ FactoryError::InvalidOracleAccount)]
    pub usdc_price_feed: UncheckedAccount<'info>,
}

pub fn emit_vault_snapshot(ctx: Context<EmitVaultSnapshot>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &ctx.accounts.vault;
    let ledger = &ctx.accounts.ledger;
    let prices = load_prices(
        &ctx.accounts.config,
        &ctx.accounts.sol_price_feed.to_account_info(),
        &ctx.accounts.usdc_price_feed.to_account_info(),
        now,
    )?;
    let nav = value_floor(ledger.sol_backing, SOL_DECIMALS, prices.sol.mid)?
        .checked_add(value_floor(
            ledger.usdc_backing,
            ctx.accounts.config.usdc_decimals,
            prices.usdc.mid,
        )?)
        .ok_or(FactoryError::MathOverflow)?;
    let ref_supply = vault.reference_supply()? as u128;
    let (price_per_token, reserved, vesting_backing) = if ref_supply == 0 {
        (0u128, 0u128, 0u128)
    } else {
        let reserved = mul_div_floor(nav, vault.circulating_supply as u128, ref_supply)?;
        (
            mul_div_floor(nav, pow10(vault.decimals as u32)?, ref_supply)?,
            reserved,
            nav.checked_sub(reserved).ok_or(FactoryError::MathOverflow)?,
        )
    };

    emit!(VaultSnapshot {
        entity_id: vault.entity_id,
        vault: vault.key(),
        sol_backing: ledger.sol_backing,
        usdc_backing: ledger.usdc_backing,
        circulating_supply: vault.circulating_supply,
        vesting_locked_supply: vault.vesting_locked_supply,
        nav_nano_usd: nav,
        price_per_token_nano_usd: price_per_token,
        reserved_for_redemptions_nano_usd: reserved,
        vesting_backing_nano_usd: vesting_backing,
        sol_fees_collected: ledger.sol_fees_collected,
        usdc_fees_collected: ledger.usdc_fees_collected,
        sol_profit_injected: ledger.sol_profit_injected,
        usdc_profit_injected: ledger.usdc_profit_injected,
        timestamp: now,
    });
    Ok(())
}
