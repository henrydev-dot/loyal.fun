/**
 * Anchor program client. The IDL is produced by `anchor build` and copied
 * into app/public/idl/ by `npm run sync-idl` (see root package.json), then
 * fetched at runtime — the app never ships a stale hand-written IDL.
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { connection } from "./relayer";

let cachedProgram: anchor.Program | null = null;

/** Read-only wallet stub: all real signing happens via the relayer flow. */
class ReadonlyWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

export async function getProgram(wallet: Keypair): Promise<anchor.Program> {
  if (cachedProgram) return cachedProgram;
  const res = await fetch("/idl/loyal_core.json");
  if (!res.ok) {
    throw new Error(
      "IDL missing — run `anchor build` then `npm run sync-idl` at the repo root"
    );
  }
  const idl = (await res.json()) as anchor.Idl;
  const provider = new anchor.AnchorProvider(
    connection,
    new ReadonlyWallet(wallet) as unknown as anchor.Wallet,
    { commitment: "confirmed" }
  );
  cachedProgram = new anchor.Program(idl, provider);
  return cachedProgram;
}
