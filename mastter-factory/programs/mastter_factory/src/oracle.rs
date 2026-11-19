//! Integração on-chain com o oráculo Pyth (Pull Oracle / Solana Receiver).
//!
//! As contas `PriceUpdateV2` são desserializadas manualmente (layout Borsh
//! público do `pyth-solana-receiver-sdk`), sem dependência do SDK, e validadas por:
//!   1. owner == programa de oráculo configurado na Factory;
//!   2. endereço == conta de preço fixada na Factory (constraint `address`);
//!   3. discriminador Anchor de `PriceUpdateV2`;
//!   4. feed_id == feed configurado;
//!   5. verificação completa (VerificationLevel::Full);
//!   6. preço positivo, idade máxima e intervalo de confiança máximo.
//!
//! Proteção contra manipulação/arbitragem: o protocolo sempre usa o lado
//! desfavorável ao usuário do intervalo de confiança (lo = price - conf,
//! hi = price + conf) em cada perna da operação.
use crate::constants::*;
use crate::errors::FactoryError;
use crate::math::pow10;
use anchor_lang::prelude::*;

/// sha256("account:PriceUpdateV2")[..8]
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

/// Preço normalizado em nano-USD por unidade inteira do ativo.
#[derive(Clone, Copy, Debug)]
pub struct NormalizedPrice {
    /// price - conf
    pub lo: u128,
    /// price
    pub mid: u128,
    /// price + conf
    pub hi: u128,
    pub publish_time: i64,
}

fn scale_to_nano(value: u128, exponent: i32) -> Result<u128> {
    // nano = value * 10^(exponent + 9)
    let shift = exponent
        .checked_add(VALUE_SCALE_EXP)
        .ok_or(FactoryError::MathOverflow)?;
    if shift >= 0 {
        value
            .checked_mul(pow10(shift as u32)?)
            .ok_or_else(|| error!(FactoryError::MathOverflow))
    } else {
        Ok(value / pow10(shift.unsigned_abs())?)
    }
}

pub fn load_price(
    account: &AccountInfo,
    oracle_program: &Pubkey,
    expected_feed_id: &[u8; 32],
    now: i64,
    max_age_secs: u64,
    max_conf_bps: u16,
) -> Result<NormalizedPrice> {
    require_keys_eq!(*account.owner, *oracle_program, FactoryError::InvalidOracleAccount);
    let data = account.try_borrow_data()?;
    require!(data.len() > 8, FactoryError::InvalidOracleAccount);
    require!(
        data[..8] == PRICE_UPDATE_V2_DISCRIMINATOR,
        FactoryError::InvalidOracleAccount
    );
    let mut slice: &[u8] = &data[8..];
    let update = PriceUpdateV2::deserialize(&mut slice)
        .map_err(|_| error!(FactoryError::InvalidOracleAccount))?;

    require!(
        update.verification_level == VerificationLevel::Full,
        FactoryError::OracleNotFullyVerified
    );
    let msg = update.price_message;
    require!(msg.feed_id == *expected_feed_id, FactoryError::OracleFeedMismatch);
    require!(msg.price > 0, FactoryError::InvalidOraclePrice);
    require!(
        (-18..=0).contains(&msg.exponent),
        FactoryError::InvalidOraclePrice
    );

    // Idade: rejeita preços antigos e preços com timestamp futuro além de 10 s.
    let age = now.checked_sub(msg.publish_time).ok_or(FactoryError::MathOverflow)?;
    require!(age >= -10, FactoryError::StaleOraclePrice);
    require!(age <= max_age_secs as i64, FactoryError::StaleOraclePrice);

    // Intervalo de confiança: conf / price <= max_conf_bps.
    let price = msg.price as u128;
    let conf = msg.conf as u128;
    let lhs = conf.checked_mul(BPS_DENOMINATOR as u128).ok_or(FactoryError::MathOverflow)?;
    let rhs = price.checked_mul(max_conf_bps as u128).ok_or(FactoryError::MathOverflow)?;
    require!(lhs <= rhs, FactoryError::OracleConfidenceTooWide);

    let lo_raw = price.checked_sub(conf).ok_or(FactoryError::InvalidOraclePrice)?;
    let hi_raw = price.checked_add(conf).ok_or(FactoryError::MathOverflow)?;
    let lo = scale_to_nano(lo_raw, msg.exponent)?;
    let mid = scale_to_nano(price, msg.exponent)?;
    let hi = scale_to_nano(hi_raw, msg.exponent)?;
    require!(lo > 0, FactoryError::InvalidOraclePrice);

    Ok(NormalizedPrice { lo, mid, hi, publish_time: msg.publish_time })
}

/// Par de preços (SOL/USD e USDC/USD) validados.
pub struct Prices {
    pub sol: NormalizedPrice,
    pub usdc: NormalizedPrice,
}

pub fn load_prices(
    config: &crate::state::FactoryConfig,
    sol_price_feed: &AccountInfo,
    usdc_price_feed: &AccountInfo,
    now: i64,
) -> Result<Prices> {
    let sol = load_price(
        sol_price_feed,
        &config.oracle_program,
        &config.sol_feed_id,
        now,
        config.max_price_age_secs,
        config.max_conf_bps,
    )?;
    let usdc = load_price(
        usdc_price_feed,
        &config.oracle_program,
        &config.usdc_feed_id,
        now,
        config.max_price_age_secs,
        config.max_conf_bps,
    )?;
    Ok(Prices { sol, usdc })
}
