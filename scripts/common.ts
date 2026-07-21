/** Shared plumbing for the devnet scripts. */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

export function loadWallet(): Keypair {
  const walletPath =
    process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
}

export function makeProvider(): anchor.AnchorProvider {
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(loadWallet()),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  return provider;
}

function loadIdl(name: string): anchor.Idl {
  const idlPath = path.join(__dirname, "..", "target", "idl", `${name}.json`);
  if (!fs.existsSync(idlPath)) {
    throw new Error(`${idlPath} not found — run \`anchor build\` first.`);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf8"));
}

export function loadCore(provider: anchor.AnchorProvider): anchor.Program {
  return new anchor.Program(loadIdl("loyal_core"), provider);
}

export function loadHook(provider: anchor.AnchorProvider): anchor.Program {
  return new anchor.Program(loadIdl("loyal_hook"), provider);
}

export const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export const explorerAddr = (addr: PublicKey | string) =>
  `https://explorer.solana.com/address/${addr.toString()}?cluster=devnet`;

export function logTx(label: string, sig: string) {
  console.log(`- **${label}** — [\`${sig.slice(0, 8)}…\`](${explorer(sig)})`);
}

/** Pyth price feed ids (Hermes hex ids, no 0x prefix). */
export const PYTH_FEEDS: Record<string, string> = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  WIF: "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
  BONK: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
};

export function feedIdBytes(hex: string): number[] {
  return Array.from(Buffer.from(hex, "hex"));
}
