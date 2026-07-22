/**
 * POST /api/fund — tops up a burner wallet with a sliver of devnet SOL so it
 * can pay RENT for its own accounts (profile, nonce markers, ATA, merchant).
 * The relayer pays transaction FEES, but account rent is debited from the
 * `payer` of each `init` — which is the user, by design (their accounts).
 *
 * Guarded: only funds wallets holding less than the threshold, fixed amount,
 * devnet-only economics.
 */
import { NextResponse } from "next/server";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { loadFeePayer, serverConnection } from "../_lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TOP_UP_LAMPORTS = 0.02 * LAMPORTS_PER_SOL;
const THRESHOLD_LAMPORTS = 0.005 * LAMPORTS_PER_SOL;

export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address) {
      return NextResponse.json({ error: "missing `address`" }, { status: 400 });
    }
    let target: PublicKey;
    try {
      target = new PublicKey(address);
    } catch {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }

    const connection = serverConnection();
    const balance = await connection.getBalance(target);
    if (balance >= THRESHOLD_LAMPORTS) {
      return NextResponse.json({ funded: false, balance });
    }

    const feePayer = loadFeePayer();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: feePayer.publicKey,
        toPubkey: target,
        lamports: TOP_UP_LAMPORTS,
      })
    );
    tx.feePayer = feePayer.publicKey;
    const latest = await connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.sign(feePayer);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");

    return NextResponse.json({ funded: true, signature });
  } catch (err) {
    console.error("fund error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
