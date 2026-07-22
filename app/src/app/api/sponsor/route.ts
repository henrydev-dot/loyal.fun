/**
 * POST /api/sponsor — gasless UX: co-signs a user's partially-signed
 * transaction as fee payer after validating it only touches whitelisted
 * programs, then submits it. Serverless twin of relayer/src/index.ts.
 */
import { NextResponse } from "next/server";
import { VersionedTransaction } from "@solana/web3.js";
import {
  ALLOWED_PROGRAMS,
  loadFeePayer,
  MAX_TX_BYTES,
  serverConnection,
} from "../_lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
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
    const declaredFeePayer = accountKeys.get(0);
    if (!declaredFeePayer || !declaredFeePayer.equals(feePayer.publicKey)) {
      return NextResponse.json({ error: "fee payer must be the relayer" }, { status: 400 });
    }

    for (const ix of msg.compiledInstructions) {
      const programId = accountKeys.get(ix.programIdIndex);
      if (!programId || !ALLOWED_PROGRAMS.has(programId.toBase58())) {
        return NextResponse.json(
          { error: `program not allowed: ${programId?.toBase58()}` },
          { status: 400 }
        );
      }
    }

    if (msg.addressTableLookups.length > 0) {
      return NextResponse.json({ error: "address lookup tables not allowed" }, { status: 400 });
    }

    tx.sign([feePayer]);

    const connection = serverConnection();
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    });
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");

    return NextResponse.json({ signature });
  } catch (err) {
    console.error("sponsor error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
