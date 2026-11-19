//! Aritmética segura (checked) usada em todo o protocolo.
use crate::constants::*;
use crate::errors::FactoryError;
use anchor_lang::prelude::*;

pub fn pow10(exp: u32) -> Result<u128> {
    10u128.checked_pow(exp).ok_or_else(|| error!(FactoryError::MathOverflow))
}

/// floor(a * b / c)
pub fn mul_div_floor(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c > 0, FactoryError::MathOverflow);
    a.checked_mul(b)
        .ok_or(FactoryError::MathOverflow)?
        .checked_div(c)
        .ok_or_else(|| error!(FactoryError::MathOverflow))
}

/// ceil(a * b / c)
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c > 0, FactoryError::MathOverflow);
    let prod = a.checked_mul(b).ok_or(FactoryError::MathOverflow)?;
    let q = prod / c;
    if prod % c == 0 {
        Ok(q)
    } else {
        q.checked_add(1).ok_or_else(|| error!(FactoryError::MathOverflow))
    }
}

pub fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(FactoryError::MathOverflow))
}

/// Taxa de plataforma: floor(amount * bps / 10_000). Cobrada uma única vez por operação.
pub fn fee_amount(amount: u64, fee_bps: u16) -> Result<u64> {
    to_u64(mul_div_floor(amount as u128, fee_bps as u128, BPS_DENOMINATOR as u128)?)
}

/// Valor em nano-USD de `amount` unidades-base de um ativo com `decimals`,
/// dado o preço (nano-USD por unidade inteira). Arredonda para baixo.
pub fn value_floor(amount: u64, decimals: u8, price_nano: u128) -> Result<u128> {
    mul_div_floor(amount as u128, price_nano, pow10(decimals as u32)?)
}

/// Igual a `value_floor`, arredondando para cima.
pub fn value_ceil(amount: u64, decimals: u8, price_nano: u128) -> Result<u128> {
    mul_div_ceil(amount as u128, price_nano, pow10(decimals as u32)?)
}

/// Quantidade total já liberada pelo cronograma de vesting no instante `now`.
/// 0 antes da carência; linear entre `cliff_ts` e `end_ts`; 100% a partir de `end_ts`.
pub fn vested_amount(total: u64, cliff_ts: i64, end_ts: i64, now: i64) -> Result<u64> {
    if now < cliff_ts {
        return Ok(0);
    }
    if now >= end_ts {
        return Ok(total);
    }
    let elapsed = now.checked_sub(cliff_ts).ok_or(FactoryError::MathOverflow)? as u128;
    let duration = end_ts.checked_sub(cliff_ts).ok_or(FactoryError::MathOverflow)? as u128;
    to_u64(mul_div_floor(total as u128, elapsed, duration)?)
}

/// Hora local (0-23) e dia da semana (0 = domingo ... 6 = sábado) a partir do
/// timestamp on-chain e do offset UTC operacional configurado.
pub fn local_hour_and_weekday(unix_ts: i64, utc_offset_secs: i32) -> (u8, u8) {
    let local = unix_ts.saturating_add(utc_offset_secs as i64);
    let days = local.div_euclid(SECONDS_PER_DAY);
    let secs = local.rem_euclid(SECONDS_PER_DAY);
    let hour = (secs / 3600) as u8;
    // 1970-01-01 foi uma quinta-feira (4).
    let weekday = (days + 4).rem_euclid(7) as u8;
    (hour, weekday)
}

pub fn is_recommended_window(hour: u8, weekday: u8) -> bool {
    (1..=5).contains(&weekday) && hour >= RECOMMENDED_INJECTION_HOUR
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_is_119_bps_floor() {
        assert_eq!(fee_amount(1_000_000_000, 119).unwrap(), 11_900_000);
        assert_eq!(fee_amount(100_000_000, 119).unwrap(), 1_190_000);
        assert_eq!(fee_amount(84, 119).unwrap(), 0);
        assert_eq!(fee_amount(u64::MAX, 500).unwrap(), (u64::MAX as u128 * 500 / 10_000) as u64);
    }

    #[test]
    fn mul_div_rounding_and_overflow() {
        assert_eq!(mul_div_floor(7, 3, 2).unwrap(), 10);
        assert_eq!(mul_div_ceil(7, 3, 2).unwrap(), 11);
        assert_eq!(mul_div_ceil(8, 3, 2).unwrap(), 12);
        assert!(mul_div_floor(1, 1, 0).is_err());
        assert!(mul_div_floor(u128::MAX, 2, 1).is_err());
        assert!(to_u64(u64::MAX as u128 + 1).is_err());
    }

    #[test]
    fn vesting_schedule() {
        let start = 1_700_000_000i64;
        let cliff = start + VESTING_CLIFF_SECS;
        let end = start + VESTING_TOTAL_SECS;
        let total = 7_500_000_000_000u64;
        assert_eq!(vested_amount(total, cliff, end, start).unwrap(), 0);
        assert_eq!(vested_amount(total, cliff, end, cliff - 1).unwrap(), 0);
        assert_eq!(vested_amount(total, cliff, end, cliff).unwrap(), 0);
        assert_eq!(vested_amount(total, cliff, end, cliff + 55 * SECONDS_PER_DAY).unwrap(), total / 10);
        assert_eq!(vested_amount(total, cliff, end, cliff + 275 * SECONDS_PER_DAY).unwrap(), total / 2);
        assert_eq!(vested_amount(total, cliff, end, end).unwrap(), total);
        assert_eq!(vested_amount(total, cliff, end, end + 10_000_000).unwrap(), total);
        assert_eq!(vested_amount(u64::MAX, cliff, end, end - 1).unwrap() < u64::MAX, true);
    }

    #[test]
    fn local_time_and_recommended_window() {
        // 2026-11-16 22:30:00 UTC (segunda-feira) => 19:30 em UTC-3
        let ts = 1_794_868_200i64;
        let (h, wd) = local_hour_and_weekday(ts, -10_800);
        assert_eq!((h, wd), (19, 1));
        assert!(is_recommended_window(h, wd));
        // 18:59 local: fora da janela recomendada
        let (h, wd) = local_hour_and_weekday(ts - 31 * 60, -10_800);
        assert_eq!((h, wd), (18, 1));
        assert!(!is_recommended_window(h, wd));
        // sábado 20h local: fora (não é dia útil)
        let (h, wd) = local_hour_and_weekday(ts + 5 * 86_400 + 1800, -10_800);
        assert_eq!((h, wd), (20, 6));
        assert!(!is_recommended_window(h, wd));
        // epoch: quinta-feira 00h UTC
        assert_eq!(local_hour_and_weekday(0, 0), (0, 4));
    }
}
