//! Reward marketplace: listings are public PDAs anyone can read (and any
//! merchant can create), purchases burn points and mint a coupon cNFT via
//! Bubblegum CPI, redemption burns the cNFT and writes an on-chain receipt.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{burn, Burn, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};
use mpl_bubblegum::instructions::{BurnCpiBuilder, MintV1CpiBuilder};
use mpl_bubblegum::types::{MetadataArgs, TokenProgramVersion, TokenStandard};

use crate::constants::*;
use crate::errors::LoyalError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct CreateListing<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [MERCHANT_SEED, authority.key().as_ref()],
        bump = merchant.bump,
        has_one = authority,
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(
        init,
        payer = authority,
        space = 8 + RewardListing::INIT_SPACE,
        seeds = [
            LISTING_SEED,
            merchant.key().as_ref(),
            &merchant.listing_count.to_le_bytes(),
        ],
        bump,
    )]
    pub listing: Account<'info, RewardListing>,

    pub system_program: Program<'info, System>,
}

pub fn create_listing(
    ctx: Context<CreateListing>,
    title: String,
    price_points: u64,
    stock: u32,
    uri: String,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, LoyalError::Paused);
    require!(ctx.accounts.merchant.active, LoyalError::MerchantInactive);
    require!(title.len() <= 48, LoyalError::StringTooLong);
    require!(uri.len() <= 200, LoyalError::StringTooLong);
    require!(price_points > 0, LoyalError::ZeroAmount);

    let merchant = &mut ctx.accounts.merchant;
    let listing = &mut ctx.accounts.listing;
    listing.merchant = merchant.key();
    listing.listing_id = merchant.listing_count;
    listing.title = title;
    listing.price_points = price_points;
    listing.stock = stock;
    listing.uri = uri;
    listing.bump = ctx.bumps.listing;

    merchant.listing_count = merchant
        .listing_count
        .checked_add(1)
        .ok_or(LoyalError::MathOverflow)?;

    emit!(RewardListed {
        merchant: merchant.key(),
        listing: listing.key(),
        listing_id: listing.listing_id,
        price_points,
        stock,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct BuyReward<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [
            LISTING_SEED,
            listing.merchant.as_ref(),
            &listing.listing_id.to_le_bytes(),
        ],
        bump = listing.bump,
    )]
    pub listing: Account<'info, RewardListing>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_profile.bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(mut, address = config.loyal_mint)]
    pub loyal_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = loyal_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Bubblegum tree config PDA for the coupon tree; Bubblegum
    /// validates it against the merkle tree in the CPI.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: must be the coupon tree wired by the admin.
    #[account(mut, address = config.coupon_tree @ LoyalError::WrongCouponTree)]
    pub merkle_tree: UncheckedAccount<'info>,

    /// CHECK: SPL Noop, validated by address.
    #[account(address = SPL_NOOP_ID)]
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: SPL Account Compression, validated by address.
    #[account(address = SPL_ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,

    /// CHECK: Bubblegum program, validated by address.
    #[account(address = mpl_bubblegum::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn buy_reward(ctx: Context<BuyReward>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let listing = &mut ctx.accounts.listing;
    let profile = &mut ctx.accounts.user_profile;
    let now = Clock::get()?.unix_timestamp;

    require!(!config.paused, LoyalError::Paused);
    require!(config.coupon_tree != Pubkey::default(), LoyalError::CouponTreeNotSet);
    require!(listing.stock > 0, LoyalError::OutOfStock);

    // Pay: burn the price from the buyer. Deflationary by design — the value
    // was already "spent" against the merchant's reward budget at issuance.
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.loyal_mint.to_account_info(),
                from: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        listing.price_points,
    )?;

    // Coupon: mint a cNFT to the buyer. The config PDA is the tree delegate.
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
    let mut name = listing.title.clone();
    name.truncate(32);
    MintV1CpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .tree_config(&ctx.accounts.tree_config.to_account_info())
        .leaf_owner(&ctx.accounts.user.to_account_info())
        .leaf_delegate(&ctx.accounts.user.to_account_info())
        .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
        .payer(&ctx.accounts.user.to_account_info())
        .tree_creator_or_delegate(&config.to_account_info())
        .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
        .compression_program(&ctx.accounts.compression_program.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .metadata(MetadataArgs {
            name,
            symbol: "LOYALR".to_string(),
            uri: listing.uri.clone(),
            seller_fee_basis_points: 0,
            primary_sale_happened: false,
            is_mutable: false,
            edition_nonce: None,
            token_standard: Some(TokenStandard::NonFungible),
            collection: None,
            uses: None,
            token_program_version: TokenProgramVersion::Original,
            creators: vec![],
        })
        .invoke_signed(&[config_seeds])?;

    listing.stock = listing.stock.checked_sub(1).ok_or(LoyalError::OutOfStock)?;
    profile.spent_total = profile
        .spent_total
        .checked_add(listing.price_points)
        .ok_or(LoyalError::MathOverflow)?;
    config.total_burned = config
        .total_burned
        .checked_add(listing.price_points)
        .ok_or(LoyalError::MathOverflow)?;

    emit!(RewardPurchased {
        user: ctx.accounts.user.key(),
        merchant: listing.merchant,
        listing: listing.key(),
        price_points: listing.price_points,
        remaining_stock: listing.stock,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(asset_id: Pubkey)]
pub struct RedeemReward<'info> {
    /// The coupon holder — must sign (they hand their phone QR to the till).
    #[account(mut)]
    pub user: Signer<'info>,

    /// The shop's wallet — must also sign, proving redemption happened at the
    /// counter and not by a screenshot replay.
    #[account(mut)]
    pub merchant_authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [MERCHANT_SEED, merchant_authority.key().as_ref()],
        bump = merchant.bump,
        constraint = merchant.authority == merchant_authority.key(),
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(
        seeds = [
            LISTING_SEED,
            listing.merchant.as_ref(),
            &listing.listing_id.to_le_bytes(),
        ],
        bump = listing.bump,
        constraint = listing.merchant == merchant.key() @ LoyalError::ListingMerchantMismatch,
    )]
    pub listing: Account<'info, RewardListing>,

    /// Double-spend guard: one receipt per asset id, ever.
    #[account(
        init,
        payer = merchant_authority,
        space = 8 + RedemptionReceipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, asset_id.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, RedemptionReceipt>,

    /// CHECK: Bubblegum tree config PDA, validated by Bubblegum in the CPI.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: must be the coupon tree wired by the admin.
    #[account(mut, address = config.coupon_tree @ LoyalError::WrongCouponTree)]
    pub merkle_tree: UncheckedAccount<'info>,

    /// CHECK: SPL Noop, validated by address.
    #[account(address = SPL_NOOP_ID)]
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: SPL Account Compression, validated by address.
    #[account(address = SPL_ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,

    /// CHECK: Bubblegum program, validated by address.
    #[account(address = mpl_bubblegum::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: the merkle proof path for the coupon leaf.
}

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
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused, LoyalError::Paused);
    require!(ctx.accounts.merchant.active, LoyalError::MerchantInactive);

    // Burn the coupon cNFT. The user signs as leaf owner; the merkle proof
    // arrives as remaining accounts. Bubblegum verifies ownership + proof.
    let proof: Vec<(&AccountInfo<'info>, bool, bool)> = ctx
        .remaining_accounts
        .iter()
        .map(|acc| (acc, false, false))
        .collect();
    BurnCpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .tree_config(&ctx.accounts.tree_config.to_account_info())
        .leaf_owner(&ctx.accounts.user.to_account_info(), true)
        .leaf_delegate(&ctx.accounts.user.to_account_info(), false)
        .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
        .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
        .compression_program(&ctx.accounts.compression_program.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .root(root)
        .data_hash(data_hash)
        .creator_hash(creator_hash)
        .nonce(leaf_nonce)
        .index(leaf_index)
        .add_remaining_accounts(&proof)
        .invoke()?;

    let receipt = &mut ctx.accounts.receipt;
    receipt.asset_id = asset_id;
    receipt.user = ctx.accounts.user.key();
    receipt.merchant = ctx.accounts.merchant.key();
    receipt.listing = ctx.accounts.listing.key();
    receipt.redeemed_ts = now;

    let merchant = &mut ctx.accounts.merchant;
    merchant.coupons_redeemed = merchant
        .coupons_redeemed
        .checked_add(1)
        .ok_or(LoyalError::MathOverflow)?;

    emit!(RewardRedeemed {
        user: ctx.accounts.user.key(),
        merchant: merchant.key(),
        listing: ctx.accounts.listing.key(),
        asset_id,
        ts: now,
    });
    Ok(())
}
