/**
 * loyal.fun relayer — devnet demo grade.
 *
 * Two jobs:
 *  1. POST /sponsor      — gasless UX: co-signs a user's partially-signed
 *     transaction as fee payer after validating it only touches whitelisted
 *     programs, then submits it. Users never need SOL.
 *  2. POST /merchant/qr  — merchant panel helper: signs a QR payload
 *     (merchant, points, nonce, expiry) with the shop's ed25519 QR key.
 *
 * Production notes (out of scope for the hackathon): keys would live in an
 * HSM / passkey enclave, merchants would authenticate with real sessions,
 * and /sponsor would meter per-user budgets instead of a plain IP limit.
 */
import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

dotenv.config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 8787);
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const LOYAL_CORE_ID = new PublicKey(
  process.env.LOYAL_CORE_ID ?? "CF5FkJ9GKoFk3SMkBZuXgGnXwfN6TETs5eAYS7V6gggr"
);
const LOYAL_HOOK_ID = new PublicKey(
  process.env.LOYAL_HOOK_ID ?? "CjEcibq2LtkMJHEZ6wiiFFRNPXC4rd5xaCdEowWqW5GM"
);

/** Programs a sponsored transaction may invoke — anything else is rejected. */
const ALLOWED_PROGRAMS = new Set<string>(
  [
    LOYAL_CORE_ID.toBase58(),
    LOYAL_HOOK_ID.toBase58(),
    "11111111111111111111111111111111", // System
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token
    "Ed25519SigVerify111111111111111111111111111", // ed25519 verifier (QR)
    "ComputeBudget111111111111111111111111111111",
    "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY", // Bubblegum (coupons)
    "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK", // Account Compression
    "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV", // Noop
  ].map((k) => k)
);

const MAX_TX_BYTES = 1232; // Solana packet size; anything bigger is malformed.

function loadKeypair(env: string): Keypair {
  const raw = process.env[env];
  if (!raw) {
    throw new Error(
      `${env} is not set. Provide a JSON byte array or base58 secret key.`
    );
  }
  if (raw.trim().startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw.trim()));
}

const feePayer = loadKeypair("FEE_PAYER_SECRET");

/**
 * Demo merchant registry: API key -> QR signing key. In the demo a single
 * merchant is configured through env; a real deployment would back this with
 * a database and per-merchant auth.
 */
const merchants = new Map<string, { merchantPda: PublicKey; qrSigner: Keypair }>();
if (process.env.MERCHANT_API_KEY && process.env.MERCHANT_QR_SECRET && process.env.MERCHANT_PDA) {
  merchants.set(process.env.MERCHANT_API_KEY, {
    merchantPda: new PublicKey(process.env.MERCHANT_PDA),
    qrSigner: loadKeypair("MERCHANT_QR_SECRET"),
  });
}

const connection = new Connection(RPC_URL, "confirmed");

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, feePayer: feePayer.publicKey.toBase58(), rpc: RPC_URL });
});

// ---------------------------------------------------------------------------
// POST /sponsor — fee-payer co-signing
// ---------------------------------------------------------------------------
const sponsorLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30, // 30 sponsored txs / minute / IP is plenty for a POS flow
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/sponsor", sponsorLimiter, async (req: Request, res: Response) => {
  try {
    const { transaction } = req.body as { transaction?: string };
    if (!transaction || typeof transaction !== "string") {
      return res.status(400).json({ error: "missing base64 `transaction`" });
    }

    const raw = Buffer.from(transaction, "base64");
    if (raw.length === 0 || raw.length > MAX_TX_BYTES) {
      return res.status(400).json({ error: "transaction size out of bounds" });
    }

    const tx = VersionedTransaction.deserialize(raw);
    const msg = tx.message;

    // The fee payer slot (first account) must be ours — the client builds the
    // tx with our pubkey from /health — and we only ever contribute the fee
    // signature, never authority over user accounts.
    const accountKeys = msg.getAccountKeys();
    const declaredFeePayer = accountKeys.get(0);
    if (!declaredFeePayer || !declaredFeePayer.equals(feePayer.publicKey)) {
      return res.status(400).json({ error: "fee payer must be the relayer" });
    }

    // Program whitelist: every top-level instruction must target an allowed
    // program. (CPI targets are constrained by those programs themselves.)
    for (const ix of msg.compiledInstructions) {
      const programId = accountKeys.get(ix.programIdIndex);
      if (!programId || !ALLOWED_PROGRAMS.has(programId.toBase58())) {
        return res
          .status(400)
          .json({ error: `program not allowed: ${programId?.toBase58()}` });
      }
    }

    // Address-lookup tables could smuggle accounts past inspection; the demo
    // client never uses them, so reject outright.
    if (msg.addressTableLookups.length > 0) {
      return res.status(400).json({ error: "address lookup tables not allowed" });
    }

    // All other required signatures must already be present and valid;
    // we contribute ONLY the fee payer signature.
    tx.sign([feePayer]);

    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    });
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature, ...latest },
      "confirmed"
    );

    return res.json({ signature });
  } catch (err) {
    console.error("sponsor error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /merchant/qr — signed QR payload generation
// ---------------------------------------------------------------------------
const qrLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60, // one sale per second peak is generous for a till
  standardHeaders: true,
  legacyHeaders: false,
});

