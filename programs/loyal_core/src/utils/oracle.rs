//! Price reads with staleness + confidence enforcement.
//!
//! Production path: Pyth pull oracle (`PriceUpdateV2` accounts posted by the
//! Pyth Solana Receiver). Test path (`--features mock-oracle`): a
//! program-owned [`crate::state::MockPrice`] account so PnL paths are
//! deterministic without a live oracle. The two paths are mutually exclusive
//! at compile time — a mock build can never ship reading real funds.

use anchor_lang::prelude::*;

use crate::constants::{MAX_CONF_RATIO, MAX_PRICE_AGE_SECS};
use crate::errors::LoyalError;
use crate::state::RiskVault;

/// Reads the vault's asset price scaled to 1e6 fixed point.
#[cfg(not(feature = "mock-oracle"))]
pub fn read_price_1e6(
    price_account: &AccountInfo,
    vault: &RiskVault,
    _vault_key: &Pubkey,
    clock: &Clock,
) -> Result<u64> {
    use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

    // Owner check: only accounts written by the Pyth receiver are trusted.
    require!(
        *price_account.owner == pyth_solana_receiver_sdk::ID,
        LoyalError::FeedMismatch
    );
    let data = price_account.try_borrow_data()?;
    let price_update = PriceUpdateV2::try_deserialize(&mut data.as_ref())?;

    // Feed id + staleness are enforced by the SDK helper.
    let price = price_update
        .get_price_no_older_than(clock, MAX_PRICE_AGE_SECS, &vault.pyth_feed_id)
        .map_err(|_| error!(LoyalError::StalePrice))?;

    require!(price.price > 0, LoyalError::InvalidPrice);
    // Reject wide confidence intervals: conf must stay under price / MAX_CONF_RATIO (5%).
    let conf_limit = (price.price as u128)
        .checked_div(MAX_CONF_RATIO as u128)
        .ok_or(LoyalError::MathOverflow)?;
    require!(
        (price.conf as u128) <= conf_limit,
        LoyalError::LowConfidencePrice
    );

    scale_to_1e6(price.price, price.exponent)
}

/// Mock path: reads the vault's MockPrice PDA (owner-checked to this program).
#[cfg(feature = "mock-oracle")]
pub fn read_price_1e6(
    price_account: &AccountInfo,
    _vault: &RiskVault,
    vault_key: &Pubkey,
    clock: &Clock,
) -> Result<u64> {
    use crate::state::MockPrice;

    require!(
        *price_account.owner == crate::ID,
        LoyalError::FeedMismatch
    );
    let data = price_account.try_borrow_data()?;
    let mock = MockPrice::try_deserialize(&mut data.as_ref())?;
    require!(mock.vault == *vault_key, LoyalError::FeedMismatch);
    let age = clock
        .unix_timestamp
        .checked_sub(mock.publish_time)
        .ok_or(LoyalError::MathOverflow)?;
    require!(age <= MAX_PRICE_AGE_SECS as i64, LoyalError::StalePrice);
    require!(mock.price_1e6 > 0, LoyalError::InvalidPrice);
    Ok(mock.price_1e6)
}

/// Converts a Pyth (price, exponent) pair into u64 1e6 fixed point.
pub fn scale_to_1e6(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, LoyalError::InvalidPrice);
    let price = price as u128;
    // target scale is 1e6, pyth gives price * 10^exponent
    let shift = 6i32
        .checked_add(exponent)
        .ok_or(LoyalError::MathOverflow)?;
    let scaled = if shift >= 0 {
        price
            .checked_mul(10u128.pow(shift as u32))
            .ok_or(LoyalError::MathOverflow)?
    } else {
        price
            .checked_div(10u128.pow((-shift) as u32))
            .ok_or(LoyalError::MathOverflow)?
    };
    require!(scaled > 0, LoyalError::InvalidPrice);
    u64::try_from(scaled).map_err(|_| error!(LoyalError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_typical_pyth_exponent() {
        // BTC at $65,432.10 with expo -8: 6543210000000 * 10^-8
        assert_eq!(scale_to_1e6(6_543_210_000_000, -8).unwrap(), 65_432_100_000);
    }

    #[test]
    fn scales_positive_exponent() {
        assert_eq!(scale_to_1e6(3, 2).unwrap(), 300_000_000);
    }

    #[test]
    fn rejects_nonpositive() {
        assert!(scale_to_1e6(0, -8).is_err());
        assert!(scale_to_1e6(-5, -8).is_err());
    }
}
