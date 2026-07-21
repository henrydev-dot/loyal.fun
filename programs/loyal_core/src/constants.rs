//! Seeds, scales and protocol-wide constants.

/// PDA seed for the global [`crate::state::Config`] account.
pub const CONFIG_SEED: &[u8] = b"config";
/// PDA seed for the $LOYAL Token-2022 mint.
pub const LOYAL_MINT_SEED: &[u8] = b"loyal-mint";
/// PDA seed for [`crate::state::Merchant`] accounts.
pub const MERCHANT_SEED: &[u8] = b"merchant";
/// PDA seed for [`crate::state::UserProfile`] accounts.
pub const USER_SEED: &[u8] = b"user";
/// PDA seed for issuance-nonce replay-guard marker accounts.
pub const NONCE_SEED: &[u8] = b"nonce";
/// PDA seed for [`crate::state::RiskVault`] accounts.
pub const VAULT_SEED: &[u8] = b"vault";
/// PDA seed for [`crate::state::Position`] accounts.
pub const POSITION_SEED: &[u8] = b"position";
/// PDA seed for [`crate::state::RewardListing`] accounts.
pub const LISTING_SEED: &[u8] = b"listing";
/// PDA seed for [`crate::state::RedemptionReceipt`] accounts.
pub const RECEIPT_SEED: &[u8] = b"receipt";
/// PDA seed for per-badge-type soulbound Token-2022 mints.
pub const BADGE_MINT_SEED: &[u8] = b"badge-mint";
/// PDA seed for the per-vault mock price account (tests only).
pub const MOCK_PRICE_SEED: &[u8] = b"mock-price";

/// All prices and multipliers are fixed-point with 6 decimals.
pub const PRICE_SCALE: u128 = 1_000_000;
/// Hard cap on the settlement multiplier: 5.0x, in 1e6 fixed point.
pub const MAX_MULTIPLIER_1E6: u128 = 5_000_000;
/// A position becomes liquidatable when its multiplier falls to 0.2x or below.
pub const LIQUIDATION_MULTIPLIER_1E6: u128 = 200_000;
/// Liquidator bounty: 1% of the position stake (in basis points).
pub const LIQUIDATOR_BOUNTY_BPS: u64 = 100;
/// Basis-point denominator.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Oldest acceptable Pyth price when opening/closing/liquidating (seconds).
pub const MAX_PRICE_AGE_SECS: u64 = 60;
/// Reject a Pyth price whose confidence interval exceeds price / this divisor
/// (20 => conf must be under 5% of price).
pub const MAX_CONF_RATIO: u64 = 20;

/// A signed QR is valid for at most this many seconds past its `expiry_ts`
/// clock skew allowance. (The expiry itself is chosen by the merchant signer,
/// typically now + 60s.)
pub const MAX_QR_TTL_SECS: i64 = 600;

/// Earn within this window (48h) to extend the streak.
pub const STREAK_WINDOW_SECS: i64 = 48 * 60 * 60;

/// $LOYAL has 0 decimals: 1 token = 1 point. Keeps UX integer-only.
pub const LOYAL_DECIMALS: u8 = 0;

/// SPL Noop program (log wrapper used by account compression).
pub const SPL_NOOP_ID: anchor_lang::prelude::Pubkey =
    anchor_lang::solana_program::pubkey!("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
/// SPL Account Compression program.
pub const SPL_ACCOUNT_COMPRESSION_ID: anchor_lang::prelude::Pubkey =
    anchor_lang::solana_program::pubkey!("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

/// Tier thresholds on lifetime earned points.
pub const TIER_SILVER_EARNED: u64 = 1_000;
pub const TIER_GOLD_EARNED: u64 = 5_000;
pub const TIER_DEGEN_EARNED: u64 = 20_000;
