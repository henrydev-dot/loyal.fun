//! Merchant lifecycle: registration, activation, QR-signer rotation.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::LoyalError;
use crate::events::MerchantRegistered;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = authority,
        space = 8 + Merchant::INIT_SPACE,
        seeds = [MERCHANT_SEED, authority.key().as_ref()],
        bump,
    )]
    pub merchant: Account<'info, Merchant>,

    pub system_program: Program<'info, System>,
}

pub fn register_merchant(
    ctx: Context<RegisterMerchant>,
    name: String,
    category: String,
    qr_signer: Pubkey,
    reward_budget: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, LoyalError::Paused);
    require!(name.len() <= 32, LoyalError::StringTooLong);
    require!(category.len() <= 16, LoyalError::StringTooLong);

    let merchant = &mut ctx.accounts.merchant;
    merchant.authority = ctx.accounts.authority.key();
    merchant.qr_signer = qr_signer;
    merchant.name = name.clone();
    merchant.category = category;
    merchant.total_issued = 0;
    merchant.reward_budget = reward_budget;
    merchant.listing_count = 0;
    merchant.coupons_redeemed = 0;
    merchant.active = true;
    merchant.bump = ctx.bumps.merchant;

    emit!(MerchantRegistered {
        merchant: merchant.key(),
        authority: merchant.authority,
        name,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateMerchant<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [MERCHANT_SEED, authority.key().as_ref()],
        bump = merchant.bump,
        has_one = authority,
    )]
    pub merchant: Account<'info, Merchant>,
}

/// Rotate the hot QR-signing key kept on the shop tablet.
pub fn update_merchant_signer(ctx: Context<UpdateMerchant>, qr_signer: Pubkey) -> Result<()> {
    ctx.accounts.merchant.qr_signer = qr_signer;
    Ok(())
}

#[derive(Accounts)]
pub struct SetMerchantActive<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LoyalError::AdminOnly,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub merchant: Account<'info, Merchant>,
}

/// Admin kill-switch for a misbehaving merchant (e.g. leaked QR signer).
pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
    ctx.accounts.merchant.active = active;
    Ok(())
}
