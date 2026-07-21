//! # loyal.fun — core program
//!
//! Closed-loop loyalty points ($LOYAL, Token-2022 with a transfer hook) that
//! customers EARN via merchant-signed QR codes, DEGEN into synthetic
//! Pyth-priced positions, SPEND on cNFT coupons and FLEX as soulbound badges.
//!
//! Design notes:
//! - One coalition-wide mint: points earned at any merchant spend anywhere.
//! - Synthetic exposure only — no real assets are ever bought or sold, and
//!   there is no fiat off-ramp. Settlement mints/burns points against caps.
//! - Every instruction that moves value emits an event for composability.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("CF5FkJ9GKoFk3SMkBZuXgGnXwfN6TETs5eAYS7V6gggr");

#[program]
pub mod loyal_core {
    use super::*;

    /// Bootstraps the protocol: creates the $LOYAL Token-2022 mint
    /// (TransferHook + MetadataPointer + TokenMetadata, authority = config
    /// PDA) and writes the global config.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_bps: u16,
        max_leverage: u8,
        max_position_stake: u64,
        max_issue_per_tx: u64,
        max_global_exposure: u64,
    ) -> Result<()> {
        instructions::admin::initialize_config(
            ctx,
            fee_bps,
            max_leverage,
            max_position_stake,
            max_issue_per_tx,
            max_global_exposure,
        )
    }

    /// Emergency stop (admin). Gates every user-facing instruction.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    /// Records the Bubblegum merkle tree used for coupon cNFTs (admin).
    pub fn set_coupon_tree(ctx: Context<AdminOnly>, tree: Pubkey) -> Result<()> {
        instructions::admin::set_coupon_tree(ctx, tree)
    }

    /// Registers a shop with its off-chain QR signing key.
    pub fn register_merchant(
        ctx: Context<RegisterMerchant>,
        name: String,
        category: String,
        qr_signer: Pubkey,
        reward_budget: u64,
    ) -> Result<()> {
        instructions::merchant::register_merchant(ctx, name, category, qr_signer, reward_budget)
    }

    /// Rotates a merchant's QR signing key (merchant authority).
    pub fn update_merchant_signer(ctx: Context<UpdateMerchant>, qr_signer: Pubkey) -> Result<()> {
        instructions::merchant::update_merchant_signer(ctx, qr_signer)
    }

    /// Enables/disables a merchant (admin).
    pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
        instructions::merchant::set_merchant_active(ctx, active)
    }

    /// Mints points to a customer against a merchant-signed QR payload.
    /// Requires a preceding Ed25519Program verification instruction; replay
    /// is blocked by the nonce marker PDA, screenshot-sharing by the expiry.
    pub fn issue_points(
        ctx: Context<IssuePoints>,
        points: u64,
        nonce: u64,
        expiry_ts: i64,
    ) -> Result<()> {
        instructions::issue_points::issue_points(ctx, points, nonce, expiry_ts)
    }

    /// Creates a risk vault tracking one Pyth feed (admin).
    pub fn create_vault(
        ctx: Context<CreateVault>,
        symbol: String,
        pyth_feed_id: [u8; 32],
        max_stake_per_position: u64,
    ) -> Result<()> {
        instructions::vaults::create_vault(ctx, symbol, pyth_feed_id, max_stake_per_position)
    }

    /// Enables/disables a vault (admin).
    pub fn set_vault_active(ctx: Context<SetVaultActive>, active: bool) -> Result<()> {
        instructions::vaults::set_vault_active(ctx, active)
    }

    /// Opens a synthetic position: burns the stake, records the Pyth entry
    /// price (staleness + confidence checked). Leverage ∈ {1, 2, 5}.
    /// CPI-friendly: other programs can build on this permissionlessly.
    pub fn open_position(
        ctx: Context<OpenPosition>,
        position_id: u64,
        stake: u64,
        leverage: u8,
    ) -> Result<()> {
        instructions::positions::open_position(ctx, position_id, stake, leverage)
    }

    /// Settles an open position at the current Pyth price:
    /// `payout = stake × clamp(1 + L·Δ, 0, 5)`, minus the burn fee.
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::positions::close_position(ctx)
    }

    /// Permissionless crank: anyone may liquidate a position whose multiplier
    /// decayed to ≤ 0.2x, earning a 1% bounty. The owner keeps the floor value
    /// and earns the 💀 badge.
    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        instructions::positions::liquidate_position(ctx)
    }

    /// Merchant lists a real-world reward purchasable with points.
    pub fn create_listing(
        ctx: Context<CreateListing>,
        title: String,
        price_points: u64,
        stock: u32,
        uri: String,
    ) -> Result<()> {
        instructions::marketplace::create_listing(ctx, title, price_points, stock, uri)
    }

    /// Buys a reward: burns the price and mints a coupon cNFT (Bubblegum CPI)
    /// to the buyer.
    pub fn buy_reward(ctx: Context<BuyReward>) -> Result<()> {
        instructions::marketplace::buy_reward(ctx)
    }

    /// Redeems a coupon at the till: burns the cNFT (user + merchant both
    /// sign) and writes a RedemptionReceipt so it can never be reused.
    #[allow(clippy::too_many_arguments)]
    pub fn redeem_reward<'info>(
        ctx: Context<'_, '_, '_, 'info, RedeemReward<'info>>,
        asset_id: Pubkey,
        root: [u8; 32],
        data_hash: [u8; 32],
        creator_hash: [u8; 32],
        leaf_nonce: u64,
        leaf_index: u32,
    ) -> Result<()> {
        instructions::marketplace::redeem_reward(
            ctx, asset_id, root, data_hash, creator_hash, leaf_nonce, leaf_index,
        )
    }

    /// Claims an unlocked achievement as a soulbound (NonTransferable)
    /// Token-2022 badge token.
    pub fn claim_badge(ctx: Context<ClaimBadge>, badge_id: u8) -> Result<()> {
        instructions::badges::claim_badge(ctx, badge_id)
    }

    /// Test-only deterministic oracle (compiled out of production builds).
    #[cfg(feature = "mock-oracle")]
    pub fn set_mock_price(ctx: Context<SetMockPrice>, price_1e6: u64) -> Result<()> {
        instructions::admin::set_mock_price(ctx, price_1e6)
    }
}
