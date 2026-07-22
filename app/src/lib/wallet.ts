/**
 * Embedded burner wallet — the "no seed phrase" fallback path.
 *
 * A keypair is generated on first visit and kept in localStorage. Combined
 * with the relayer paying all fees, the user never sees SOL, gas or seed
 * phrases — just points. Production would swap this for Privy/Web3Auth
 * embedded wallets (email/Google login) behind the same interface; the rest
 * of the app only sees `getWallet()`.
 *
 * Demo-grade on purpose: localStorage is not durable secure storage, and the
 * README says so.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const STORAGE_KEY = "loyal.fun/burner-wallet/v1";

// Safari private windows (and some embedded webviews) can throw on
// localStorage access. Fall back to an in-memory store: the wallet then
// lives for the session only, but the app never crashes.
const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memoryStore.get(key) ?? null;
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function storageSet(key: string, value: string): void {
  memoryStore.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — memory fallback already holds it */
  }
}

export function getWallet(): Keypair {
  if (typeof window === "undefined") {
    // SSR render pass — never used for signing.
    return Keypair.generate();
  }
  const stored = storageGet(STORAGE_KEY);
  if (stored) {
    try {
      return Keypair.fromSecretKey(bs58.decode(stored));
    } catch {
      // fall through to regeneration
    }
  }
  const fresh = Keypair.generate();
  storageSet(STORAGE_KEY, bs58.encode(fresh.secretKey));
  return fresh;
}

export function exportWallet(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Merchant panel keys (separate identities from the customer burner)
// ---------------------------------------------------------------------------
const MERCHANT_KEY = "loyal.fun/merchant-wallet/v1";
const QR_SIGNER_KEY = "loyal.fun/merchant-qr-signer/v1";

function loadOrCreate(storageKey: string): Keypair {
  if (typeof window === "undefined") return Keypair.generate();
  const stored = storageGet(storageKey);
  if (stored) {
    try {
      return Keypair.fromSecretKey(bs58.decode(stored));
    } catch {
      /* regenerate */
    }
  }
  const fresh = Keypair.generate();
  storageSet(storageKey, bs58.encode(fresh.secretKey));
  return fresh;
}

/** The merchant's on-chain authority (registers the shop, signs redemptions). */
export const getMerchantWallet = (): Keypair => loadOrCreate(MERCHANT_KEY);

/** The hot ed25519 key that signs sale QRs on the shop tablet. */
export const getMerchantQrSigner = (): Keypair => loadOrCreate(QR_SIGNER_KEY);
