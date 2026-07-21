/**
 * Recovers a Solana CLI keypair from a Phantom RECOVERY PHRASE (12/24 words).
 *
 * Phantom derives accounts on the BIP44 path m/44'/501'/<account>'/0'.
 * This script prints the first few derived addresses so you can pick the one
 * that matches your Phantom account, then writes it in the JSON byte-array
 * format the Solana CLI and Anchor expect.
 *
 * Usage:
 *   # 1. See which derived address matches your Phantom account:
 *   npx ts-node scripts/mnemonic_to_keypair.ts "word1 word2 ... word12"
 *
 *   # 2. Write the matching account index (default 0) to a keypair file:
 *   npx ts-node scripts/mnemonic_to_keypair.ts "word1 ... word12" 0 ~/.config/solana/id.json
 *
 * ⚠️  The recovery phrase controls ALL funds derived from it. Only use a
 *     DEVNET-only wallet, never paste a mainnet phrase into a terminal, and
 *     clear your shell history afterwards (`history -c`).
 */
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const [, , mnemonicArg, indexArg, outArg] = process.argv;

if (!mnemonicArg) {
  console.error(
    'usage: npx ts-node scripts/mnemonic_to_keypair.ts "12 or 24 words" [accountIndex] [out.json]'
  );
  process.exit(1);
}

const mnemonic = mnemonicArg.trim().toLowerCase().replace(/\s+/g, " ");
const wordCount = mnemonic.split(" ").length;
if (![12, 15, 18, 21, 24].includes(wordCount)) {
  console.error(`error: expected 12/24 words, got ${wordCount}`);
  process.exit(1);
}
if (!bip39.validateMnemonic(mnemonic)) {
  console.error(
    "error: that is not a valid BIP39 phrase (check for typos; words must be English)"
  );
  process.exit(1);
}

const seed = bip39.mnemonicToSeedSync(mnemonic, "");

const derive = (account: number): Keypair => {
  const { key } = derivePath(`m/44'/501'/${account}'/0'`, seed.toString("hex"));
  return Keypair.fromSeed(key);
};

console.log("Derived Phantom-style accounts (m/44'/501'/<i>'/0'):\n");
for (let i = 0; i < 5; i++) {
  console.log(`  [${i}] ${derive(i).publicKey.toBase58()}`);
}
console.log("\nPick the index whose address matches your Phantom account.");

if (indexArg === undefined) {
  console.log(
    "\nNothing written. Re-run with an index (and optionally an output path) to save:"
  );
  console.log(
    '  npx ts-node scripts/mnemonic_to_keypair.ts "…words…" 0 ~/.config/solana/id.json'
  );
  process.exit(0);
}

const index = Number(indexArg);
if (!Number.isInteger(index) || index < 0 || index > 100) {
  console.error("error: account index must be an integer between 0 and 100");
  process.exit(1);
}

const keypair = derive(index);
const outPath = (outArg ?? path.join(os.homedir(), ".config/solana/id.json")).replace(
  /^~(?=$|\/)/,
  os.homedir()
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });

console.log(`\nwrote ${outPath}`);
console.log(`public key: ${keypair.publicKey.toBase58()}`);
console.log("verify with: solana address && solana balance --url devnet");
