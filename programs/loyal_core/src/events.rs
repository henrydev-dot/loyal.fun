//! Anchor events for every state transition, so indexers, leaderboards and
//! other dApps can compose on loyal.fun activity without reading raw accounts.

use anchor_lang::prelude::*;

#[event]
pub struct PointsIssued {
    pub merchant: Pubkey,
    pub user: Pubkey,
    pub points: u64,
    pub nonce: u64,
    pub streak_days: u32,
    pub ts: i64,
}

#[event]
pub struct PositionOpened {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub position: Pubkey,
    pub position_id: u64,
    pub stake: u64,
    pub leverage: u8,
    pub entry_price_1e6: u64,
    pub ts: i64,
}

#[event]
pub struct PositionClosed {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub position: Pubkey,
    pub stake: u64,
    pub exit_price_1e6: u64,
    pub payout_after_fee: u64,
    pub fee_burned: u64,
    pub pnl: i64,
    pub ts: i64,
}

#[event]
pub struct PositionLiquidated {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub position: Pubkey,
    pub liquidator: Pubkey,
    pub stake: u64,
    pub exit_price_1e6: u64,
    pub floor_payout: u64,
    pub bounty: u64,
    pub ts: i64,
}

#[event]
pub struct RewardListed {
    pub merchant: Pubkey,
    pub listing: Pubkey,
    pub listing_id: u64,
    pub price_points: u64,
    pub stock: u32,
}

#[event]
pub struct RewardPurchased {
    pub user: Pubkey,
    pub merchant: Pubkey,
    pub listing: Pubkey,
    pub price_points: u64,
    pub remaining_stock: u32,
    pub ts: i64,
}

#[event]
pub struct RewardRedeemed {
    pub user: Pubkey,
    pub merchant: Pubkey,
    pub listing: Pubkey,
    pub asset_id: Pubkey,
    pub ts: i64,
}

#[event]
pub struct BadgeClaimed {
    pub user: Pubkey,
    pub badge_id: u8,
    pub badge_mint: Pubkey,
    pub ts: i64,
}

#[event]
pub struct MerchantRegistered {
    pub merchant: Pubkey,
    pub authority: Pubkey,
    pub name: String,
}
