//! Synthetic positions against Pyth-priced vaults.
//!
//! Escrow model: the stake is BURNED when a position opens and the settlement
//! is MINTED when it closes. The Position PDA is the escrow record. This keeps
//! the closed loop airtight (no token account ever holds "someone else's"
//! points) and sidesteps transfer-hook resolution for program-internal moves,
//! since Token-2022 mint/burn do not invoke transfer hooks.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::{burn, mint_to, Burn, MintTo, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::*;
use crate::errors::LoyalError;
use crate::events::*;
use crate::math;
use crate::state::*;
use crate::utils::oracle::read_price_1e6;

#[derive(Accounts)]
#[instruction(position_id: u64)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.symbol.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, RiskVault>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_profile.bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(
        init,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [
            POSITION_SEED,
            user.key().as_ref(),
            vault.key().as_ref(),
            &position_id.to_le_bytes(),
        ],
        bump,
    )]
    pub position: Account<'info, Position>,

    /// CHECK: Pyth PriceUpdateV2 (or MockPrice under the mock-oracle feature);
    /// owner, feed id, staleness and confidence are all validated in
    /// `read_price_1e6`.
    pub price_update: UncheckedAccount<'info>,

    #[account(mut, address = config.loyal_mint)]
    pub loyal_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = loyal_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn open_position(
    ctx: Context<OpenPosition>,
    position_id: u64,
    stake: u64,
    leverage: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let vault = &mut ctx.accounts.vault;
    let profile = &mut ctx.accounts.user_profile;
    let clock = Clock::get()?;

    require!(!config.paused, LoyalError::Paused);
    require!(vault.active, LoyalError::VaultInactive);
    require!(stake > 0, LoyalError::ZeroAmount);
    require!(
        matches!(leverage, 1 | 2 | 5) && leverage <= config.max_leverage,
        LoyalError::InvalidLeverage
    );
    require!(
        stake <= vault.max_stake_per_position && stake <= config.max_position_stake,
        LoyalError::StakeCapExceeded
    );
    require!(position_id == profile.position_count, LoyalError::BadPositionId);

    // Global inflation guard: bound worst-case outstanding winnings.
    let added_exposure = math::exposure(stake, leverage)?;
    let new_global = config
        .global_open_exposure
        .checked_add(added_exposure)
        .ok_or(LoyalError::MathOverflow)?;
    require!(
        new_global <= config.max_global_exposure,
        LoyalError::GlobalExposureCapExceeded
    );

    let vault_key = vault.key();
    let entry_price_1e6 = read_price_1e6(
        &ctx.accounts.price_update.to_account_info(),
        vault,
        &vault_key,
        &clock,
    )?;

    // Burn the stake — points leave circulation until settlement.
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.loyal_mint.to_account_info(),
                from: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        stake,
    )?;

    let position = &mut ctx.accounts.position;
    position.user = ctx.accounts.user.key();
    position.vault = vault.key();
    position.position_id = position_id;
    position.stake = stake;
    position.entry_price_1e6 = entry_price_1e6;
    position.leverage = leverage;
    position.opened_ts = clock.unix_timestamp;
    position.status = PositionStatus::Open;
    position.bump = ctx.bumps.position;

    profile.position_count = profile
        .position_count
        .checked_add(1)
        .ok_or(LoyalError::MathOverflow)?;
    vault.open_exposure = vault
        .open_exposure
        .checked_add(added_exposure)
        .ok_or(LoyalError::MathOverflow)?;
    vault.positions_opened = vault
        .positions_opened
        .checked_add(1)
        .ok_or(LoyalError::MathOverflow)?;
    config.global_open_exposure = new_global;
    config.total_burned = config
        .total_burned
        .checked_add(stake)
        .ok_or(LoyalError::MathOverflow)?;

    emit!(PositionOpened {
        user: position.user,
        vault: vault.key(),
        position: position.key(),
        position_id,
        stake,
        leverage,
        entry_price_1e6,
        ts: clock.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.symbol.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, RiskVault>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_profile.bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(
        mut,
        seeds = [
            POSITION_SEED,
            user.key().as_ref(),
            vault.key().as_ref(),
            &position.position_id.to_le_bytes(),
        ],
        bump = position.bump,
        has_one = user,
        has_one = vault,
    )]
    pub position: Account<'info, Position>,

    /// CHECK: validated in `read_price_1e6` (owner, feed, staleness, confidence).
    pub price_update: UncheckedAccount<'info>,

    #[account(mut, address = config.loyal_mint)]
    pub loyal_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = loyal_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
}

pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let vault = &mut ctx.accounts.vault;
    let position = &mut ctx.accounts.position;
    let profile = &mut ctx.accounts.user_profile;
    let clock = Clock::get()?;

    require!(!config.paused, LoyalError::Paused);
    require!(position.status == PositionStatus::Open, LoyalError::PositionNotOpen);

    let vault_key = vault.key();
    let exit_price_1e6 = read_price_1e6(
        &ctx.accounts.price_update.to_account_info(),
        vault,
        &vault_key,
        &clock,
    )?;

    let payout = math::gross_payout(
        position.stake,
        position.entry_price_1e6,
        exit_price_1e6,
        position.leverage,
    )?;
    let fee = math::settlement_fee(payout, config.fee_bps)?;
    let net = payout.checked_sub(fee).ok_or(LoyalError::MathOverflow)?;

    // Stake was burned on open; only the net settlement is (re)minted.
    if net > 0 {
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
            net,
        )?;
        config.total_minted = config
            .total_minted
            .checked_add(net)
            .ok_or(LoyalError::MathOverflow)?;
    }

    let pnl = (net as i64)
        .checked_sub(position.stake as i64)
        .ok_or(LoyalError::MathOverflow)?;
    settle_common(config, vault, position, profile, PositionStatus::Closed, pnl)?;

    // Badge unlocks.
    profile.badge_eligible |= Badge::FirstTrade.mask();
    let max_payout = (position.stake as u128)
        .checked_mul(MAX_MULTIPLIER_1E6)
        .ok_or(LoyalError::MathOverflow)?
        / PRICE_SCALE;
    if payout as u128 >= max_payout {
        profile.badge_eligible |= Badge::Win5x.mask();
    }

    emit!(PositionClosed {
        user: ctx.accounts.user.key(),
        vault: vault.key(),
        position: position.key(),
        stake: position.stake,
        exit_price_1e6,
        payout_after_fee: net,
        fee_burned: fee,
        pnl,
        ts: clock.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    /// Anyone may crank a drowned position — permissionless keeper surface.
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.symbol.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, RiskVault>,

    /// CHECK: the position's owner; validated by `has_one` on the position
    /// and used as ATA authority below. Not required to sign.
    pub position_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_SEED, position_owner.key().as_ref()],
        bump = owner_profile.bump,
    )]
    pub owner_profile: Account<'info, UserProfile>,

    #[account(
        mut,
        seeds = [
            POSITION_SEED,
            position_owner.key().as_ref(),
            vault.key().as_ref(),
            &position.position_id.to_le_bytes(),
        ],
        bump = position.bump,
        has_one = vault,
        constraint = position.user == position_owner.key() @ LoyalError::PositionNotOpen,
    )]
    pub position: Account<'info, Position>,

    /// CHECK: validated in `read_price_1e6` (owner, feed, staleness, confidence).
    pub price_update: UncheckedAccount<'info>,

    #[account(mut, address = config.loyal_mint)]
    pub loyal_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = loyal_mint,
        associated_token::authority = position_owner,
        associated_token::token_program = token_program,
    )]
    pub owner_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = liquidator,
        associated_token::mint = loyal_mint,
        associated_token::authority = liquidator,
        associated_token::token_program = token_program,
    )]
    pub liquidator_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let vault = &mut ctx.accounts.vault;
    let position = &mut ctx.accounts.position;
    let profile = &mut ctx.accounts.owner_profile;
    let clock = Clock::get()?;

    require!(!config.paused, LoyalError::Paused);
    require!(position.status == PositionStatus::Open, LoyalError::PositionNotOpen);

    let vault_key = vault.key();
    let price_1e6 = read_price_1e6(
        &ctx.accounts.price_update.to_account_info(),
        vault,
        &vault_key,
        &clock,
    )?;
    require!(
        math::is_liquidatable(position.entry_price_1e6, price_1e6, position.leverage)?,
        LoyalError::NotLiquidatable
    );

    // Owner receives whatever floor value is left (≤ 0.2x), minus fee.
    let payout = math::gross_payout(
        position.stake,
        position.entry_price_1e6,
        price_1e6,
        position.leverage,
    )?;
    let fee = math::settlement_fee(payout, config.fee_bps)?;
    let floor = payout.checked_sub(fee).ok_or(LoyalError::MathOverflow)?;
    let bounty = math::liquidator_bounty(position.stake)?;

    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
    if floor > 0 {
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.loyal_mint.to_account_info(),
                    to: ctx.accounts.owner_ata.to_account_info(),
                    authority: config.to_account_info(),
                },
                &[config_seeds],
            ),
            floor,
        )?;
    }
    if bounty > 0 {
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.loyal_mint.to_account_info(),
                    to: ctx.accounts.liquidator_ata.to_account_info(),
                    authority: config.to_account_info(),
                },
                &[config_seeds],
            ),
            bounty,
        )?;
    }
    config.total_minted = config
        .total_minted
        .checked_add(floor)
        .and_then(|v| v.checked_add(bounty))
        .ok_or(LoyalError::MathOverflow)?;

    let pnl = (floor as i64)
        .checked_sub(position.stake as i64)
        .ok_or(LoyalError::MathOverflow)?;
    settle_common(config, vault, position, profile, PositionStatus::Liquidated, pnl)?;

    profile.times_liquidated = profile.times_liquidated.saturating_add(1);
    profile.badge_eligible |= Badge::FirstTrade.mask() | Badge::Liquidated.mask();

    emit!(PositionLiquidated {
        user: position.user,
        vault: vault.key(),
        position: position.key(),
        liquidator: ctx.accounts.liquidator.key(),
        stake: position.stake,
        exit_price_1e6: price_1e6,
        floor_payout: floor,
        bounty,
        ts: clock.unix_timestamp,
    });
    Ok(())
}

/// Shared settlement bookkeeping for close + liquidate.
fn settle_common(
    config: &mut Config,
    vault: &mut RiskVault,
    position: &mut Position,
    profile: &mut UserProfile,
    status: PositionStatus,
    pnl: i64,
) -> Result<()> {
    let released = math::exposure(position.stake, position.leverage)?;
    vault.open_exposure = vault.open_exposure.saturating_sub(released);
    config.global_open_exposure = config.global_open_exposure.saturating_sub(released);
    position.status = status;
    profile.positions_closed = profile
        .positions_closed
        .checked_add(1)
        .ok_or(LoyalError::MathOverflow)?;
    profile.degen_score = profile
        .degen_score
        .checked_add(pnl)
        .ok_or(LoyalError::MathOverflow)?;
    Ok(())
}
