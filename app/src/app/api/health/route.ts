import { NextResponse } from "next/server";
import { loadFeePayer } from "../_lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const feePayer = loadFeePayer();
    // Deliberately no RPC URL: it can carry an API key.
    return NextResponse.json({ ok: true, feePayer: feePayer.publicKey.toBase58() });
  } catch {
    return NextResponse.json(
      { ok: false, error: "fee payer not configured" },
      { status: 500 }
    );
  }
}
