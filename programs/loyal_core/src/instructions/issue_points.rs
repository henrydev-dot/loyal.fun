//! `issue_points` — the security-critical earn path.
//!
//! A merchant's tablet signs `(merchant, points, nonce, expiry)` off-chain and
//! renders it as a QR. The customer's transaction carries an Ed25519Program
//! verification of that signature immediately before this instruction; we
//! introspect it via the instructions sysvar, burn the nonce into a marker PDA
//! (replay guard) and mint $LOYAL to the customer.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::{mint_to, MintTo, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::*;
use crate::errors::LoyalError;
use crate::events::PointsIssued;
use crate::state::*;
use crate::utils::ed25519::{qr_message, verify_qr_signature};

#[derive(Accounts)]
#[instruction(points: u64, nonce: u64)]
pub struct IssuePoints<'info> {
    /// The customer scanning the QR. Pays for the nonce marker + profile rent
    /// (in practice the relayer is the fee payer; rent comes from the payer).
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [MERCHANT_SEED, merchant.authority.as_ref()],
        bump = merchant.bump,
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserProfile::INIT_SPACE,
        seeds = [USER_SEED, user.key().as_ref()],
        bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// Replay guard: `init` on a deterministic (merchant, nonce) address fails
    /// the second time the same QR is submitted.
    #[account(
        init,
        payer = user,
        space = 8 + IssuanceNonce::INIT_SPACE,
        seeds = [NONCE_SEED, merchant.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub nonce_account: Account<'info, IssuanceNonce>,

    #[account(
        mut,
        address = config.loyal_mint,
        mint::token_program = token_program,
    )]
    pub loyal_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = loyal_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: fixed sysvar address, introspected in the handler.
    #[account(address = sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn issue_points(ctx: Context<IssuePoints>, points: u64, nonce: u64, expiry_ts: i64) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let merchant = &mut ctx.accounts.merchant;
    let now = Clock::get()?.unix_timestamp;

    require!(!config.paused, LoyalError::Paused);
    require!(merchant.active, LoyalError::MerchantInactive);
    require!(points > 0, LoyalError::ZeroAmount);
    require!(points <= config.max_issue_per_tx, LoyalError::IssueCapExceeded);
    require!(expiry_ts > now, LoyalError::QrExpired);
    require!(
        expiry_ts <= now.checked_add(MAX_QR_TTL_SECS).ok_or(LoyalError::MathOverflow)?,
        LoyalError::QrTtlTooLong
    );

    // --- QR signature: introspect the preceding Ed25519 verification ix. ---
    let message = qr_message(&merchant.key(), points, nonce, expiry_ts);
    verify_qr_signature(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &merchant.qr_signer,
        &message,
    )?;

    // Record the burned nonce (the `init` above is the actual replay guard).
    let nonce_account = &mut ctx.accounts.nonce_account;
    nonce_account.merchant = merchant.key();
    nonce_account.nonce = nonce;
    nonce_account.used_at = now;

    // --- Mint points to the customer. ---
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.loyal_mint.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: config.to_account_info(),
            },
            &[config_seeds],
        ),
        points,
    )?;

    // --- Bookkeeping: merchant budget counter, global supply, profile. ---
    merchant.total_issued = merchant
        .total_issued
        .checked_add(points)
        .ok_or(LoyalError::MathOverflow)?;
    config.total_minted = config
        .total_minted
        .checked_add(points)
        .ok_or(LoyalError::MathOverflow)?;

    let profile = &mut ctx.accounts.user_profile;
    if profile.wallet == Pubkey::default() {
        profile.wallet = ctx.accounts.user.key();
        profile.bump = ctx.bumps.user_profile;
    }
    profile.earned_total = profile
        .earned_total
        .checked_add(points)
        .ok_or(LoyalError::MathOverflow)?;

    // Streak: +1 when earning on a new UTC day within the 48h window;
    // unchanged for same-day earns; reset to 1 after a gap.
    let last = profile.last_earn_ts;
    let same_day = last / 86_400 == now / 86_400;
    profile.streak_days = if last == 0 {
        1
    } else if now.saturating_sub(last) <= STREAK_WINDOW_SECS {
        if same_day {
            profile.streak_days
        } else {
            profile.streak_days.saturating_add(1)
        }
    } else {
        1
    };
    profile.last_earn_ts = now;

    if profile.streak_days >= 7 {
        profile.badge_eligible |= Badge::Streak7.mask();
    }
    profile.tier = tier_for(profile.earned_total);

    emit!(PointsIssued {
        merchant: merchant.key(),
        user: ctx.accounts.user.key(),
        points,
        nonce,
        streak_days: profile.streak_days,
        ts: now,
    });
    Ok(())
}

fn tier_for(earned_total: u64) -> u8 {
    if earned_total >= TIER_DEGEN_EARNED {
        3
    } else if earned_total >= TIER_GOLD_EARNED {
        2
    } else if earned_total >= TIER_SILVER_EARNED {
        1
    } else {
        0
    }
}
