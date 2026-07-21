//! Pure settlement math. Everything is u128 fixed-point (1e6) internally,
//! no floats, all operations checked. Unit-tested at the bottom of the file.

use crate::constants::*;
use crate::errors::LoyalError;
use anchor_lang::prelude::*;

/// Settlement multiplier in 1e6 fixed point:
/// `clamp(1 + leverage * (exit - entry) / entry, 0, 5)`.
pub fn settlement_multiplier_1e6(
    entry_price_1e6: u64,
    exit_price_1e6: u64,
    leverage: u8,
) -> Result<u128> {
    require!(entry_price_1e6 > 0, LoyalError::InvalidPrice);
    require!(exit_price_1e6 > 0, LoyalError::InvalidPrice);

    let entry = entry_price_1e6 as i128;
    let exit = exit_price_1e6 as i128;
    let lev = leverage as i128;

    // delta_1e6 = (exit - entry) * 1e6 / entry  — signed, 1e6 scale.
    let delta_1e6 = exit
        .checked_sub(entry)
        .ok_or(LoyalError::MathOverflow)?
        .checked_mul(PRICE_SCALE as i128)
        .ok_or(LoyalError::MathOverflow)?
        .checked_div(entry)
        .ok_or(LoyalError::MathOverflow)?;

    let raw = (PRICE_SCALE as i128)
        .checked_add(lev.checked_mul(delta_1e6).ok_or(LoyalError::MathOverflow)?)
        .ok_or(LoyalError::MathOverflow)?;

    Ok(raw.clamp(0, MAX_MULTIPLIER_1E6 as i128) as u128)
}

/// Gross payout (before fee) for a position at a given exit price.
pub fn gross_payout(
    stake: u64,
    entry_price_1e6: u64,
    exit_price_1e6: u64,
    leverage: u8,
) -> Result<u64> {
    let multiplier = settlement_multiplier_1e6(entry_price_1e6, exit_price_1e6, leverage)?;
    let payout = (stake as u128)
        .checked_mul(multiplier)
        .ok_or(LoyalError::MathOverflow)?
        .checked_div(PRICE_SCALE)
        .ok_or(LoyalError::MathOverflow)?;
    u64::try_from(payout).map_err(|_| error!(LoyalError::MathOverflow))
}

/// Settlement fee (burned), floor division so dust favors the user.
pub fn settlement_fee(payout: u64, fee_bps: u16) -> Result<u64> {
    let fee = (payout as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(LoyalError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(LoyalError::MathOverflow)?;
    u64::try_from(fee).map_err(|_| error!(LoyalError::MathOverflow))
}

/// True when the position may be liquidated permissionlessly
/// (multiplier has decayed to 0.2x or below).
pub fn is_liquidatable(
    entry_price_1e6: u64,
    current_price_1e6: u64,
    leverage: u8,
) -> Result<bool> {
    let multiplier = settlement_multiplier_1e6(entry_price_1e6, current_price_1e6, leverage)?;
    Ok(multiplier <= LIQUIDATION_MULTIPLIER_1E6)
}

/// Liquidator bounty: 1% of stake.
pub fn liquidator_bounty(stake: u64) -> Result<u64> {
    let bounty = (stake as u128)
        .checked_mul(LIQUIDATOR_BOUNTY_BPS as u128)
        .ok_or(LoyalError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(LoyalError::MathOverflow)?;
    u64::try_from(bounty).map_err(|_| error!(LoyalError::MathOverflow))
}

/// Exposure contributed by a position = stake * leverage.
pub fn exposure(stake: u64, leverage: u8) -> Result<u64> {
    stake
        .checked_mul(leverage as u64)
        .ok_or(error!(LoyalError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: u64 = 1_000_000; // entry price 1.0

    #[test]
    fn flat_price_returns_stake() {
        assert_eq!(gross_payout(1_000, P, P, 5).unwrap(), 1_000);
    }

    #[test]
    fn win_10pct_at_5x() {
        // +10% at 5x => 1.5x
        assert_eq!(gross_payout(1_000, P, 1_100_000, 5).unwrap(), 1_500);
    }

    #[test]
    fn loss_10pct_at_2x() {
        // -10% at 2x => 0.8x
        assert_eq!(gross_payout(1_000, P, 900_000, 2).unwrap(), 800);
    }

    #[test]
    fn clamps_at_five_x() {
        // +200% at 5x => raw 11x, clamped to 5x
        assert_eq!(gross_payout(1_000, P, 3_000_000, 5).unwrap(), 5_000);
    }

    #[test]
    fn clamps_at_zero() {
        // -50% at 5x => raw -1.5x, clamped to 0
        assert_eq!(gross_payout(1_000, P, 500_000, 5).unwrap(), 0);
    }

    #[test]
    fn fee_two_percent() {
        assert_eq!(settlement_fee(1_500, 200).unwrap(), 30);
    }

    #[test]
    fn fee_rounds_down() {
        assert_eq!(settlement_fee(99, 200).unwrap(), 1); // 1.98 -> 1
    }

    #[test]
    fn liquidation_threshold_5x() {
        // 5x: 1 + 5Δ <= 0.2  =>  Δ <= -16%
        assert!(!is_liquidatable(P, 850_000, 5).unwrap()); // -15%: safe
        assert!(is_liquidatable(P, 840_000, 5).unwrap()); // -16%: liquidatable
    }

    #[test]
    fn liquidation_threshold_1x() {
        // 1x: needs -80%
        assert!(!is_liquidatable(P, 210_000, 1).unwrap());
        assert!(is_liquidatable(P, 200_000, 1).unwrap());
    }

    #[test]
    fn no_overflow_on_extreme_values() {
        assert_eq!(
            gross_payout(u64::MAX / 8, P, 100_000_000_000, 5).unwrap(),
            u64::MAX / 8 * 5
        );
    }

    #[test]
    fn bounty_one_percent() {
        assert_eq!(liquidator_bounty(1_000).unwrap(), 10);
        assert_eq!(liquidator_bounty(99).unwrap(), 0);
    }
}
