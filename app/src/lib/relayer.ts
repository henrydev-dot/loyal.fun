/** Client for the fee-payer relayer: users never touch SOL. */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { RELAYER_URL, RPC_URL } from "./config";

export const connection = new Connection(RPC_URL, "confirmed");

let cachedFeePayer: PublicKey | null = null;

export async function relayerFeePayer(): Promise<PublicKey> {
  if (cachedFeePayer) return cachedFeePayer;
  const res = await fetch(`${RELAYER_URL}/health`);
  if (!res.ok) throw new Error("relayer unreachable");
  const { feePayer } = (await res.json()) as { feePayer: string };
  cachedFeePayer = new PublicKey(feePayer);
  return cachedFeePayer;
}

/**
 * Rent guard: the relayer pays FEES, but `init`ed accounts (profile, nonce
 * markers, ATAs, merchant) debit rent from the burner wallet itself. Ask the
 * relayer to top the wallet up with a sliver of devnet SOL when it runs dry.
 */
export async function ensureFunded(owner: PublicKey): Promise<void> {
  const balance = await connection.getBalance(owner).catch(() => 0);
  if (balance >= 0.005 * 1e9) return;
  const res = await fetch(`${RELAYER_URL}/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: owner.toBase58() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? "wallet funding failed");
  }
}

/**
 * Builds a legacy transaction with the relayer as fee payer, signs it with
 * the user's burner key(s), and submits it through POST /sponsor.
 */
export async function sendSponsored(
  instructions: TransactionInstruction[],
  signers: Keypair[]
): Promise<string> {
  if (signers.length > 0) {
    await ensureFunded(signers[0].publicKey);
  }
  const feePayer = await relayerFeePayer();
  const { blockhash } = await connection.getLatestBlockhash();

  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.add(...instructions);
  tx.partialSign(...signers);

  const res = await fetch(`${RELAYER_URL}/sponsor`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    }),
  });
  const body = (await res.json()) as { signature?: string; error?: string };
  if (!res.ok || !body.signature) {
    throw new Error(body.error ?? "sponsor failed");
  }
  return body.signature;
}

export interface QrPayload {
  merchant: string;
  qrSigner: string;
  points: number;
  nonce: string;
  expiry: string;
  signature: string;
  expiresInSecs: number;
}

/** Merchant panel: asks the relayer to sign a fresh sale QR. */
export async function requestMerchantQr(
  apiKey: string,
  points: number
): Promise<QrPayload> {
  const res = await fetch(`${RELAYER_URL}/merchant/qr`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ points }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "qr generation failed");
  return body as QrPayload;
}
