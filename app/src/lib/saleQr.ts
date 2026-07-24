/**
 * Local sale-QR generation shared by the merchant panel and the
 * /demo-merchant kiosk: signs (merchant, points, nonce, expiry) with the
 * tablet's ed25519 QR key — the exact payload `issue_points` verifies.
 */
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getMerchantQrSigner, getMerchantWallet } from "./wallet";
import { CORE_PROGRAM_ID } from "./config";

/** Countdown shown at the till. */
export const QR_TTL_SECS = 60;
/**
 * Signed validity. Longer than the countdown on purpose: a code scanned at
 * t=58s needs time to confirm, and `issue_points` rejects `expiry <= now`.
 * The program's own ceiling is MAX_QR_TTL_SECS = 600.
 */
const QR_SIGNED_TTL_SECS = 150;

/** 64 bits of CSPRNG — a timestamp-derived nonce leaks when it was made. */
function randomNonce(): bigint {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).readBigUInt64LE();
}

export function demoMerchantPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("merchant"), getMerchantWallet().publicKey.toBuffer()],
    CORE_PROGRAM_ID
  )[0];
}

/** Returns the JSON string the customer app expects inside the QR. */
export function makeSaleQrPayload(points: number): string {
  const merchant = demoMerchantPda();
  const nonce = randomNonce();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + QR_SIGNED_TTL_SECS);

  const msg = Buffer.alloc(56);
  merchant.toBuffer().copy(msg, 0);
  msg.writeBigUInt64LE(BigInt(points), 32);
  msg.writeBigUInt64LE(nonce, 40);
  msg.writeBigInt64LE(expiry, 48);
  const signature = nacl.sign.detached(msg, getMerchantQrSigner().secretKey);

  return JSON.stringify({
    merchant: merchant.toBase58(),
    qrSigner: getMerchantQrSigner().publicKey.toBase58(),
    points,
    nonce: nonce.toString(),
    expiry: expiry.toString(),
    signature: Buffer.from(signature).toString("base64"),
    expiresInSecs: QR_TTL_SECS,
  });
}

/**
 * The QR encodes a deep link rather than raw JSON: a phone's NATIVE camera
 * then opens the app straight on the Scan page, which auto-processes the
 * payload from the `d` query param. The in-app scanner accepts both forms.
 */
export function makeSaleQrUrl(points: number): string {
  const payload = makeSaleQrPayload(points);
  const encoded = Buffer.from(payload, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://loyalfun.vercel.app";
  return `${origin}/scan?d=${encoded}`;
}

/** Reverse of makeSaleQrUrl's encoding; returns the JSON payload string. */
export function decodeSaleParam(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}
