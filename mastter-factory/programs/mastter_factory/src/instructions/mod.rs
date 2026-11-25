pub mod admin;
pub mod buy;
pub mod initialize_pool;
pub mod inject_quote;
pub mod sell;

pub use admin::*;
pub use buy::*;
pub use initialize_pool::*;
pub use inject_quote::*;
pub use sell::*;

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::errors::CasaError;
use crate::math::Snapshot;
use crate::state::Pool;

/// Monta a fotografia a partir dos saldos REAIS das contas on-chain.
pub(crate) fn snapshot(
    pool: &Pool,
    token_mint: &Mint,
    token_vault: &TokenAccount,
    quote_vault: &TokenAccount,
) -> Result<Snapshot> {
    let circulating = token_mint
        .supply
        .checked_sub(token_vault.amount)
        .ok_or(CasaError::MathOverflow)?;
    Ok(Snapshot {
        minting_completed: pool.minting_completed,
        initial_price: pool.initial_price,
        token_decimals: pool.token_decimals,
        max_supply: pool.max_supply,
        minted_total: pool.minted_total,
        inventory: token_vault.amount,
        circulating,
        quote_reserve: quote_vault.amount,
        buy_fee_bps: pool.buy_fee_bps,
        sell_fee_bps: pool.sell_fee_bps,
    })
}
