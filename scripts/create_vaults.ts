/**
 * Creates the four demo risk vaults (SOL, BTC, WIF, BONK) bound to their
 * Pyth price feed ids.
 *
 * Usage: npx ts-node scripts/create_vaults.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  feedIdBytes,
  loadCore,
  loadWallet,
  logTx,
  makeProvider,
  PYTH_FEEDS,
} from "./common";
import { configPda, vaultPda } from "../tests/helpers";

const MAX_STAKE_PER_POSITION = 50_000;

async function main() {
  const provider = makeProvider();
  const admin = loadWallet();
  const core = loadCore(provider);
  const config = configPda(core.programId);

  for (const [symbol, feedHex] of Object.entries(PYTH_FEEDS)) {
    const vault = vaultPda(core.programId, symbol);
    if (await provider.connection.getAccountInfo(vault)) {
      console.log(`vault ${symbol} exists (${vault.toBase58()}), skipping`);
      continue;
    }
    const sig = await core.methods
      .createVault(symbol, feedIdBytes(feedHex), new anchor.BN(MAX_STAKE_PER_POSITION))
      .accounts({
        admin: admin.publicKey,
        config,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    logTx(`create_vault(${symbol})`, sig);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
