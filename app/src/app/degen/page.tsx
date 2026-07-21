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
import { AssetMark, IconAlert, IconBolt } from "@/components/icons";

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
  const [selected, setSelected] = useState(VAULTS[3]); // BONK by default
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
      recordTx(`Opened ${leverage}× ${selected.symbol} (${stake} pts)`, signature);
      setToast({
        message: `${stake} pts into a ${leverage}× ${selected.symbol} long`,
        signature,
      });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  // vault PDA -> symbol lookup (tiny list, computed per render)
  const vaultKeys = VAULTS.map((v) => ({
    symbol: v.symbol,
    key: vaultPda(v.symbol).toBase58(),
  }));
  const symbolForVault = (vault: PublicKey) =>
    vaultKeys.find((v) => v.key === vault.toBase58())?.symbol ?? "?";

  const settle = async (position: any) => {
    setBusy(position.publicKey.toBase58());
    setError(null);
    try {
      const wallet = getWallet();
      const symbol = symbolForVault(position.account.vault);
      const priceUpdate = await postPrice(symbol);
      const signature = await closePosition(
        wallet,
        symbol,
        BigInt(position.account.positionId.toString()),
        priceUpdate
      );
      recordTx(`Closed ${symbol} position`, signature);
      setToast({ message: "Position settled", signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const livePnl = (position: any): { pct: number; liq: number } | null => {
    const symbol = symbolForVault(position.account.vault);
    const meta = VAULTS.find((v) => v.symbol === symbol);
    const live = meta && priceFor(meta.feedId);
    if (!live) return null;
    const entry =
      Number(position.account.entryPrice1E6 ?? position.account.entryPrice1e6) / 1e6;
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
        <h1 className="text-2xl font-semibold">Risk vaults</h1>
        <span className="text-sm text-muted">
          Balance <b className="text-accent">{balance.toLocaleString()}</b> pts
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
              className={`card text-left transition flex items-center gap-3 ${
                active ? "border-accent/70 shadow-brass" : "hover:border-faint"
              }`}
            >
              <AssetMark symbol={vault.symbol} />
              <span className="min-w-0">
                <span className="block font-semibold leading-tight">{vault.symbol}</span>
                <span className="block text-sm text-muted tabular-nums">
                  {live ? formatUsd(live.price) : "—"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="card space-y-4">
        <p className="font-semibold">
          Long {selected.label} <span className="text-faint">({selected.symbol})</span>
        </p>
        <div>
          <div className="flex justify-between text-sm text-muted mb-2">
            <span>Stake</span>
            <span className="text-accent font-semibold tabular-nums">{stake} pts</span>
          </div>
          <input
            type="range"
            min={10}
            max={Math.max(10, Number(balance))}
            step={10}
            value={stake}
            onChange={(e) => setStake(Number(e.target.value))}
          />
        </div>
        <div className="flex gap-2">
          {LEVERAGES.map((lev) => (
            <button
              key={lev}
              onClick={() => setLeverage(lev)}
              className={`flex-1 btn !py-2.5 ${
                leverage === lev
                  ? "bg-accent text-bg"
                  : "border border-edge text-muted hover:text-ink"
              }`}
            >
              {lev}×
            </button>
          ))}
        </div>
        <p className="text-xs text-faint leading-relaxed">
          Payout capped at 5× · liquidation at −{Math.round(80 / leverage)}% ·
          2% settlement fee burned. Synthetic exposure only — you never hold the
          asset.
        </p>
        <button
          onClick={apeIn}
          disabled={busy !== null || balance < BigInt(stake)}
          className="btn-primary w-full text-base"
        >
          <IconBolt size={18} />
          {busy === "open" ? "Opening…" : `Open ${leverage}× long`}
        </button>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-muted text-lg">Open positions</h2>
        {positions.length === 0 && (
          <p className="text-sm text-faint">
            No open positions. Your points are perfectly safe — and perfectly idle.
          </p>
        )}
        {positions.map((position) => {
          const symbol = symbolForVault(position.account.vault);
          const pnl = livePnl(position);
          const key = position.publicKey.toBase58();
          return (
            <div key={key} className="card space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2.5 font-semibold">
                  <AssetMark symbol={symbol} size={28} />
                  {position.account.leverage}× {symbol}
                </span>
                <span
                  className={`font-semibold tabular-nums ${
                    (pnl?.pct ?? 0) >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {pnl ? `${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(1)}%` : "—"}
                </span>
              </div>
              <p className="text-xs text-faint">
                Stake {position.account.stake.toString()} pts · liquidates at{" "}
                {pnl ? formatUsd(pnl.liq) : "—"}
              </p>
              <button
                onClick={() => settle(position)}
                disabled={busy !== null}
                className="btn-ghost w-full !py-2.5"
              >
                {busy === key ? "Settling…" : "Close position"}
              </button>
            </div>
          );
        })}
      </section>

      {error && (
        <div className="card border-loss/40 text-sm text-loss break-all flex gap-2">
          <span className="shrink-0 pt-0.5">
            <IconAlert size={16} />
          </span>
          {error}
        </div>
      )}
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
