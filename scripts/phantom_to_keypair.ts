/**
 * Converts a Phantom-exported private key (base58 string) into the JSON
 * byte-array format the Solana CLI and Anchor expect.
 *
 * Phantom: Settings → Manage Accounts → (your account) → Show Private Key
 *
 * Usage:
 *   npx ts-node scripts/phantom_to_keypair.ts <BASE58_PRIVATE_KEY> [out.json]
 *
 * Example (writes the default Solana CLI wallet):
 *   npx ts-node scripts/phantom_to_keypair.ts 4xQ...abc ~/.config/solana/id.json
 *
 * ⚠️  The private key controls your funds. Only use a DEVNET account, never
 *     paste a mainnet key into a terminal, and clear your shell history after
 *     (`history -c`).
 */
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const [, , base58Key, outArg] = process.argv;

if (!base58Key) {
  console.error("usage: npx ts-node scripts/phantom_to_keypair.ts <BASE58_PRIVATE_KEY> [out.json]");
  process.exit(1);
}

let secret: Uint8Array;
try {
  secret = bs58.decode(base58Key.trim());
} catch {
  console.error("error: that does not look like a base58 private key");
  process.exit(1);
}
if (secret.length !== 64) {
  console.error(`error: expected a 64-byte secret key, got ${secret.length} bytes`);
  process.exit(1);
}

const keypair = Keypair.fromSecretKey(secret);
const outPath = (outArg ?? path.join(os.homedir(), ".config/solana/id.json")).replace(
  /^~(?=$|\/)/,
  os.homedir()
);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(Array.from(secret)), { mode: 0o600 });

console.log(`wrote ${outPath}`);
console.log(`public key: ${keypair.publicKey.toBase58()}`);
console.log("verify with: solana address && solana balance --url devnet");
