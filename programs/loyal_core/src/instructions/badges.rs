//! Soulbound achievement badges: one lazily-created NonTransferable
//! Token-2022 mint per badge type, decimals 0, metadata baked into the mint.
//! Anything that can read Token-2022 accounts (Discord gating, other dApps)
//! can token-gate on these.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{
    create_idempotent, get_associated_token_address_with_program_id, AssociatedToken, Create,
};
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::{mint_to, MintTo, Token2022};

use crate::constants::*;
use crate::errors::LoyalError;
use crate::events::BadgeClaimed;
use crate::state::*;
use crate::utils::token2022::{create_extension_mint, MintExtensionPlan};

#[derive(Accounts)]
#[instruction(badge_id: u8)]
pub struct ClaimBadge<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_profile.bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// CHECK: PDA; created lazily in the handler as a NonTransferable
    /// Token-2022 mint on the first claim of this badge type.
    #[account(mut, seeds = [BADGE_MINT_SEED, &[badge_id]], bump)]
    pub badge_mint: UncheckedAccount<'info>,

    /// CHECK: the user's ATA for the badge mint; address is verified in the
    /// handler and the account is created idempotently via CPI.
    #[account(mut)]
    pub user_badge_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn claim_badge(ctx: Context<ClaimBadge>, badge_id: u8) -> Result<()> {
    let config = &ctx.accounts.config;
    let profile = &mut ctx.accounts.user_profile;
    let now = Clock::get()?.unix_timestamp;

    require!(!config.paused, LoyalError::Paused);
    let badge = Badge::from_id(badge_id).ok_or(LoyalError::UnknownBadge)?;
    require!(
        profile.badge_eligible & badge.mask() != 0,
        LoyalError::BadgeNotEligible
    );
    require!(profile.badges & badge.mask() == 0, LoyalError::BadgeAlreadyClaimed);

    let expected_ata = get_associated_token_address_with_program_id(
        &ctx.accounts.user.key(),
        &ctx.accounts.badge_mint.key(),
        &ctx.accounts.token_program.key(),
    );
    require_keys_eq!(
        ctx.accounts.user_badge_ata.key(),
        expected_ata,
        LoyalError::UnknownBadge
    );

    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];

    // Lazily create the per-badge-type soulbound mint on first claim.
    if ctx.accounts.badge_mint.data_is_empty() {
        let (name, symbol, uri) = badge.metadata();
        let mint_seeds: &[&[u8]] = &[BADGE_MINT_SEED, &[badge_id], &[ctx.bumps.badge_mint]];
        create_extension_mint(
            &ctx.accounts.badge_mint.to_account_info(),
            mint_seeds,
            &config.to_account_info(),
            config_seeds,
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            0,
            MintExtensionPlan {
                extensions: &[ExtensionType::NonTransferable, ExtensionType::MetadataPointer],
                transfer_hook_program: None,
                metadata: Some((name, symbol, uri)),
            },
        )?;
    }

    // NonTransferable mints require the ATA to be created with the
    // ImmutableOwner extension — the ATA program does this automatically.
    create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer: ctx.accounts.user.to_account_info(),
            associated_token: ctx.accounts.user_badge_ata.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.badge_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.badge_mint.to_account_info(),
                to: ctx.accounts.user_badge_ata.to_account_info(),
                authority: config.to_account_info(),
            },
            &[config_seeds],
        ),
        1,
    )?;

    profile.badges |= badge.mask();

    emit!(BadgeClaimed {
        user: ctx.accounts.user.key(),
        badge_id,
        badge_mint: ctx.accounts.badge_mint.key(),
        ts: now,
    });
    Ok(())
}
