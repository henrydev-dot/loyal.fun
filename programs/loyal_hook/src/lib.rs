//! # loyal.fun — transfer hook program
//!
//! Enforces the closed loop on the $LOYAL Token-2022 mint. The mint is
//! created with a TransferHook extension pointing here, so the token program
//! CPIs into `Execute` on EVERY transfer. We allow a transfer only when the
//! source or destination token account is owned by a whitelisted authority
//! (protocol PDAs, future marketplace escrows); plain wallet-to-wallet
//! transfers are rejected — points cannot leak to DEXes or OTC markets.
//!
//! Mint and burn do not trigger transfer hooks, so issuance, position
//! settlement and reward purchases (all mint/burn based) are unaffected.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account as SplTokenAccount,
};
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

declare_id!("CjEcibq2LtkMJHEZ6wiiFFRNPXC4rd5xaCdEowWqW5GM");

pub const WHITELIST_SEED: &[u8] = b"whitelist";
pub const META_LIST_SEED: &[u8] = b"extra-account-metas";
pub const MAX_WHITELIST_ENTRIES: usize = 16;

#[error_code]
pub enum HookError {
    #[msg("Transfer blocked: $LOYAL is closed-loop; neither side is whitelisted")]
    TransferBlocked,
    #[msg("Token account is not in a transferring state (hook called outside a transfer)")]
    NotTransferring,
    #[msg("Only the whitelist admin may modify the whitelist")]
    AdminOnly,
    #[msg("Whitelist is full")]
    WhitelistFull,
    #[msg("Entry not found in whitelist")]
    EntryNotFound,
}

/// Allowed token-account authorities (protocol PDAs). Singleton.
#[account]
#[derive(InitSpace)]
pub struct Whitelist {
    pub admin: Pubkey,
    #[max_len(MAX_WHITELIST_ENTRIES)]
    pub entries: Vec<Pubkey>,
    pub bump: u8,
}

#[program]
pub mod loyal_hook {
    use super::*;

    /// Creates the whitelist. `admin` manages entries afterwards.
    pub fn initialize_whitelist(ctx: Context<InitializeWhitelist>) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;
        whitelist.admin = ctx.accounts.payer.key();
        whitelist.entries = vec![];
        whitelist.bump = ctx.bumps.whitelist;
        Ok(())
    }

    /// Adds an allowed token-account authority (e.g. the loyal_core config PDA).
    pub fn add_to_whitelist(ctx: Context<MutateWhitelist>, authority: Pubkey) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;
        require!(
            whitelist.entries.len() < MAX_WHITELIST_ENTRIES,
            HookError::WhitelistFull
        );
        if !whitelist.entries.contains(&authority) {
            whitelist.entries.push(authority);
        }
        Ok(())
    }

    /// Removes an authority from the whitelist.
    pub fn remove_from_whitelist(ctx: Context<MutateWhitelist>, authority: Pubkey) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;
        let before = whitelist.entries.len();
        whitelist.entries.retain(|entry| *entry != authority);
        require!(whitelist.entries.len() < before, HookError::EntryNotFound);
        Ok(())
    }

    /// Creates the ExtraAccountMetaList PDA for the mint, telling Token-2022
    /// to append our whitelist account to every transfer's hook CPI.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let metas = vec![ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal {
                bytes: WHITELIST_SEED.to_vec(),
            }],
            false, // not a signer
            false, // read-only
        )?];

        let space = ExtraAccountMetaList::size_of(metas.len())
            .map_err(|_| ProgramError::InvalidAccountData)? as u64;
        let lamports = Rent::get()?.minimum_balance(space as usize);

        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[u8]] = &[
            META_LIST_SEED,
            mint_key.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ];

        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.payer.key,
                ctx.accounts.extra_account_meta_list.key,
                lamports,
                space,
                ctx.program_id,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.extra_account_meta_list.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
        Ok(())
    }

    /// The hook itself. Token-2022 CPIs here on every $LOYAL transfer.
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        // Only honor calls made by the token program mid-transfer: both
        // accounts carry the "transferring" flag set by Token-2022.
        assert_is_transferring(&ctx.accounts.source_token.to_account_info())?;
        assert_is_transferring(&ctx.accounts.destination_token.to_account_info())?;

        let whitelist = &ctx.accounts.whitelist;
        let source_owner = ctx.accounts.source_token.owner;
        let destination_owner = ctx.accounts.destination_token.owner;

        require!(
            whitelist.entries.contains(&source_owner)
                || whitelist.entries.contains(&destination_owner),
            HookError::TransferBlocked
        );
        Ok(())
    }

    /// Token-2022 invokes the hook with the interface discriminator, not an
    /// Anchor one — route it manually.
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        match TransferHookInstruction::unpack(data)? {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

fn assert_is_transferring(account_info: &AccountInfo) -> Result<()> {
    let data = account_info.try_borrow_data()?;
    let token_account = StateWithExtensions::<SplTokenAccount>::unpack(&data)?;
    let ext = token_account
        .get_extension::<TransferHookAccount>()
        .map_err(|_| HookError::NotTransferring)?;
    require!(bool::from(ext.transferring), HookError::NotTransferring);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeWhitelist<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Whitelist::INIT_SPACE,
        seeds = [WHITELIST_SEED],
        bump,
    )]
    pub whitelist: Account<'info, Whitelist>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateWhitelist<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [WHITELIST_SEED],
        bump = whitelist.bump,
        has_one = admin @ HookError::AdminOnly,
    )]
    pub whitelist: Account<'info, Whitelist>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: created in the handler at the interface-defined PDA.
    #[account(mut, seeds = [META_LIST_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

/// Account order is fixed by the transfer-hook interface:
/// source, mint, destination, owner, meta-list, then our extra metas.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account authority (or delegate).
    pub owner: UncheckedAccount<'info>,
    /// CHECK: the ExtraAccountMetaList PDA validated by its seeds.
    #[account(seeds = [META_LIST_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(seeds = [WHITELIST_SEED], bump = whitelist.bump)]
    pub whitelist: Account<'info, Whitelist>,
}
