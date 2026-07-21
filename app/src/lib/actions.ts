/**
 * All on-chain actions the customer app performs, funneled through the
 * relayer so the user never needs SOL. Every function returns the tx
 * signature so the UI can link straight to Solana Explorer.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { getProgram } from "./program";
import { connection, sendSponsored, QrPayload } from "./relayer";
import {
  ataFor,
  configPda,
  loyalMintPda,
  noncePda,
  positionPda,
  userProfilePda,
  vaultPda,
} from "./pdas";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./config";

/** Rebuilds the signed 56-byte QR message (must match the program). */
function qrMessage(payload: QrPayload): Buffer {
  const msg = Buffer.alloc(56);
  new PublicKey(payload.merchant).toBuffer().copy(msg, 0);
  msg.writeBigUInt64LE(BigInt(payload.points), 32);
  msg.writeBigUInt64LE(BigInt(payload.nonce), 40);
  msg.writeBigInt64LE(BigInt(payload.expiry), 48);
  return msg;
}

export async function scanAndEarn(wallet: Keypair, payload: QrPayload): Promise<string> {
  const program = await getProgram(wallet);
  const merchant = new PublicKey(payload.merchant);

  const verifyIx = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(payload.qrSigner).toBytes(),
    message: qrMessage(payload),
    signature: Buffer.from(payload.signature, "base64"),
  });

  const issueIx = await program.methods
    .issuePoints(
      new anchor.BN(payload.points),
      new anchor.BN(payload.nonce),
      new anchor.BN(payload.expiry)
    )
    .accounts({
      user: wallet.publicKey,
      config: configPda(),
      merchant,
      userProfile: userProfilePda(wallet.publicKey),
      nonceAccount: noncePda(merchant, BigInt(payload.nonce)),
      loyalMint: loyalMintPda(),
      userAta: ataFor(loyalMintPda(), wallet.publicKey),
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return sendSponsored([verifyIx, issueIx], [wallet]);
}

export async function loyalBalance(wallet: PublicKey): Promise<bigint> {
  try {
    const info = await connection.getTokenAccountBalance(
      ataFor(loyalMintPda(), wallet)
    );
    return BigInt(info.value.amount);
  } catch {
    return 0n; // ATA not created yet
  }
}

export async function fetchProfile(wallet: Keypair): Promise<any | null> {
  const program = await getProgram(wallet);
  try {
    return await (program.account as any).userProfile.fetch(
      userProfilePda(wallet.publicKey)
    );
  } catch {
    return null;
  }
}

export interface OpenPositionArgs {
  symbol: string;
  stake: number;
  leverage: 1 | 2 | 5;
  /** Pyth PriceUpdateV2 account holding a fresh price for the vault's feed. */
  priceUpdate: PublicKey;
}

export async function openPosition(
  wallet: Keypair,
  args: OpenPositionArgs
): Promise<string> {
  const program = await getProgram(wallet);
  const profile = await fetchProfile(wallet);
  const positionId = BigInt(profile?.positionCount?.toString() ?? "0");
  const vault = vaultPda(args.symbol);

  const ix = await program.methods
    .openPosition(
      new anchor.BN(positionId.toString()),
      new anchor.BN(args.stake),
      args.leverage
    )
    .accounts({
      user: wallet.publicKey,
      config: configPda(),
      vault,
      userProfile: userProfilePda(wallet.publicKey),
      position: positionPda(wallet.publicKey, vault, positionId),
      priceUpdate: args.priceUpdate,
      loyalMint: loyalMintPda(),
      userAta: ataFor(loyalMintPda(), wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return sendSponsored([ix], [wallet]);
}

export async function closePosition(
  wallet: Keypair,
  symbol: string,
  positionId: bigint,
  priceUpdate: PublicKey
): Promise<string> {
  const program = await getProgram(wallet);
  const vault = vaultPda(symbol);

  const ix = await program.methods
    .closePosition()
    .accounts({
      user: wallet.publicKey,
      config: configPda(),
      vault,
      userProfile: userProfilePda(wallet.publicKey),
      position: positionPda(wallet.publicKey, vault, positionId),
      priceUpdate,
      loyalMint: loyalMintPda(),
      userAta: ataFor(loyalMintPda(), wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();

  return sendSponsored([ix], [wallet]);
}

export async function fetchOpenPositions(wallet: Keypair): Promise<any[]> {
  const program = await getProgram(wallet);
  const all = await (program.account as any).position.all([
    // memcmp on the user field (offset 8 = right after the discriminator)
    { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
  ]);
  return all.filter((p: any) => Object.keys(p.account.status)[0] === "open");
}

export async function fetchListings(wallet: Keypair): Promise<any[]> {
  const program = await getProgram(wallet);
  return (program.account as any).rewardListing.all();
}

export async function buyReward(
  wallet: Keypair,
  listing: PublicKey,
  couponTree: PublicKey
): Promise<string> {
  const program = await getProgram(wallet);
  const BUBBLEGUM = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
  const treeConfig = PublicKey.findProgramAddressSync(
    [couponTree.toBuffer()],
    BUBBLEGUM
  )[0];

  const ix = await program.methods
    .buyReward()
    .accounts({
      user: wallet.publicKey,
      config: configPda(),
      listing,
      userProfile: userProfilePda(wallet.publicKey),
      loyalMint: loyalMintPda(),
      userAta: ataFor(loyalMintPda(), wallet.publicKey),
      treeConfig,
      merkleTree: couponTree,
      logWrapper: new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
      compressionProgram: new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK"),
      bubblegumProgram: BUBBLEGUM,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return sendSponsored([ix], [wallet]);
}

export async function fetchConfig(wallet: Keypair): Promise<any> {
  const program = await getProgram(wallet);
  return (program.account as any).config.fetch(configPda());
}

export async function claimBadge(wallet: Keypair, badgeId: number): Promise<string> {
  const program = await getProgram(wallet);
  const { badgeMintPda } = await import("./pdas");
  const badgeMint = badgeMintPda(badgeId);

  const ix = await program.methods
    .claimBadge(badgeId)
    .accounts({
      user: wallet.publicKey,
      config: configPda(),
      userProfile: userProfilePda(wallet.publicKey),
      badgeMint,
      userBadgeAta: ataFor(badgeMint, wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return sendSponsored([ix], [wallet]);
}
