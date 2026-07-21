/** Shared test/SDK helpers: PDAs, QR payload construction, ed25519 ix. */
import * as anchor from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function loyalMintPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("loyal-mint")], programId)[0];
}

export function merchantPda(programId: PublicKey, authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("merchant"), authority.toBuffer()],
    programId
  )[0];
}

export function userProfilePda(programId: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), wallet.toBuffer()],
    programId
  )[0];
}

export function noncePda(
  programId: PublicKey,
  merchant: PublicKey,
  nonce: bigint
): PublicKey {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nonce"), merchant.toBuffer(), nonceBuf],
    programId
  )[0];
}

export function vaultPda(programId: PublicKey, symbol: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(symbol)],
    programId
  )[0];
}

export function mockPricePda(programId: PublicKey, vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mock-price"), vault.toBuffer()],
    programId
  )[0];
}

export function positionPda(
  programId: PublicKey,
  user: PublicKey,
  vault: PublicKey,
  positionId: bigint
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(positionId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), vault.toBuffer(), idBuf],
    programId
  )[0];
}

export function listingPda(
  programId: PublicKey,
  merchant: PublicKey,
  listingId: bigint
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(listingId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), merchant.toBuffer(), idBuf],
    programId
  )[0];
}

export function badgeMintPda(programId: PublicKey, badgeId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("badge-mint"), Buffer.from([badgeId])],
    programId
  )[0];
}

export function ataFor(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

/**
 * The exact 56-byte payload a merchant QR signer commits to:
 * merchant pubkey (32) || points u64 LE || nonce u64 LE || expiry i64 LE.
 * Must match utils/ed25519.rs::qr_message.
 */
export function qrMessage(
  merchant: PublicKey,
  points: bigint,
  nonce: bigint,
  expiryTs: bigint
): Buffer {
  const msg = Buffer.alloc(56);
  merchant.toBuffer().copy(msg, 0);
  msg.writeBigUInt64LE(points, 32);
  msg.writeBigUInt64LE(nonce, 40);
  msg.writeBigInt64LE(expiryTs, 48);
  return msg;
}

/** Builds the Ed25519Program verification ix that must precede issue_points. */
export function ed25519VerifyIx(
  qrSigner: Keypair,
  message: Buffer
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: qrSigner.secretKey,
    message,
  });
}

export function scaled1e6(x: number): anchor.BN {
  return new anchor.BN(Math.round(x * 1_000_000));
}
