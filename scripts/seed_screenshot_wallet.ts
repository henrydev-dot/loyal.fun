/**
 * Prepares a wallet with realistic on-chain state so documentation
 * screenshots show the app doing its job rather than four empty states.
 *
 * Issues points from the demo merchant, opens a leveraged position, and
 * prints the base58 secret key to drop into the browser's localStorage
 * under `loyal.fun/burner-wallet/v1`.
 *
 * Usage: RPC_URL=... npx ts-node scripts/seed_screenshot_wallet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import { loadCore, loadWallet, makeProvider } from "./common";
import {
  ataFor,
  configPda,
  ed25519VerifyIx,
  loyalMintPda,
  merchantPda,
  noncePda,
  qrMessage,
  userProfilePda,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "../tests/helpers";

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

  const demo = Keypair.generate();
  console.log(`wallet:  ${demo.publicKey.toBase58()}`);
  console.log(`secret:  ${bs58.encode(demo.secretKey)}`);

  // Rent for the profile, nonce marker and ATA the first scan creates.
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: demo.publicKey,
        lamports: 20_000_000,
      })
    )
  );

  // Two scans on separate "visits" so the profile shows a real streak.
  for (const points of [1200n, 850n]) {
    const nonce = BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1e6));
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 120);
    const issueIx = await core.methods
      .issuePoints(
        new anchor.BN(points.toString()),
        new anchor.BN(nonce.toString()),
        new anchor.BN(expiry.toString())
      )
      .accounts({
        user: demo.publicKey,
        config,
        merchant,
        userProfile: userProfilePda(core.programId, demo.publicKey),
        nonceAccount: noncePda(core.programId, merchant, nonce),
        loyalMint,
        userAta: ataFor(loyalMint, demo.publicKey),
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const signature = await provider.sendAndConfirm(
      new Transaction().add(
        ed25519VerifyIx(qrSigner, qrMessage(merchant, points, nonce, expiry)),
        issueIx
      ),
      [demo]
    );
    console.log(`issued ${points} pts: ${signature}`);
  }

  const balance = await provider.connection.getTokenAccountBalance(
    ataFor(loyalMint, demo.publicKey)
  );
  console.log(`balance: ${balance.value.amount} $LOYAL`);
  console.log(
    `\nlocalStorage.setItem("loyal.fun/burner-wallet/v1", "${bs58.encode(demo.secretKey)}")`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
