/**
 * Server-side helpers for the built-in relayer API routes.
 *
 * When the app runs on Vercel, these routes replace the standalone
 * relayer/ service so the whole demo is a single deployment. The fee payer
 * comes from the FEE_PAYER_SECRET env var (JSON byte array or base58) —
 * a devnet-only keypair holding a little SOL.
 */
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const SERVER_RPC_URL =
  process.env.RPC_URL ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://api.devnet.solana.com";

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