const QR_TTL_SECS = 60;
const MAX_POINTS_PER_QR = 10_000n; // mirrors config.max_issue_per_tx

/**
 * Builds the exact 56-byte message loyal_core verifies:
 * merchant pda (32) || points u64 LE || nonce u64 LE || expiry i64 LE.
 */
function qrMessage(
  merchantPda: PublicKey,
  points: bigint,
  nonce: bigint,
  expiry: bigint
): Buffer {
  const msg = Buffer.alloc(56);
  merchantPda.toBuffer().copy(msg, 0);
  msg.writeBigUInt64LE(points, 32);
  msg.writeBigUInt64LE(nonce, 40);
  msg.writeBigInt64LE(expiry, 48);
  return msg;
}

app.post("/merchant/qr", qrLimiter, (req: Request, res: Response) => {
  const apiKey = req.header("x-api-key");
  const merchant = apiKey ? merchants.get(apiKey) : undefined;
  if (!merchant) {
    return res.status(401).json({ error: "invalid merchant API key" });
  }

  const { points } = req.body as { points?: number };
  if (!points || !Number.isInteger(points) || points <= 0) {
    return res.status(400).json({ error: "`points` must be a positive integer" });
  }
  if (BigInt(points) > MAX_POINTS_PER_QR) {
    return res.status(400).json({ error: `points exceed per-QR cap (${MAX_POINTS_PER_QR})` });
  }

  // Random 64-bit nonce; the chain's nonce PDA guarantees single use, the
  // expiry kills screenshot sharing.
  const nonceBytes = nacl.randomBytes(8);
  const nonce = Buffer.from(nonceBytes).readBigUInt64LE();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + QR_TTL_SECS);

  const message = qrMessage(merchant.merchantPda, BigInt(points), nonce, expiry);
  const signature = nacl.sign.detached(message, merchant.qrSigner.secretKey);

  // Everything the customer app needs to build [ed25519 verify, issue_points].
  return res.json({
    merchant: merchant.merchantPda.toBase58(),
    qrSigner: merchant.qrSigner.publicKey.toBase58(),
    points,
    nonce: nonce.toString(),
    expiry: expiry.toString(),
    signature: Buffer.from(signature).toString("base64"),
    expiresInSecs: QR_TTL_SECS,
  });
});

// ---------------------------------------------------------------------------
// POST /price — post a fresh Pyth price update on-chain (for open/close/liq)
// ---------------------------------------------------------------------------
// The browser can't run the Pyth receiver flow itself (it needs a funded
// keypair), so the relayer posts the update and returns the PriceUpdateV2
// account for the app to pass into open_position / close_position.
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

const FEEDS: Record<string, string> = {
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  WIF: "0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
  BONK: "0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
};

const hermes = new HermesClient("https://hermes.pyth.network", {});

const priceLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/price/:symbol", priceLimiter, async (req: Request, res: Response) => {
  try {
    const feedId = FEEDS[req.params.symbol?.toUpperCase() ?? ""];
    if (!feedId) return res.status(400).json({ error: "unknown symbol" });

    const receiver = new PythSolanaReceiver({
      connection,
      wallet: {
        publicKey: feePayer.publicKey,
        // Structural check ("version" property): survives minification,
        // unlike constructor-name sniffing.
        signTransaction: async (tx: any) => {
          if ("version" in tx) tx.sign([feePayer]);
          else tx.partialSign(feePayer);
          return tx;
        },
        signAllTransactions: async (txs: any[]) => {
          for (const tx of txs) {
            if ("version" in tx) tx.sign([feePayer]);
            else tx.partialSign(feePayer);
          }
          return txs;
        },
        payer: feePayer,
      } as any,
    });

    const update = await hermes.getLatestPriceUpdates([feedId], { encoding: "base64" });
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
    await builder.addPostPriceUpdates(update.binary.data);
    const priceUpdateAccount = builder
      .getPriceUpdateAccount(feedId)
      .toBase58();
    await receiver.provider.sendAll(
      await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 100_000 }),
      { skipPreflight: false }
    );

    return res.json({ priceUpdateAccount, feedId });
  } catch (err) {
    console.error("price post error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`loyal.fun relayer listening on :${PORT}`);
  console.log(`  fee payer: ${feePayer.publicKey.toBase58()}`);
  console.log(`  merchants configured: ${merchants.size}`);
});
