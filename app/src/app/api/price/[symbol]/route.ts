/**
 * POST /api/price/:symbol — posts a fresh Pyth price update on-chain and
 * returns the PriceUpdateV2 account for open/close/liquidate calls.
 * The browser can't run the receiver flow itself (needs a funded keypair).
 */
import { NextResponse } from "next/server";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { loadFeePayer, rateLimit, safeError, serverConnection } from "../../_lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FEEDS: Record<string, string> = {
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  WIF: "0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
  BONK: "0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
};

export async function POST(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  // Each call writes a rent-paying account on-chain, so this is the most
  // expensive endpoint to leave open.
  if (!rateLimit(req, 20, "price")) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  try {
    const feedId = FEEDS[params.symbol?.toUpperCase() ?? ""];
    if (!feedId) {
      return NextResponse.json({ error: "unknown symbol" }, { status: 400 });
    }

    const feePayer = loadFeePayer();
    const connection = serverConnection();
    const receiver = new PythSolanaReceiver({
      connection,
      wallet: {
        publicKey: feePayer.publicKey,
        // NOTE: detect versioned txs structurally ("version" property) —
        // constructor names are mangled by minification in production builds.
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

    // Hermes REST directly — the JS client's exports map breaks webpack.
    const hermesRes = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}&encoding=base64`,
      { cache: "no-store" }
    );
    if (!hermesRes.ok) throw new Error(`hermes ${hermesRes.status}`);
    const update = (await hermesRes.json()) as { binary: { data: string[] } };
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
    await builder.addPostPriceUpdates(update.binary.data);
    const priceUpdateAccount = builder.getPriceUpdateAccount(feedId).toBase58();
    await receiver.provider.sendAll(
      // Devnet has no fee market worth bidding into; 100k µlamports/CU was
      // burning priority fees for nothing.
      await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 1_000 }),
      { skipPreflight: false }
    );

    return NextResponse.json({ priceUpdateAccount, feedId });
  } catch (err) {
    console.error("price post error:", err);
    return NextResponse.json({ error: safeError(err, "price post failed") }, { status: 500 });
  }
}
