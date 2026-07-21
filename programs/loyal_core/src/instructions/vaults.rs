//! Risk-vault administration.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::LoyalError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(symbol: String)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LoyalError::AdminOnly,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = admin,
        space = 8 + RiskVault::INIT_SPACE,
        seeds = [VAULT_SEED, symbol.as_bytes()],
        bump,
    )]
    pub vault: Account<'info, RiskVault>,

    pub system_program: Program<'info, System>,
}

pub fn create_vault(
    ctx: Context<CreateVault>,
    symbol: String,
    pyth_feed_id: [u8; 32],
    max_stake_per_position: u64,
) -> Result<()> {
    require!(!symbol.is_empty() && symbol.len() <= 8, LoyalError::StringTooLong);

    let vault = &mut ctx.accounts.vault;
    vault.symbol = symbol;
    vault.pyth_feed_id = pyth_feed_id;
    vault.open_exposure = 0;
    vault.max_stake_per_position = max_stake_per_position;
    vault.positions_opened = 0;
    vault.active = true;
    vault.bump = ctx.bumps.vault;
    Ok(())
}

#[derive(Accounts)]
pub struct SetVaultActive<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LoyalError::AdminOnly,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub vault: Account<'info, RiskVault>,
}

pub fn set_vault_active(ctx: Context<SetVaultActive>, active: bool) -> Result<()> {
    ctx.accounts.vault.active = active;
    Ok(())
}
