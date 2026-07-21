"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getWallet } from "@/lib/wallet";
import {
  closePosition,
  fetchOpenPositions,
  loyalBalance,
  openPosition,
} from "@/lib/actions";
import { fetchLatestPrices, formatUsd, LivePrice } from "@/lib/pyth";
import { RELAYER_URL, VAULTS } from "@/lib/config";
import { vaultPda } from "@/lib/pdas";
import { recordTx } from "@/lib/history";
import TxToast from "@/components/TxToast";

const LEVERAGES = [1, 2, 5] as const;

/** Ask the relayer to post a fresh Pyth price on-chain for this vault. */
async function postPrice(symbol: string): Promise<PublicKey> {
  const res = await fetch(`${RELAYER_URL}/price/${symbol}`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "price post failed");
  return new PublicKey(body.priceUpdateAccount);
}

export default function DegenPage() {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [balance, setBalance] = useState<bigint>(0n);
  const [positions, setPositions] = useState<any[]>([]);
  const [selected, setSelected] = useState(VAULTS[3]); // BONK by default 🔨
  const [stake, setStake] = useState(100);
  const [leverage, setLeverage] = useState<(typeof LEVERAGES)[number]>(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; signature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const wallet = getWallet();
    setBalance(await loyalBalance(wallet.publicKey).catch(() => 0n));
    setPositions(await fetchOpenPositions(wallet).catch(() => []));
  }, []);

  useEffect(() => {
    void refresh();
    const tick = async () => {
      try {
        setPrices(await fetchLatestPrices(VAULTS.map((v) => v.feedId)));
      } catch {
        /* keep last prices */
      }
    };
    void tick();
    const interval = setInterval(tick, 3_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const priceFor = (feedId: string) => prices[feedId];

  const apeIn = async () => {
    setBusy("open");
    setError(null);
    try {
      const wallet = getWallet();
      const priceUpdate = await postPrice(selected.symbol);
      const signature = await openPosition(wallet, {
        symbol: selected.symbol,
        stake,
        leverage,
        priceUpdate,
      });
      recordTx(`Opened ${leverage}x ${selected.symbol} (${stake} pts)`, signature);
      setToast({ message: `APED ${stake} pts into ${leverage}x ${selected.symbol} 🦍`, signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const paperHands = async (position: any) => {
    setBusy(position.publicKey.toBase58());
    setError(null);
    try {
      const wallet = getWallet();
      const vaultAcc = VAULTS.find(
        (v) => v.symbol === symbolForVault(position.account.vault)
      );
      if (!vaultAcc) throw new Error("unknown vault");
      const priceUpdate = await postPrice(vaultAcc.symbol);
      const signature = await closePosition(
        wallet,
        vaultAcc.symbol,
        BigInt(position.account.positionId.toString()),
        priceUpdate
      );
      recordTx(`Closed ${vaultAcc.symbol} position`, signature);
      setToast({ message: "Position settled 🧻", signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  // vault PDA -> symbol lookup (computed once per render, tiny list)
  const vaultKeys = VAULTS.map((v) => ({
    symbol: v.symbol,
    key: vaultPda(v.symbol).toBase58(),
  }));
  const symbolForVault = (vault: PublicKey) =>
    vaultKeys.find((v) => v.key === vault.toBase58())?.symbol ?? "?";

  const livePnl = (position: any): { pct: number; liq: number } | null => {
    const symbol = symbolForVault(position.account.vault);
    const meta = VAULTS.find((v) => v.symbol === symbol);
    const live = meta && priceFor(meta.feedId);
    if (!live) return null;
    const entry = Number(position.account.entryPrice1E6 ?? position.account.entryPrice1e6) / 1e6;
    const lev = position.account.leverage;
    const delta = (live.price - entry) / entry;
    const multiplier = Math.max(0, Math.min(5, 1 + lev * delta));
    // liquidation price: 1 + L*d = 0.2  =>  d = -0.8 / L
    const liqPrice = entry * (1 - 0.8 / lev);
    return { pct: (multiplier - 1) * 100, liq: liqPrice };
  };

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Degen Vaults</h1>
        <span className="text-sm text-zinc-400">
          bag: <b className="text-loyal">{balance.toLocaleString()}</b> pts
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {VAULTS.map((vault) => {
          const live = priceFor(vault.feedId);
          const active = selected.symbol === vault.symbol;
          return (
            <button
              key={vault.symbol}
              onClick={() => setSelected(vault)}
              className={`card text-left transition ${
                active ? "border-loyal" : "hover:border-zinc-500"
              }`}
            >
              <p className="text-lg">
                {vault.emoji} <b>{vault.symbol}</b>
              </p>
              <p className="text-sm text-zinc-400">
                {live ? formatUsd(live.price) : "…"}
              </p>
            </button>
          );
        })}
      </div>

      <div className="card space-y-4">
        <p className="font-semibold">
          Long {selected.emoji} {selected.symbol} with your points
        </p>
        <div>
          <div className="flex justify-between text-sm text-zinc-400 mb-1">
            <span>stake</span>
            <span className="text-loyal font-bold">{stake} pts</span>
          </div>
          <input
            type="range"
            min={10}
            max={Math.max(10, Number(balance))}
            step={10}
            value={stake}
            onChange={(e) => setStake(Number(e.target.value))}
            className="w-full accent-lime-400"
          />
        </div>
        <div className="flex gap-2">
          {LEVERAGES.map((lev) => (
            <button
              key={lev}
              onClick={() => setLeverage(lev)}
              className={`flex-1 btn ${
                leverage === lev
                  ? "bg-loyal text-black"
                  : "border border-edge text-zinc-300"
              }`}
            >
              {lev}x{lev === 5 ? " 🌶️" : ""}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          Win cap 5x · liquidation at −{Math.round(80 / leverage)}% · 2% settle
          fee burned. Points only — you never hold the asset.
        </p>
        <button
          onClick={apeIn}
          disabled={busy !== null || balance < BigInt(stake)}
          className="btn-loyal w-full text-lg"
        >
          {busy === "open" ? "aping…" : "APE IN 🦍"}
        </button>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-zinc-300">Open positions</h2>
        {positions.length === 0 && (
          <p className="text-sm text-zinc-500">
            No open positions. Your points are safe… and boring.
          </p>
        )}
        {positions.map((position) => {
          const symbol = symbolForVault(position.account.vault);
          const pnl = livePnl(position);
          const key = position.publicKey.toBase58();
          return (
            <div key={key} className="card space-y-2">
              <div className="flex justify-between">
                <p className="font-bold">
                  {position.account.leverage}x {symbol}
                </p>
                <p
                  className={`font-bold ${
                    (pnl?.pct ?? 0) >= 0 ? "text-pump" : "text-dump"
                  }`}
                >
                  {pnl ? `${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(1)}%` : "…"}
                </p>
              </div>
              <p className="text-xs text-zinc-500">
                stake {position.account.stake.toString()} pts · liq at{" "}
                {pnl ? formatUsd(pnl.liq) : "…"} 💀
              </p>
              <button
                onClick={() => paperHands(position)}
                disabled={busy !== null}
                className="btn-ghost w-full"
              >
                {busy === key ? "settling…" : "PAPER HANDS 🧻 (close)"}
              </button>
            </div>
          );
        })}
      </section>

      {error && <div className="card border-dump/40 text-sm text-dump break-all">{error}</div>}
      {toast && (
        <TxToast
          message={toast.message}
          signature={toast.signature}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
