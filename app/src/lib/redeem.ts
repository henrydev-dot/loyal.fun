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

/** Proof nodes required = maxDepth (14) - canopyDepth (10). */
const PROOF_LEN = 4;

export async function buildRedeemTxBase64(
  wallet: Keypair,
  coupon: CouponAsset
): Promise<string> {
  const program = await getProgram(wallet);

  // Coupon -> listing: the coupon cNFT's name is the listing title (set at
  // purchase). Demo-grade matching; production would carry the listing id in
  // the coupon's on-chain uri.
  const listings = await (program.account as any).rewardListing.all();
  const listing = listings.find((l: any) => l.account.title === coupon.name);
  if (!listing) throw new Error(`no listing matches coupon "${coupon.name}"`);

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
      proof.proof.slice(0, PROOF_LEN).map((node) => ({
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
