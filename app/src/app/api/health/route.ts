import { NextResponse } from "next/server";
import { loadFeePayer, SERVER_RPC_URL } from "../_lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const feePayer = loadFeePayer();
    return NextResponse.json({
      ok: true,
      feePayer: feePayer.publicKey.toBase58(),
      rpc: SERVER_RPC_URL,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
