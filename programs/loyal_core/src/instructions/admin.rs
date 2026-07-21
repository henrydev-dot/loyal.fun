//! Admin instructions: bootstrap the protocol, wire the coupon tree,
//! emergency pause, and (test builds only) drive the mock oracle.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::Token2022;

use crate::constants::*;
use crate::errors::LoyalError;
use crate::state::*;
use crate::utils::token2022::{create_extension_mint, MintExtensionPlan};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: PDA created in the handler as a Token-2022 mint with
    /// TransferHook + MetadataPointer + TokenMetadata extensions.
    #[account(mut, seeds = [LOYAL_MINT_SEED], bump)]
    pub loyal_mint: UncheckedAccount<'info>,

    /// CHECK: the loyal_hook program; only its id is recorded and baked into
    /// the mint's TransferHook extension.
    #[account(executable)]
    pub hook_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    fee_bps: u16,
    max_leverage: u8,
    max_position_stake: u64,
    max_issue_per_tx: u64,
    max_global_exposure: u64,
) -> Result<()> {
    require!(fee_bps <= 1_000, LoyalError::MathOverflow); // sanity: <=10%

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.loyal_mint = ctx.accounts.loyal_mint.key();
    config.hook_program = ctx.accounts.hook_program.key();
    config.coupon_tree = Pubkey::default();
    config.fee_bps = fee_bps;
    config.max_leverage = max_leverage;
    config.max_position_stake = max_position_stake;
    config.max_issue_per_tx = max_issue_per_tx;
    config.global_open_exposure = 0;
    config.max_global_exposure = max_global_exposure;
    config.total_minted = 0;
    config.total_burned = 0;
    config.paused = false;
    config.bump = ctx.bumps.config;
    config.mint_bump = ctx.bumps.loyal_mint;

    let mint_seeds: &[&[u8]] = &[LOYAL_MINT_SEED, &[ctx.bumps.loyal_mint]];
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.bumps.config]];

    create_extension_mint(
        &ctx.accounts.loyal_mint.to_account_info(),
        mint_seeds,
        &config.to_account_info(),
        config_seeds,
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        LOYAL_DECIMALS,
        MintExtensionPlan {
            extensions: &[ExtensionType::TransferHook, ExtensionType::MetadataPointer],
            transfer_hook_program: Some(ctx.accounts.hook_program.key()),
            metadata: Some(("LOYAL", "LOYAL", "https://loyal.fun/token/loyal.json")),
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LoyalError::AdminOnly,
    )]
    pub config: Account<'info, Config>,
}

pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

/// Records the Bubblegum merkle tree the deploy script created for coupons.
/// The tree's delegate must have been set to the config PDA beforehand.
pub fn set_coupon_tree(ctx: Context<AdminOnly>, tree: Pubkey) -> Result<()> {
    ctx.accounts.config.coupon_tree = tree;
    Ok(())
}

#[cfg(feature = "mock-oracle")]
#[derive(Accounts)]
pub struct SetMockPrice<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LoyalError::AdminOnly,
    )]
    pub config: Account<'info, Config>,
    pub vault: Account<'info, RiskVault>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + MockPrice::INIT_SPACE,
        seeds = [MOCK_PRICE_SEED, vault.key().as_ref()],
        bump,
    )]
    pub mock_price: Account<'info, MockPrice>,
    pub system_program: Program<'info, System>,
}

/// Test-only: sets the deterministic price for a vault. Compiled out of
/// production builds entirely.
#[cfg(feature = "mock-oracle")]
pub fn set_mock_price(ctx: Context<SetMockPrice>, price_1e6: u64) -> Result<()> {
    let mock = &mut ctx.accounts.mock_price;
    mock.vault = ctx.accounts.vault.key();
    mock.price_1e6 = price_1e6;
    mock.publish_time = Clock::get()?.unix_timestamp;
    Ok(())
}
