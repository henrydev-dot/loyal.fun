/**
 * Server-side helpers for the built-in relayer API routes.
 *
 * When the app runs on Vercel these routes replace the standalone relayer/
 * service so the whole demo is a single deployment. The fee payer comes from
 * FEE_PAYER_SECRET (JSON byte array or base58) — a devnet-only keypair.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

export const SERVER_RPC_URL =
  process.env.RPC_URL ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  // Same DAS-capable devnet default as the client (lib/config.ts).
  "https://devnet.helius-rpc.com/?api-key=b7b947ab-fb56-4f3d-9604-cfdb67967b95";

export function serverConnection(): Connection {
  return new Connection(SERVER_RPC_URL, "confirmed");
}

export function loadFeePayer(): Keypair {
  const raw = process.env.FEE_PAYER_SECRET;
  if (!raw) {
    throw new Error(
      "FEE_PAYER_SECRET is not configured on the server (Vercel → Settings → Environment Variables)"
    );
  }
  if (raw.trim().startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw.trim()));
}

/** Programs a sponsored transaction may invoke — anything else is rejected. */
export const ALLOWED_PROGRAMS = new Set<string>([
  process.env.NEXT_PUBLIC_CORE_PROGRAM_ID ??
    "CF5FkJ9GKoFk3SMkBZuXgGnXwfN6TETs5eAYS7V6gggr",
  "CjEcibq2LtkMJHEZ6wiiFFRNPXC4rd5xaCdEowWqW5GM", // loyal_hook
  "11111111111111111111111111111111", // System
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token
  "Ed25519SigVerify111111111111111111111111111", // ed25519 verifier (QR)
  "ComputeBudget111111111111111111111111111111",
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY", // Bubblegum (coupons)
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK", // Account Compression
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV", // Noop
]);

export const MAX_TX_BYTES = 1232;

/**
 * Rent top-up for burner wallets. The relayer pays FEES, but accounts opened
 * with `init` debit rent from the user's own wallet (their profile, nonce
 * markers, ATAs). Sized to cover a profile + nonce + ATA with headroom, and
 * only ever granted as part of a validated loyal_core transaction.
 */
export const RENT_TOP_UP_LAMPORTS = Math.round(0.006 * LAMPORTS_PER_SOL);
export const RENT_THRESHOLD_LAMPORTS = Math.round(0.004 * LAMPORTS_PER_SOL);

/* --------------------------------------------------------- rate limiting */

const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Best-effort per-IP limiter. Serverless instances don't share memory, so
 * this throttles naive floods rather than a distributed attacker — the hard
 * guarantee is the transaction validation below, not this. Pair with a
 * platform-level rule (Vercel Firewall) for anything public and long-lived.
 */
export function rateLimit(req: Request, limit: number, bucket: string): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/**
 * Errors from web3.js embed the RPC endpoint — including its API key. Never
 * hand those to a client; log the detail server-side and return a summary.
 */
export function safeError(err: unknown, fallback: string): string {
  const text = String(err);
  const withoutUrls = text.replace(/https?:\/\/[^\s"')]+/g, "<rpc>");
  // Anchor/program errors are safe and useful — keep them, drop the rest.
  const programError = withoutUrls.match(/(custom program error: 0x[0-9a-f]+)/i);
  const anchorMessage = withoutUrls.match(/Error Message: ([^.]+)\./);
  if (anchorMessage) return anchorMessage[1];
  if (programError) return `${fallback} (${programError[1]})`;
  return fallback;
}
