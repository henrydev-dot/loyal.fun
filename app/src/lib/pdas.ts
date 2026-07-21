import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CORE_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "./config";

const pid = CORE_PROGRAM_ID;

export const configPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], pid)[0];

export const loyalMintPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("loyal-mint")], pid)[0];

export const userProfilePda = (wallet: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("user"), wallet.toBuffer()], pid)[0];

export const noncePda = (merchant: PublicKey, nonce: bigint) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nonce"), merchant.toBuffer(), buf],
    pid
  )[0];
};

export const vaultPda = (symbol: string) =>
  PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from(symbol)], pid)[0];

export const positionPda = (user: PublicKey, vault: PublicKey, positionId: bigint) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(positionId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), vault.toBuffer(), buf],
    pid
  )[0];
};

export const badgeMintPda = (badgeId: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("badge-mint"), Buffer.from([badgeId])],
    pid
  )[0];

export const ataFor = (mint: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
