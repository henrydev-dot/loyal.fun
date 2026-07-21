//! Instruction-sysvar introspection of the native Ed25519 signature-verify
//! program, used to validate merchant-signed QR payloads on-chain.
//!
//! The client builds a transaction of the form:
//!   ix[0] = Ed25519Program.verify(sig, qr_signer_pubkey, message)
//!   ix[1] = loyal_core.issue_points(points, nonce, expiry_ts)
//!
//! The Ed25519 program verifies the signature (the whole tx fails otherwise);
//! here we only need to prove that *what* it verified is the payload our
//! arguments claim, and that the pubkey is the merchant's registered signer.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

use crate::errors::LoyalError;

/// Byte layout of one entry in the Ed25519 program's offsets table.
/// See solana_sdk::ed25519_instruction — 14 bytes per entry.
const OFFSETS_ENTRY_LEN: usize = 14;
/// 1 byte num_signatures + 1 byte padding.
const OFFSETS_TABLE_START: usize = 2;

/// The exact 56-byte message a merchant's QR signer commits to:
/// merchant pubkey (32) || points u64 LE || nonce u64 LE || expiry_ts i64 LE.
pub fn qr_message(merchant: &Pubkey, points: u64, nonce: u64, expiry_ts: i64) -> [u8; 56] {
    let mut msg = [0u8; 56];
    msg[0..32].copy_from_slice(merchant.as_ref());
    msg[32..40].copy_from_slice(&points.to_le_bytes());
    msg[40..48].copy_from_slice(&nonce.to_le_bytes());
    msg[48..56].copy_from_slice(&expiry_ts.to_le_bytes());
    msg
}

fn read_u16(data: &[u8], pos: usize) -> Result<u16> {
    let bytes: [u8; 2] = data
        .get(pos..pos + 2)
        .ok_or(LoyalError::MalformedEd25519Instruction)?
        .try_into()
        .map_err(|_| LoyalError::MalformedEd25519Instruction)?;
    Ok(u16::from_le_bytes(bytes))
}

/// Verifies that the instruction immediately preceding the current one is an
/// Ed25519Program verification of `expected_message` signed by `expected_signer`.
///
/// The signature itself is checked by the runtime when the Ed25519 instruction
/// executes; if it were invalid the transaction would already have failed.
pub fn verify_qr_signature(
    instructions_sysvar: &AccountInfo,
    expected_signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(instructions_sysvar)? as usize;
    require!(current_index > 0, LoyalError::MissingEd25519Instruction);

    let ed25519_ix = load_instruction_at_checked(current_index - 1, instructions_sysvar)?;
    require!(
        ed25519_ix.program_id == ed25519_program::ID,
        LoyalError::MissingEd25519Instruction
    );
    // The native program takes no accounts; a nonstandard ix shape is rejected.
    require!(
        ed25519_ix.accounts.is_empty(),
        LoyalError::MalformedEd25519Instruction
    );

    let data = ed25519_ix.data.as_slice();
    require!(data.len() > 2, LoyalError::MalformedEd25519Instruction);
    let num_signatures = data[0];
    // Exactly one signature keeps offset auditing trivial and rules out
    // smuggling a second, unrelated verification into the same instruction.
    require!(num_signatures == 1, LoyalError::MalformedEd25519Instruction);

    let table = OFFSETS_TABLE_START;
    require!(
        data.len() >= table + OFFSETS_ENTRY_LEN,
        LoyalError::MalformedEd25519Instruction
    );

    let signature_offset = read_u16(data, table)?;
    let signature_ix_index = read_u16(data, table + 2)?;
    let pubkey_offset = read_u16(data, table + 4)? as usize;
    let pubkey_ix_index = read_u16(data, table + 6)?;
    let message_offset = read_u16(data, table + 8)? as usize;
    let message_size = read_u16(data, table + 10)? as usize;
    let message_ix_index = read_u16(data, table + 12)?;

    // All referenced data must live inside the ed25519 instruction itself
    // (u16::MAX means "current instruction" in some SDKs; we require explicit
    // self-reference as produced by Ed25519Program.createInstructionWithPublicKey).
    let self_index = (current_index - 1) as u16;
    for ix_index in [signature_ix_index, pubkey_ix_index, message_ix_index] {
        require!(
            ix_index == self_index || ix_index == u16::MAX,
            LoyalError::MalformedEd25519Instruction
        );
    }
    // Signature must also be embedded (we don't inspect it, the runtime does,
    // but an out-of-bounds offset would have failed the native program anyway).
    let _ = signature_offset;

    let pubkey_bytes = data
        .get(pubkey_offset..pubkey_offset + 32)
        .ok_or(LoyalError::MalformedEd25519Instruction)?;
    require!(
        pubkey_bytes == expected_signer.as_ref(),
        LoyalError::QrSignerMismatch
    );

    let message_bytes = data
        .get(message_offset..message_offset + message_size)
        .ok_or(LoyalError::MalformedEd25519Instruction)?;
    require!(
        message_bytes == expected_message,
        LoyalError::QrPayloadMismatch
    );

    Ok(())
}
