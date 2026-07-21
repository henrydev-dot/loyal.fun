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
 * Builds a legacy transaction with the relayer as fee payer, signs it with
 * the user's burner key(s), and submits it through POST /sponsor.
 */
export async function sendSponsored(
  instructions: TransactionInstruction[],
  signers: Keypair[]
): Promise<string> {
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
