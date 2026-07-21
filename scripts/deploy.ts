/**
 * Post-`anchor deploy` bootstrap for devnet:
 *  1. initialize_config           (creates the $LOYAL Token-2022 mint)
 *  2. hook: initialize_whitelist + whitelist the config PDA
 *  3. hook: initialize_extra_account_meta_list for the mint
 *  4. create the Bubblegum coupon tree + delegate it to the config PDA
 *  5. set_coupon_tree
 *  6. register the demo merchant "Kadıköy Coffee Lab" + 3 listings
 *
 * Prints everything the relayer/.env and app/.env.local need.
 *
 * Usage: RPC_URL=https://api.devnet.solana.com npx ts-node scripts/deploy.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createTree,
  mplBubblegum,
  setTreeDelegate,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  generateSigner,
  keypairIdentity,
  publicKey as umiPk,
} from "@metaplex-foundation/umi";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import {
  explorerAddr,
  loadCore,
  loadHook,
  loadWallet,
  logTx,
  makeProvider,
  RPC_URL,
} from "./common";
import {
  configPda,
  listingPda,
  loyalMintPda,
  merchantPda,
  TOKEN_2022_PROGRAM_ID,
} from "../tests/helpers";

const OUT_FILE = path.join(__dirname, "..", ".deploy-out.json");

async function main() {
  const provider = makeProvider();
  const admin = loadWallet();
  const core = loadCore(provider);
  const hook = loadHook(provider);

  const config = configPda(core.programId);
  const loyalMint = loyalMintPda(core.programId);
  console.log(`admin:      ${admin.publicKey.toBase58()}`);
  console.log(`loyal_core: ${core.programId.toBase58()}`);
  console.log(`loyal_hook: ${hook.programId.toBase58()}`);
  console.log(`config PDA: ${config.toBase58()}`);
  console.log(`$LOYAL:     ${loyalMint.toBase58()}`);
  console.log();

  // 1. Config + mint ---------------------------------------------------------
  if (await provider.connection.getAccountInfo(config)) {
    console.log("config already initialized, skipping");
  } else {
    const sig = await core.methods
      .initializeConfig(
        200, // fee_bps 2%
        5, // max leverage
        new anchor.BN(100_000), // max stake / position
        new anchor.BN(10_000), // max points / issuance tx
        new anchor.BN(10_000_000) // global exposure cap
      )
      .accounts({
        admin: admin.publicKey,
        config,
        loyalMint,
        hookProgram: hook.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    logTx("initialize_config (creates $LOYAL Token-2022 mint)", sig);
  }

  // 2. Hook whitelist --------------------------------------------------------
  const whitelist = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist")],
    hook.programId
  )[0];
  if (!(await provider.connection.getAccountInfo(whitelist))) {
    const sig = await hook.methods
      .initializeWhitelist()
      .accounts({
        payer: admin.publicKey,
        whitelist,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    logTx("hook.initialize_whitelist", sig);

    const sig2 = await hook.methods
      .addToWhitelist(config)
      .accounts({ admin: admin.publicKey, whitelist })
      .rpc();
    logTx("hook.add_to_whitelist(config PDA)", sig2);
  }

  // 3. ExtraAccountMetaList for the mint ------------------------------------
  const metaList = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), loyalMint.toBuffer()],
    hook.programId
  )[0];
  if (!(await provider.connection.getAccountInfo(metaList))) {
    const sig = await hook.methods
      .initializeExtraAccountMetaList()
      .accounts({
        payer: admin.publicKey,
        extraAccountMetaList: metaList,
        mint: loyalMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    logTx("hook.initialize_extra_account_meta_list", sig);
  }

  // 4. Bubblegum coupon tree -------------------------------------------------
  const umi = createUmi(RPC_URL).use(mplBubblegum());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(admin.secretKey)));

  const merkleTreeSigner = generateSigner(umi);
  // 2^14 = 16k coupons for ~0.34 SOL of rent — compression economics.
  await (
    await createTree(umi, {
      merkleTree: merkleTreeSigner,
      maxDepth: 14,
      maxBufferSize: 64,
      public: false,
    })
  ).sendAndConfirm(umi);
  const merkleTree = new PublicKey(merkleTreeSigner.publicKey.toString());
  console.log(`coupon tree: ${merkleTree.toBase58()} (${explorerAddr(merkleTree)})`);

  await setTreeDelegate(umi, {
    merkleTree: merkleTreeSigner.publicKey,
    newTreeDelegate: umiPk(config.toBase58()),
  }).sendAndConfirm(umi);
  console.log("tree delegate -> config PDA");

  const sigTree = await core.methods
    .setCouponTree(merkleTree)
    .accounts({ admin: admin.publicKey, config })
    .rpc();
  logTx("set_coupon_tree", sigTree);

  // 5. Demo merchant + listings ---------------------------------------------
  const qrSigner = Keypair.generate();
  const merchant = merchantPda(core.programId, admin.publicKey);
  if (!(await provider.connection.getAccountInfo(merchant))) {
    const sig = await core.methods
      .registerMerchant(
        "Kadıköy Coffee Lab",
        "cafe",
        qrSigner.publicKey,
        new anchor.BN(1_000_000)
      )
      .accounts({
        authority: admin.publicKey,
        config,
        merchant,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    logTx("register_merchant(Kadıköy Coffee Lab)", sig);
  }

  const listings: Array<[string, number, number, string]> = [
    ["1 Free Coffee", 500, 100, "https://loyal.fun/rewards/coffee.json"],
    ["10€ Off Your Bill", 1200, 50, "https://loyal.fun/rewards/discount10.json"],
    ["Degen Breakfast Combo", 2000, 25, "https://loyal.fun/rewards/breakfast.json"],
  ];
  const merchantState: any = await (core.account as any).merchant.fetch(merchant);
  let listingId = BigInt(merchantState.listingCount.toString());
  for (const [title, price, stock, uri] of listings) {
    const listing = listingPda(core.programId, merchant, listingId);
    const sig = await core.methods
      .createListing(title, new anchor.BN(price), stock, uri)
      .accounts({
        authority: admin.publicKey,
        config,
        merchant,
        listing,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    logTx(`create_listing("${title}")`, sig);
    listingId += 1n;
  }

  // 6. Hand-off file for seed_demo.ts + relayer -----------------------------
  const out = {
    rpcUrl: RPC_URL,
    loyalCore: core.programId.toBase58(),
    loyalHook: hook.programId.toBase58(),
    config: config.toBase58(),
    loyalMint: loyalMint.toBase58(),
    couponTree: merkleTree.toBase58(),
    merchant: merchant.toBase58(),
    merchantAuthority: admin.publicKey.toBase58(),
    qrSignerSecret: bs58.encode(qrSigner.secretKey),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${OUT_FILE}`);
  console.log("\nrelayer/.env values:");
  console.log(`  MERCHANT_PDA=${merchant.toBase58()}`);
  console.log(`  MERCHANT_QR_SECRET=${bs58.encode(qrSigner.secretKey)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
