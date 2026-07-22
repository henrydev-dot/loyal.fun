/**
 * Runs one full happy path on devnet and prints every transaction signature
 * with an explorer link, ready to paste into README.md:
 *
 *   issue 200 points -> open 5x BONK position (Pyth price posted on-chain)
 *   -> close position -> buy "1 Free Coffee" coupon (cNFT) -> redeem it
 *   -> claim the "First Blood" badge (soulbound Token-2022)
 *
 * Requires scripts/deploy.ts + scripts/create_vaults.ts to have run first
 * (.deploy-out.json must exist). Redemption needs a DAS-capable RPC
 * (e.g. free Helius devnet) in RPC_URL to fetch the coupon's merkle proof.
 *
 * Usage: RPC_URL=... npx ts-node scripts/seed_demo.ts
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { dasApi } from "@metaplex-foundation/digital-asset-standard-api";
import {
  findLeafAssetIdPda,
  getAssetWithProof,
  mplBubblegum,
  parseLeafFromMintV1Transaction,
} from "@metaplex-foundation/mpl-bubblegum";
import { publicKey as umiPk } from "@metaplex-foundation/umi";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import { explorer, loadCore, loadWallet, makeProvider, PYTH_FEEDS, RPC_URL } from "./common";
import {
  ataFor,
  badgeMintPda,
  configPda,
  ed25519VerifyIx,
  listingPda,
  loyalMintPda,
  merchantPda,
  noncePda,
  positionPda,
  qrMessage,
  userProfilePda,
  vaultPda,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "../tests/helpers";

const BUBBLEGUM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const COMPRESSION_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const NOOP_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

const results: Array<[string, string]> = [];
const record = (label: string, sig: string) => {
  results.push([label, sig]);
  console.log(`✔ ${label}: ${explorer(sig)}`);
};

async function main() {
  const out = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".deploy-out.json"), "utf8")
  );
  const provider = makeProvider();
  const admin = loadWallet();
  const core = loadCore(provider);

  const config = configPda(core.programId);
  const loyalMint = loyalMintPda(core.programId);
  const merchant = merchantPda(core.programId, admin.publicKey);
  const qrSigner = Keypair.fromSecretKey(bs58.decode(out.qrSignerSecret));
  const couponTree = new PublicKey(out.couponTree);
  const treeConfig = PublicKey.findProgramAddressSync(
    [couponTree.toBuffer()],
    BUBBLEGUM_ID
  )[0];

  // Demo customer, funded from the admin wallet (no airdrop rate limits).
  const customer = Keypair.generate();
  const customerProfile = userProfilePda(core.programId, customer.publicKey);
  const customerAta = ataFor(loyalMint, customer.publicKey);
  {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: customer.publicKey,
        lamports: 100_000_000, // 0.1 SOL for rent; fees are payer-covered
      })
    );
    await provider.sendAndConfirm(tx);
  }
  console.log(`demo customer: ${customer.publicKey.toBase58()}`);

  // -------------------------------------------------------------------------
  // 1. EARN — merchant-signed QR -> issue_points
  // -------------------------------------------------------------------------
  const points = 2_000n;
  const nonce = BigInt(Date.now());
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
  const message = qrMessage(merchant, points, nonce, expiry);

  const issueIx = await core.methods
    .issuePoints(
      new anchor.BN(points.toString()),
      new anchor.BN(nonce.toString()),
      new anchor.BN(expiry.toString())
    )
    .accounts({
      user: customer.publicKey,
      config,
      merchant,
      userProfile: customerProfile,
      nonceAccount: noncePda(core.programId, merchant, nonce),
      loyalMint,
      userAta: customerAta,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const issueSig = await provider.sendAndConfirm(
    new Transaction().add(ed25519VerifyIx(qrSigner, message), issueIx),
    [customer]
  );
  record("issue_points (+2000 $LOYAL via signed QR)", issueSig);

  // -------------------------------------------------------------------------
  // 2. DEGEN — post Pyth price on-chain, open & close a 5x BONK position
  // -------------------------------------------------------------------------
  const symbol = "BONK";
  const vault = vaultPda(core.programId, symbol);
  const feedIdHex = `0x${PYTH_FEEDS[symbol]}`;

  const hermes = new HermesClient("https://hermes.pyth.network", {});
  const receiver = new PythSolanaReceiver({
    connection: provider.connection,
    wallet: provider.wallet as anchor.Wallet,
  });

  const positionId = 0n;
  const position = positionPda(core.programId, customer.publicKey, vault, positionId);

  const withFreshPrice = async (
    label: string,
    buildIx: (priceUpdateAccount: PublicKey) => Promise<anchor.web3.TransactionInstruction>
  ) => {
    const update = await hermes.getLatestPriceUpdates([feedIdHex], {
      encoding: "base64",
    });
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
    await builder.addPostPriceUpdates(update.binary.data);
    await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => [
      {
        instruction: await buildIx(getPriceUpdateAccount(feedIdHex)),
        signers: [customer],
      },
    ]);
    const sigs = await receiver.provider.sendAll(
      await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 100_000 }),
      { skipPreflight: false }
    );
    // Last signature is the consumer tx (post/close txs precede it).
    record(label, sigs[sigs.length - 1]);
  };

  await withFreshPrice("open_position (5x long BONK, 1000 pts)", (priceUpdate) =>
    core.methods
      .openPosition(new anchor.BN(positionId.toString()), new anchor.BN(1_000), 5)
      .accounts({
        user: customer.publicKey,
        config,
        vault,
        userProfile: customerProfile,
        position,
        priceUpdate,
        loyalMint,
        userAta: customerAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );

  await withFreshPrice("close_position (settle PnL, 2% fee burned)", (priceUpdate) =>
    core.methods
      .closePosition()
      .accounts({
        user: customer.publicKey,
        config,
        vault,
        userProfile: customerProfile,
        position,
        priceUpdate,
        loyalMint,
        userAta: customerAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction()
  );

  // -------------------------------------------------------------------------
  // 3. SPEND — buy the coffee coupon (cNFT) and redeem it at the till
  // -------------------------------------------------------------------------
  const listing = listingPda(core.programId, merchant, 0n);
  const buySig = await core.methods
    .buyReward()
    .accounts({
      user: customer.publicKey,
      config,
      listing,
      userProfile: customerProfile,
      loyalMint,
      userAta: customerAta,
      treeConfig,
      merkleTree: couponTree,
      logWrapper: NOOP_ID,
      compressionProgram: COMPRESSION_ID,
      bubblegumProgram: BUBBLEGUM_ID,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([customer])
    .rpc();
  record("buy_reward (1 Free Coffee -> coupon cNFT minted)", buySig);

  // Redemption needs the coupon's leaf + merkle proof (DAS RPC).
  try {
    const umi = createUmi(RPC_URL).use(mplBubblegum()).use(dasApi());
    const leaf = await parseLeafFromMintV1Transaction(umi, bs58.decode(buySig));
    const assetId = findLeafAssetIdPda(umi, {
      merkleTree: umiPk(couponTree.toBase58()),
      leafIndex: leaf.nonce,
    })[0];
    console.log(`coupon asset id: ${assetId}`);

    // `as any`: the root and mpl-bubblegum-nested copies of the DAS api
    // package declare structurally-identical but nominally-distinct types.
    const proof = await getAssetWithProof(umi as any, assetId, { truncateCanopy: true });
    const receipt = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), new PublicKey(assetId.toString()).toBuffer()],
      core.programId
    )[0];

    const redeemSig = await core.methods
      .redeemReward(
        new PublicKey(assetId.toString()),
        Array.from(bs58.decode(proof.root.toString())) as any,
        Array.from(bs58.decode(proof.dataHash.toString())) as any,
        Array.from(bs58.decode(proof.creatorHash.toString())) as any,
        new anchor.BN(proof.nonce.toString()),
        proof.index
      )
      .accounts({
        user: customer.publicKey,
        merchantAuthority: admin.publicKey,
        config,
        merchant,
        listing,
        receipt,
        treeConfig,
        merkleTree: couponTree,
        logWrapper: NOOP_ID,
        compressionProgram: COMPRESSION_ID,
        bubblegumProgram: BUBBLEGUM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        proof.proof.map((node: any) => ({
          pubkey: new PublicKey(node.toString()),
          isSigner: false,
          isWritable: false,
        }))
      )
      .signers([customer])
      .rpc();
    record("redeem_reward (coupon burned at the till + receipt)", redeemSig);
  } catch (err) {
    console.warn(
      `⚠ redeem skipped: ${String(err).slice(0, 200)}\n` +
        "  (redemption needs a DAS-capable RPC in RPC_URL, e.g. free Helius devnet)"
    );
  }

  // -------------------------------------------------------------------------
  // 4. FLEX — claim the "First Blood" soulbound badge
  // -------------------------------------------------------------------------
  const badgeId = 0; // FirstTrade
  const badgeMint = badgeMintPda(core.programId, badgeId);
  const badgeAta = ataFor(badgeMint, customer.publicKey);
  const badgeSig = await core.methods
    .claimBadge(badgeId)
    .accounts({
      user: customer.publicKey,
      config,
      userProfile: customerProfile,
      badgeMint,
      userBadgeAta: badgeAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([customer])
    .rpc();
  record('claim_badge ("First Blood" soulbound Token-2022)', badgeSig);

  // -------------------------------------------------------------------------
  // README-ready output
  // -------------------------------------------------------------------------
  console.log("\n===== paste into README.md =====\n");
  for (const [label, sig] of results) {
    console.log(`| ${label} | [\`${sig.slice(0, 8)}…\`](${explorer(sig)}) |`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
