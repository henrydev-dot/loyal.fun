//! Helpers for creating Token-2022 mints with extensions from inside the
//! program (used for the $LOYAL mint and the lazily-created soulbound badge
//! mints). Raw spl-token-2022 instruction builders are used on purpose: the
//! extension set differs per call site and this keeps the CPI surface explicit.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::rent::Rent;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::ExtensionType,
    state::Mint as MintState,
};
use spl_token_metadata_interface::state::TokenMetadata;

use crate::errors::LoyalError;

pub struct MintExtensionPlan<'a> {
    /// Extensions to initialize before `initialize_mint2`.
    pub extensions: &'a [ExtensionType],
    /// Transfer hook program id (Some => TransferHook must be in `extensions`).
    pub transfer_hook_program: Option<Pubkey>,
    /// Metadata (name, symbol, uri); MetadataPointer must be in `extensions`.
    pub metadata: Option<(&'a str, &'a str, &'a str)>,
}

/// Creates `mint` (a PDA of this program) as a Token-2022 mint with the given
/// extensions, mint authority = `authority` (the config PDA), then writes
/// TokenMetadata into the mint account itself (MetadataPointer -> self).
#[allow(clippy::too_many_arguments)]
pub fn create_extension_mint<'info>(
    mint: &AccountInfo<'info>,
    mint_seeds: &[&[u8]],
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[u8]],
    payer: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    decimals: u8,
    plan: MintExtensionPlan,
) -> Result<()> {
    let space = ExtensionType::try_calculate_account_len::<MintState>(plan.extensions)
        .map_err(|_| error!(LoyalError::MathOverflow))?;

    // Rent for the fixed part; the variable-length metadata TLV needs extra
    // lamports transferred before token_metadata_initialize (the token program
    // reallocs internally and checks rent-exemption).
    let rent = Rent::get()?;
    let mut lamports = rent.minimum_balance(space);
    if let Some((name, symbol, uri)) = plan.metadata {
        let meta = TokenMetadata {
            update_authority: Some(*authority.key).try_into().unwrap_or_default(),
            mint: *mint.key,
            name: name.to_string(),
            symbol: symbol.to_string(),
            uri: uri.to_string(),
            additional_metadata: vec![],
        };
        let meta_len = meta.tlv_size_of().map_err(|_| error!(LoyalError::MathOverflow))?;
        lamports = lamports
            .checked_add(rent.minimum_balance(meta_len).saturating_sub(rent.minimum_balance(0)))
            .ok_or(LoyalError::MathOverflow)?
            .checked_add(rent.minimum_balance(0))
            .ok_or(LoyalError::MathOverflow)?;
    }

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            mint.key,
            lamports,
            space as u64,
            token_program.key,
        ),
        &[payer.clone(), mint.clone(), system_program.clone()],
        &[mint_seeds],
    )?;

    // Extension initializers must run BEFORE initialize_mint2.
    for ext in plan.extensions {
        match ext {
            ExtensionType::TransferHook => {
                let hook = plan
                    .transfer_hook_program
                    .ok_or(LoyalError::MathOverflow)?;
                invoke_signed(
                    &spl_token_2022::extension::transfer_hook::instruction::initialize(
                        token_program.key,
                        mint.key,
                        Some(*authority.key),
                        Some(hook),
                    )?,
                    &[mint.clone()],
                    &[mint_seeds],
                )?;
            }
            ExtensionType::MetadataPointer => {
                invoke_signed(
                    &spl_token_2022::extension::metadata_pointer::instruction::initialize(
                        token_program.key,
                        mint.key,
                        Some(*authority.key),
                        // metadata lives inside the mint account itself
                        Some(*mint.key),
                    )?,
                    &[mint.clone()],
                    &[mint_seeds],
                )?;
            }
            ExtensionType::NonTransferable => {
                invoke_signed(
                    &spl_token_2022::instruction::initialize_non_transferable_mint(
                        token_program.key,
                        mint.key,
                    )?,
                    &[mint.clone()],
                    &[mint_seeds],
                )?;
            }
            _ => return err!(LoyalError::MathOverflow),
        }
    }

    invoke_signed(
        &spl_token_2022::instruction::initialize_mint2(
            token_program.key,
            mint.key,
            authority.key,
            None,
            decimals,
        )?,
        &[mint.clone()],
        &[mint_seeds],
    )?;

    if let Some((name, symbol, uri)) = plan.metadata {
        invoke_signed(
            &spl_token_metadata_interface::instruction::initialize(
                token_program.key,
                mint.key,
                authority.key,
                mint.key,
                authority.key,
                name.to_string(),
                symbol.to_string(),
                uri.to_string(),
            ),
            &[
                mint.clone(),
                authority.clone(),
                mint.clone(),
                authority.clone(),
            ],
            &[mint_seeds, authority_seeds],
        )?;
    }

    Ok(())
}
