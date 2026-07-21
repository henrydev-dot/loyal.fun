use anchor_lang::prelude::*;

/// Global protocol configuration. Singleton PDA: seeds = ["config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// The single coalition-wide $LOYAL Token-2022 mint (PDA, authority = config).
    pub loyal_mint: Pubkey,
    /// The transfer-hook program enforcing the closed loop.
    pub hook_program: Pubkey,
    /// Bubblegum merkle tree used for coupon cNFTs (set post-deploy).
    pub coupon_tree: Pubkey,
    /// Settlement fee burned on position close, in basis points (e.g. 200 = 2%).
    pub fee_bps: u16,
    /// Maximum leverage allowed by governance (positions also restrict to {1,2,5}).
    pub max_leverage: u8,
    /// Per-position stake ceiling (points).
    pub max_position_stake: u64,
    /// Per-transaction issuance ceiling (points) — caps blast radius of a leaked QR signer.
    pub max_issue_per_tx: u64,
    /// Sum of `stake * leverage` across all open positions.
    pub global_open_exposure: u64,
    /// Hard cap on `global_open_exposure`; new positions are rejected above it.
    pub max_global_exposure: u64,
    /// Lifetime points minted (issuance + winnings + bounties).
    pub total_minted: u64,
    /// Lifetime points burned (stakes, losses, fees, reward purchases).
    pub total_burned: u64,
    /// Emergency stop for all user-facing instructions.
    pub paused: bool,
    pub bump: u8,
    pub mint_bump: u8,
}

/// One record per participating shop. PDA: seeds = ["merchant", authority].
#[account]
#[derive(InitSpace)]
pub struct Merchant {
    /// Wallet that manages this merchant (panel login key).
    pub authority: Pubkey,
    /// Off-chain QR signing key (ed25519). Kept separate from `authority`
    /// so the hot key on the shop tablet can be rotated without re-registering.
    pub qr_signer: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(16)]
    pub category: String,
    /// Lifetime points issued by this merchant.
    pub total_issued: u64,
    /// Committed reward budget (points). Issuance is accounted against it;
    /// MVP treats it as a counter, the economics doc explains settlement.
    pub reward_budget: u64,
    /// Monotonic id source for this merchant's listings.
    pub listing_count: u64,
    /// Lifetime coupons redeemed at this merchant.
    pub coupons_redeemed: u64,
    pub active: bool,
    pub bump: u8,
}

/// Per-wallet loyalty profile. PDA: seeds = ["user", wallet].
#[account]
#[derive(InitSpace)]
pub struct UserProfile {
    pub wallet: Pubkey,
    pub earned_total: u64,
    pub spent_total: u64,
    pub streak_days: u32,
    pub last_earn_ts: i64,
    /// 0 Bronze, 1 Silver, 2 Gold, 3 Degen.
    pub tier: u8,
    /// Cumulative realized PnL from the risk vaults (can go negative).
    pub degen_score: i64,
    /// Monotonic id source for this user's positions.
    pub position_count: u64,
    pub positions_closed: u64,
    pub times_liquidated: u32,
    /// Bitmask of badge conditions the user has unlocked (see `Badge`).
    pub badge_eligible: u32,
    /// Bitmask of badges actually claimed (soulbound token minted).
    pub badges: u32,
    pub bump: u8,
}

/// Replay guard: `init` fails if the same (merchant, nonce) is used twice.
/// PDA: seeds = ["nonce", merchant, nonce_le_bytes].
#[account]
#[derive(InitSpace)]
pub struct IssuanceNonce {
    pub merchant: Pubkey,
    pub nonce: u64,
    pub used_at: i64,
}

/// A synthetic-exposure vault tracking one Pyth feed. PDA: seeds = ["vault", symbol].
#[account]
#[derive(InitSpace)]
pub struct RiskVault {
    #[max_len(8)]
    pub symbol: String,
    /// Pyth price feed id (32 bytes, hex id from Hermes without 0x).
    pub pyth_feed_id: [u8; 32],
    /// Sum of `stake * leverage` across open positions in this vault.
    pub open_exposure: u64,
    pub max_stake_per_position: u64,
    /// Lifetime positions opened, for stats.
    pub positions_opened: u64,
    pub active: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionStatus {
    Open,
    Closed,
    Liquidated,
}

/// One synthetic position. Stake is burned on open and settlement is minted on
/// close — the position account itself is the escrow record.
/// PDA: seeds = ["position", user, vault, position_id_le].
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub position_id: u64,
    pub stake: u64,
    /// Entry price, 1e6 fixed point.
    pub entry_price_1e6: u64,
    pub leverage: u8,
    pub opened_ts: i64,
    pub status: PositionStatus,
    pub bump: u8,
}

/// A merchant's reward offer. PDA: seeds = ["listing", merchant, listing_id_le].
#[account]
#[derive(InitSpace)]
pub struct RewardListing {
    pub merchant: Pubkey,
    pub listing_id: u64,
    #[max_len(48)]
    pub title: String,
    pub price_points: u64,
    pub stock: u32,
    /// Off-chain metadata URI baked into the coupon cNFT.
    #[max_len(200)]
    pub uri: String,
    pub bump: u8,
}

/// Proof a coupon was consumed; the cNFT is burned in the same transaction.
/// PDA: seeds = ["receipt", asset_id].
#[account]
#[derive(InitSpace)]
pub struct RedemptionReceipt {
    pub asset_id: Pubkey,
    pub user: Pubkey,
    pub merchant: Pubkey,
    pub listing: Pubkey,
    pub redeemed_ts: i64,
}

/// Deterministic price source for local tests (feature = "mock-oracle").
/// PDA: seeds = ["mock-price", vault].
#[account]
#[derive(InitSpace)]
pub struct MockPrice {
    pub vault: Pubkey,
    pub price_1e6: u64,
    pub publish_time: i64,
}

/// Badge catalogue. Bit positions in `UserProfile.badges` / `badge_eligible`.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Badge {
    /// Closed (or got liquidated on) a first position.
    FirstTrade = 0,
    /// Settled a position at the full 5.0x payout clamp.
    Win5x = 1,
    /// Got liquidated. F. 💀
    Liquidated = 2,
    /// Reached a 7-day earn streak.
    Streak7 = 3,
}

impl Badge {
    pub fn from_id(id: u8) -> Option<Self> {
        match id {
            0 => Some(Badge::FirstTrade),
            1 => Some(Badge::Win5x),
            2 => Some(Badge::Liquidated),
            3 => Some(Badge::Streak7),
            _ => None,
        }
    }

    pub fn mask(self) -> u32 {
        1u32 << (self as u8)
    }

    /// (name, symbol, uri) baked into the soulbound badge mint's metadata.
    pub fn metadata(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Badge::FirstTrade => (
                "First Blood",
                "LOYALB0",
                "https://loyal.fun/badges/first-blood.json",
            ),
            Badge::Win5x => (
                "5x Full Send",
                "LOYALB1",
                "https://loyal.fun/badges/5x-full-send.json",
            ),
            Badge::Liquidated => (
                "Liquidated",
                "LOYALB2",
                "https://loyal.fun/badges/liquidated.json",
            ),
            Badge::Streak7 => (
                "7-Day Streak",
                "LOYALB3",
                "https://loyal.fun/badges/streak-7.json",
            ),
        }
    }
}
