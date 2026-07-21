/**
 * Local sale-QR generation shared by the merchant panel and the
 * /demo-merchant kiosk: signs (merchant, points, nonce, expiry) with the
 * tablet's ed25519 QR key — the exact payload `issue_points` verifies.
 */
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getMerchantQrSigner, getMerchantWallet } from "./wallet";
import { CORE_PROGRAM_ID } from "./config";

export const QR_TTL_SECS = 60;

export function demoMerchantPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("merchant"), getMerchantWallet().publicKey.toBuffer()],
    CORE_PROGRAM_ID
  )[0];
}

/** Returns the JSON string the customer app expects inside the QR. */
export function makeSaleQrPayload(points: number): string {
  const merchant = demoMerchantPda();
  const nonce =
    BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const expiry = BigInt(Math.floor(Date.now() / 1000) + QR_TTL_SECS);

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
