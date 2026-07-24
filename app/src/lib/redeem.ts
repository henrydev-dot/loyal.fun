/**
 * Burn-to-redeem handshake.
 *
 * The program requires BOTH the coupon holder and the merchant authority to
 * sign `redeem_reward`. At the till this happens as a QR handoff:
 *
 *   customer app : builds the redeem tx, signs as leaf owner, encodes the
 *                  partially-signed tx (base64) into the coupon QR
 *   merchant app : scans the QR, inspects it, co-signs as merchant authority
 *                  and submits through the relayer
 *
 * The blockhash gives the QR a ~60-90s life, matching the earn QR's TTL.
 * The coupon tree is created with canopyDepth 10 (depth 14), so only 4 proof
 * nodes ride along and the whole transaction stays QR-sized.
 */
import * as anchor from "@coral-xyz/anchor";
import bs58 from "bs58";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getProgram } from "./program";
import { connection, relayerFeePayer } from "./relayer";
import { CouponAsset, getAssetProof } from "./das";
import { configPda } from "./pdas";

const BUBBLEGUM = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const NOOP = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const COMPRESSION = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

/**
 * Proof nodes to send = maxDepth - canopyDepth. The deploy script builds a
 * depth-14 tree with a depth-10 canopy, so 4 — but derive it from the proof
 * the RPC returns rather than trusting that forever.
 */
const CANOPY_DEPTH = 10;

export async function buildRedeemTxBase64(
  wallet: Keypair,
  coupon: CouponAsset
): Promise<string> {
  const program = await getProgram(wallet);

  // Coupon -> listing. Preferred: the listing PDA is encoded in the coupon's
  // URI at purchase (`?listing=<pda>`), which is unambiguous. Fallback for
  // coupons minted before that: match the cNFT name, which the program
  // truncates to 32 chars, against the same truncation of each title.
  const listings = await (program.account as any).rewardListing.all();
  const fromUri = coupon.uri.match(/[?&]listing=([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1];
  const listing = fromUri
    ? listings.find((l: any) => l.publicKey.toBase58() === fromUri)
    : listings.find((l: any) => String(l.account.title).slice(0, 32) === coupon.name);
  if (!listing) {
    throw new Error(
      `No listing matches this coupon${fromUri ? "" : ` ("${coupon.name}")`}. It may belong to a shop that removed the reward.`
    );
  }

  const merchantAcc: any = await (program.account as any).merchant.fetch(
    listing.account.merchant
  );

  const assetId = new PublicKey(coupon.id);
  const proof = await getAssetProof(coupon.id);
  const merkleTree = new PublicKey(proof.tree_id);
  const treeConfig = PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    BUBBLEGUM
  )[0];
  const receipt = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), assetId.toBuffer()],
    program.programId
  )[0];

  const ix = await program.methods
    .redeemReward(
      assetId,
      Array.from(bs58.decode(proof.root)),
      Array.from(bs58.decode(coupon.compression.data_hash)),
      Array.from(bs58.decode(coupon.compression.creator_hash)),
      new anchor.BN(coupon.compression.leaf_id),
      coupon.compression.leaf_id
    )
    .accounts({
      user: wallet.publicKey,
      merchantAuthority: merchantAcc.authority,
      config: configPda(),
      merchant: listing.account.merchant,
      listing: listing.publicKey,
      receipt,
      treeConfig,
      merkleTree,
      logWrapper: NOOP,
      compressionProgram: COMPRESSION,
      bubblegumProgram: BUBBLEGUM,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      proof.proof.slice(0, Math.max(0, proof.proof.length - CANOPY_DEPTH)).map((node) => ({
        pubkey: new PublicKey(node),
        isSigner: false,
        isWritable: false,
      }))
    )
    .instruction();

  const feePayer = await relayerFeePayer();
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.add(ix);
  tx.partialSign(wallet); // customer's leaf-owner signature

  return tx.serialize({ requireAllSignatures: false }).toString("base64");
}
