/**
 * POST /api/sponsor — gasless UX: validates a user's partially-signed
 * transaction, co-signs it as fee payer and submits it.
 *
 * SECURITY MODEL. The relayer holds a funded devnet keypair and signs
 * whatever it is handed, so the validation below is the entire defence:
 *
 *  1. Fee payer must be us (slot 0) — otherwise we'd be signing for a
 *     transaction whose fees we don't even pay.
 *  2. Every top-level instruction must target a whitelisted program.
 *  3. **No instruction may reference the fee payer as an account.** This is
 *     the one that matters: the System Program is necessarily whitelisted
 *     (accounts get created), so without this check a caller could submit
 *     `SystemProgram.transfer({ from: relayer, to: attacker })` and drain
 *     the wallet in a single request. No legitimate loyal.fun instruction
 *     passes the relayer as an account — it is purely the fee payer.
 *  4. No address-lookup tables: they resolve accounts we can't inspect here.
 *
 * Rent top-ups are folded into this route (rather than a standalone faucet)
 * so every lamport we hand out is attached to an already-validated
 * transaction instead of being claimable by anyone with a fresh keypair.
 */
import { NextResponse } from "next/server";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ALLOWED_PROGRAMS,
  loadFeePayer,
  MAX_TX_BYTES,
  rateLimit,
  RENT_THRESHOLD_LAMPORTS,
  RENT_TOP_UP_LAMPORTS,
  safeError,
  serverConnection,
} from "../_lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!rateLimit(req, 30, "sponsor")) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  try {
    const { transaction } = (await req.json()) as { transaction?: string };
    if (!transaction || typeof transaction !== "string") {
      return NextResponse.json({ error: "missing base64 `transaction`" }, { status: 400 });
    }

    const raw = Buffer.from(transaction, "base64");
    if (raw.length === 0 || raw.length > MAX_TX_BYTES) {
      return NextResponse.json({ error: "transaction size out of bounds" }, { status: 400 });
    }

    const feePayer = loadFeePayer();
    const tx = VersionedTransaction.deserialize(raw);
    const msg = tx.message;
    const accountKeys = msg.getAccountKeys();

    // (1) we must be the fee payer
    const declaredFeePayer = accountKeys.get(0);
    if (!declaredFeePayer || !declaredFeePayer.equals(feePayer.publicKey)) {
      return NextResponse.json({ error: "fee payer must be the relayer" }, { status: 400 });
    }

    // (4) lookup tables would hide accounts from the checks below
    if (msg.addressTableLookups.length > 0) {
      return NextResponse.json({ error: "address lookup tables not allowed" }, { status: 400 });
    }

    for (const ix of msg.compiledInstructions) {
      // (2) program whitelist
      const programId = accountKeys.get(ix.programIdIndex);
      if (!programId || !ALLOWED_PROGRAMS.has(programId.toBase58())) {
        return NextResponse.json(
          { error: `program not allowed: ${programId?.toBase58() ?? "unknown"}` },
          { status: 400 }
        );
      }
      // (3) the relayer is never an instruction account — see header comment
      if (ix.accountKeyIndexes.includes(0)) {
        return NextResponse.json(
          { error: "relayer may not be used as an instruction account" },
          { status: 400 }
        );
      }
    }

    const connection = serverConnection();

    // Rent top-up for the transaction's other signers (the user's burner
    // wallet, and the merchant's on a redemption). Only reachable via a
    // transaction that already passed every check above.
    const signerCount = msg.header.numRequiredSignatures;
    const needsRent: PublicKey[] = [];
    for (let i = 1; i < signerCount; i++) {
      const signer = accountKeys.get(i);
      if (!signer) continue;
      const balance = await connection.getBalance(signer).catch(() => RENT_THRESHOLD_LAMPORTS);
      if (balance < RENT_THRESHOLD_LAMPORTS) needsRent.push(signer);
    }

    if (needsRent.length > 0) {
      const funding = new Transaction();
      for (const target of needsRent) {
        funding.add(
          SystemProgram.transfer({
            fromPubkey: feePayer.publicKey,
            toPubkey: target,
            lamports: RENT_TOP_UP_LAMPORTS,
          })
        );
      }
      funding.feePayer = feePayer.publicKey;
      const fundingBlockhash = await connection.getLatestBlockhash();
      funding.recentBlockhash = fundingBlockhash.blockhash;
      funding.sign(feePayer);
      const fundingSignature = await connection.sendRawTransaction(funding.serialize());
      await connection.confirmTransaction(
        { signature: fundingSignature, ...fundingBlockhash },
        "confirmed"
      );
    }

    tx.sign([feePayer]);

    // Confirm against the blockhash the transaction was actually built with,
    // so expiry is detected correctly instead of against a newer one.
    const txBlockhash = msg.recentBlockhash;
    const { lastValidBlockHeight } = await connection.getLatestBlockhash();
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash: txBlockhash, lastValidBlockHeight },
      "confirmed"
    );

    return NextResponse.json({ signature });
  } catch (err) {
    console.error("sponsor error:", err);
    return NextResponse.json({ error: safeError(err, "sponsor failed") }, { status: 500 });
  }
}
