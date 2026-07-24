"use client";

/**
 * Degen tab — synthetic long exposure against Pyth-priced vaults.
 *
 * Reading order: live markets, then what you have open, then what you settled.
 * Opening and closing both go through bottom sheets so an irreversible mint/burn
 * is never one stray tap away.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getWallet } from "@/lib/wallet";
import { getProgram } from "@/lib/program";
import {
  closePosition,
  fetchConfig,
  fetchOpenPositions,
  fetchProfile,
  loyalBalance,
  openPosition,
} from "@/lib/actions";
import {
  fetchUserPositions,
  invalidateQueries,
  type PositionRow,
} from "@/lib/queries";
import { fetchLatestPrices, formatUsd, type LivePrice } from "@/lib/pyth";
import { getPriceSeries, pushPrice, windowChangePct } from "@/lib/priceHistory";
import { explorerTx, RELAYER_URL, VAULTS } from "@/lib/config";
import { vaultPda } from "@/lib/pdas";
import { recordTx } from "@/lib/history";
import TxToast from "@/components/TxToast";
import {
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Screen,
  SectionTitle,
} from "@/components/ui";
import { DeltaPoints, DeltaValue, RiskMeter, Sparkline, Stat } from "@/components/viz";
import {
  AssetMark,
  IconBolt,
  IconChart,
  IconExternal,
  IconReceipt,
  IconSkull,
} from "@/components/icons";
import {
  ClosePositionSheet,
  getSettlements,
  liquidationPrice,
  OpenPositionSheet,
  recordSettlement,
  settle,
  toPrice1e6,
  type Leverage,
  type SettlementRecord,
} from "./PositionSheet";

/* ------------------------------------------------------------------ helpers */

type Vault = (typeof VAULTS)[number];

/** BN / bigint / string alike — never rely on implicit coercion. */
const num = (value: any): number =>
  typeof value === "number" ? value : Number(value?.toString() ?? "0");
const big = (value: any): bigint =>
  typeof value === "bigint" ? value : BigInt(value?.toString() ?? "0");

const pts = (value: number): string => value.toLocaleString();

interface OpenPos {
  address: string;
  positionId: bigint;
  symbol: string;
  stake: bigint;
  entry1e6: bigint;
  leverage: number;
  openedTs: number;
}

interface Caps {
  feeBps: number;
  maxPositionStake: number;
  exposureHeadroom: number;
  paused: boolean;
}

interface VaultInfo {
  active: boolean;
  maxStake: number;
}

const FALLBACK_CAPS: Caps = {
  feeBps: 200,
  maxPositionStake: Number.MAX_SAFE_INTEGER,
  exposureHeadroom: Number.MAX_SAFE_INTEGER,
  paused: false,
};
const FALLBACK_VAULT: VaultInfo = { active: true, maxStake: Number.MAX_SAFE_INTEGER };

/** Ask the relayer to post a fresh Pyth price on-chain for this vault. */
async function postPrice(symbol: string): Promise<PublicKey> {
  let res: Response;
  try {
    res = await fetch(`${RELAYER_URL}/price/${symbol}`, { method: "POST" });
  } catch {
    throw new Error("Could not reach the price relayer. Check your connection.");
  }
  const body = await res.json().catch(() => ({}) as any);
  if (!res.ok || !body?.priceUpdateAccount) {
    throw new Error(body?.error ?? `Price post failed for ${symbol}.`);
  }
  return new PublicKey(body.priceUpdateAccount);
}

const symbolMap = (): Map<string, string> =>
  new Map(VAULTS.map((v) => [vaultPda(v.symbol).toBase58(), v.symbol]));

function toOpenPos(entry: any, symbols: Map<string, string>): OpenPos {
  const a = entry.account;
  return {
    address: entry.publicKey.toBase58(),
    positionId: big(a.positionId),
    symbol: symbols.get(a.vault.toBase58()) ?? "?",
    stake: big(a.stake),
    // Anchor's IDL camel-cases `entry_price_1e6`; tolerate both spellings.
    entry1e6: big(a.entryPrice1E6 ?? a.entryPrice1e6),
    leverage: num(a.leverage),
    openedTs: num(a.openedTs),
  };
}

const shortDate = (unixSeconds: number): string =>
  unixSeconds > 0
    ? new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "—";

/* --------------------------------------------------------------------- page */

export default function DegenPage() {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [priceError, setPriceError] = useState<string | null>(null);

  const [balance, setBalance] = useState<bigint>(0n);
  const [openPositions, setOpenPositions] = useState<OpenPos[]>([]);
  const [history, setHistory] = useState<PositionRow[]>([]);
  const [profile, setProfile] = useState<any | null>(null);
  const [caps, setCaps] = useState<Caps>(FALLBACK_CAPS);
  const [vaultInfo, setVaultInfo] = useState<Record<string, VaultInfo>>({});
  const [settlements, setSettlements] = useState<Record<string, SettlementRecord>>({});

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tradeVault, setTradeVault] = useState<Vault | null>(null);
  const [closeTarget, setCloseTarget] = useState<OpenPos | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"open" | "close" | null>(null);
  const [toast, setToast] = useState<{ message: string; signature: string } | null>(null);

  // Submit guard that a re-render can't reset, so a double tap can't double send.
  const inFlight = useRef(false);

  /* ------------------------------------------------------------ chain load */

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const wallet = getWallet();
    const symbols = symbolMap();
    try {
      const [nextBalance, open, all, prof] = await Promise.all([
        loyalBalance(wallet.publicKey),
        fetchOpenPositions(wallet),
        fetchUserPositions(wallet.publicKey),
        fetchProfile(wallet),
      ]);
      setBalance(nextBalance);
      setOpenPositions(open.map((entry: any) => toOpenPos(entry, symbols)));
      setHistory(all.filter((row) => row.status !== "open"));
      setProfile(prof);
      setSettlements(getSettlements());
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }

    // Caps are advisory for the UI (the program enforces them regardless), so a
    // failure here degrades to "no client-side ceiling" instead of blocking.
    try {
      const program = await getProgram(wallet);
      const [config, vaults] = await Promise.all([
        fetchConfig(wallet),
        (program.account as any).riskVault.all(),
      ]);
      setCaps({
        feeBps: num(config.feeBps),
        maxPositionStake: num(config.maxPositionStake),
        exposureHeadroom: Math.max(
          0,
          num(config.maxGlobalExposure) - num(config.globalOpenExposure)
        ),
        paused: Boolean(config.paused),
      });
      const info: Record<string, VaultInfo> = {};
      for (const entry of vaults) {
        info[String(entry.account.symbol)] = {
          active: Boolean(entry.account.active),
          maxStake: num(entry.account.maxStakePerPosition),
        };
      }
      setVaultInfo(info);
    } catch {
      setCaps(FALLBACK_CAPS);
      setVaultInfo({});
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ---------------------------------------------------------- price polling */

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const latest = await fetchLatestPrices(VAULTS.map((v) => v.feedId));
        if (cancelled) return;
        for (const [feedId, live] of Object.entries(latest)) pushPrice(feedId, live.price);
        setPrices(latest);
        setPriceError(null);
      } catch (err) {
        if (!cancelled) setPriceError(String(err)); // keep the last prices on screen
      }
    };
    void tick();
    const interval = setInterval(tick, 3_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const priceOf = useCallback(
    (symbol: string): number | null => {
      const meta = VAULTS.find((v) => v.symbol === symbol);
      const live = meta ? prices[meta.feedId] : undefined;
      return live ? live.price : null;
    },
    [prices]
  );

  /* --------------------------------------------------------------- actions */

  const submitOpen = async (stake: number, leverage: Leverage) => {
    const vault = tradeVault;
    if (!vault || inFlight.current) return;
    inFlight.current = true;
    setBusy("open");
    setSheetError(null);
    try {
      const wallet = getWallet();
      const priceUpdate = await postPrice(vault.symbol);
      const signature = await openPosition(wallet, {
        symbol: vault.symbol,
        stake,
        leverage,
        priceUpdate,
      });
      recordTx(`Opened ${leverage}× ${vault.symbol} (${stake} pts)`, signature);
      setToast({
        message: `${pts(stake)} pts staked on a ${leverage}× ${vault.symbol} long`,
        signature,
      });
      setTradeVault(null);
      invalidateQueries();
      await refresh({ silent: true });
    } catch (err) {
      setSheetError(String(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const submitClose = async () => {
    const position = closeTarget;
    if (!position || inFlight.current) return;
    inFlight.current = true;
    setBusy("close");
    setSheetError(null);
    try {
      const wallet = getWallet();
      // Balance delta is the exact minted settlement — the Position account
      // never stores an exit price, so this is the only honest record we get.
      const before = await loyalBalance(wallet.publicKey);
      const priceUpdate = await postPrice(position.symbol);
      const signature = await closePosition(
        wallet,
        position.symbol,
        position.positionId,
        priceUpdate
      );
      const after = await loyalBalance(wallet.publicKey).catch(() => before);
      const net = Number(after - before);
      recordSettlement(position.address, {
        net,
        pnl: net - Number(position.stake),
        signature,
        at: Date.now(),
      });
      recordTx(`Closed ${position.leverage}× ${position.symbol}`, signature);
      setToast({ message: `Settled — ${pts(net)} pts minted back`, signature });
      setCloseTarget(null);
      invalidateQueries();
      await refresh({ silent: true });
    } catch (err) {
      setSheetError(String(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------- summaries */

  const summary = useMemo(() => {
    const known = history
      .map((row) => settlements[row.address])
      .filter((record): record is SettlementRecord => Boolean(record));
    const wins = known.filter((record) => record.pnl > 0).length;
    return {
      total: profile ? num(profile.positionCount) : history.length + openPositions.length,
      liquidated: profile ? num(profile.timesLiquidated) : history.filter((r) => r.status === "liquidated").length,
      realized: profile ? num(profile.degenScore) : null,
      knownCount: known.length,
      winRate: known.length > 0 ? (wins / known.length) * 100 : null,
      best: known.length > 0 ? Math.max(...known.map((record) => record.pnl)) : null,
    };
  }, [history, openPositions.length, profile, settlements]);

  const activeVaultInfo = tradeVault
    ? (vaultInfo[tradeVault.symbol] ?? FALLBACK_VAULT)
    : FALLBACK_VAULT;

  /* ------------------------------------------------------------------ view */

  return (
    <Screen
      title="Risk vaults"
      subtitle="Synthetic longs settled in points. Stake burns on open, settlement mints on close."
      right={
        <span className="pill">
          <span className="tnum text-accent font-semibold">{pts(Number(balance))}</span> pts
        </span>
      }
    >
      {/* ------------------------------------------------------------ markets */}
      <section className="space-y-2">
        <SectionTitle>Markets</SectionTitle>

        {Object.keys(prices).length === 0 && !priceError ? (
          <CardSkeleton rows={VAULTS.length} />
        ) : priceError && Object.keys(prices).length === 0 ? (
          <ErrorNote error={priceError} />
        ) : (
          VAULTS.map((vault) => {
            const live = prices[vault.feedId];
            const series = getPriceSeries(vault.feedId);
            const change = windowChangePct(vault.feedId);
            const tone = change === null ? "neutral" : change >= 0 ? "gain" : "loss";
            return (
              <button
                key={vault.symbol}
                type="button"
                onClick={() => {
                  setSheetError(null);
                  setTradeVault(vault);
                }}
                className="card w-full text-left flex items-center gap-3 min-h-[72px]
                           hover:border-faint transition"
              >
                <AssetMark symbol={vault.symbol} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight">{vault.symbol}</span>
                  <span className="block text-2xs text-faint truncate">{vault.label}</span>
                </span>
                <Sparkline points={series} width={68} height={30} tone={tone} />
                <span className="text-right shrink-0">
                  <span className="block font-semibold tnum leading-tight">
                    {live ? formatUsd(live.price) : "—"}
                  </span>
                  <DeltaValue percent={change} size="sm" />
                </span>
              </button>
            );
          })
        )}
        <p className="text-2xs text-faint px-1">
          Change is measured over the window this app has observed, not 24h.
        </p>
      </section>

      {/* ---------------------------------------------------- open positions */}
      <section className="space-y-3">
        <SectionTitle>Open positions</SectionTitle>

        {loading && <CardSkeleton rows={2} />}
        {!loading && loadError && (
          <ErrorNote error={loadError} onRetry={() => void refresh()} />
        )}
        {!loading && !loadError && openPositions.length === 0 && (
          <EmptyState
            icon={<IconChart size={28} />}
            title="Nothing at risk"
            body="Your points are perfectly safe — and perfectly idle. Pick a market to open a position."
            action={
              <button
                type="button"
                onClick={() => {
                  setSheetError(null);
                  setTradeVault(VAULTS[0]);
                }}
                className="btn-primary"
              >
                <IconBolt size={18} />
                Open a position
              </button>
            }
          />
        )}

        {!loading &&
          !loadError &&
          openPositions.map((position) => {
            const mark = priceOf(position.symbol);
            const estimate =
              mark === null
                ? null
                : settle(
                    position.stake,
                    position.entry1e6,
                    toPrice1e6(mark),
                    position.leverage,
                    caps.feeBps
                  );
            const stakeNumber = Number(position.stake);
            const pnlPct =
              estimate && stakeNumber > 0 ? (estimate.pnl / stakeNumber) * 100 : null;
            return (
              <div key={position.address} className="card space-y-3">
                <div className="flex items-center gap-3">
                  <AssetMark symbol={position.symbol} size={30} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold leading-tight">
                      {position.leverage}× {position.symbol}
                    </span>
                    <span className="block text-2xs text-faint">
                      Opened {shortDate(position.openedTs)}
                    </span>
                  </span>
                  <DeltaValue percent={pnlPct} />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Stake" value={pts(stakeNumber)} hint="burned" />
                  <Stat
                    label="Entry"
                    value={formatUsd(Number(position.entry1e6) / 1e6)}
                  />
                  <Stat label="Mark" value={mark === null ? "—" : formatUsd(mark)} />
                </div>

                <div className="flex items-baseline justify-between gap-3">
                  <span className="stat-label">Unrealized</span>
                  {estimate ? (
                    <DeltaPoints value={estimate.pnl} />
                  ) : (
                    <span className="text-faint tnum text-sm">—</span>
                  )}
                </div>

                {estimate ? (
                  <RiskMeter
                    multiplier={estimate.multiplier}
                    liquidationLabel={formatUsd(
                      liquidationPrice(position.entry1e6, position.leverage)
                    )}
                  />
                ) : (
                  <p className="text-2xs text-faint">
                    Liquidates at{" "}
                    <span className="tnum">
                      {formatUsd(liquidationPrice(position.entry1e6, position.leverage))}
                    </span>{" "}
                    · waiting for a live price to size the risk.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSheetError(null);
                    setCloseTarget(position);
                  }}
                  disabled={busy !== null}
                  className="btn-ghost w-full"
                >
                  Close
                </button>
              </div>
            );
          })}
      </section>

      {/* ----------------------------------------------------------- history */}
      <section className="space-y-3">
        <SectionTitle>History</SectionTitle>

        <div className="card grid grid-cols-2 gap-y-4 gap-x-3">
          <Stat label="Positions" value={pts(summary.total)} hint="opened lifetime" />
          <Stat
            label="Win rate"
            value={summary.winRate === null ? "—" : `${summary.winRate.toFixed(0)}%`}
            hint={
              summary.knownCount > 0
                ? `${summary.knownCount} settled on this device`
                : "no settlements recorded here"
            }
          />
          <Stat
            label="Best result"
            value={summary.best === null ? "—" : <DeltaPoints value={summary.best} />}
            hint="of the settlements above"
          />
          <Stat
            label="Liquidated"
            value={pts(summary.liquidated)}
            hint="times, all devices"
          />
          {summary.realized !== null && (
            <div className="col-span-2 border-t border-edge pt-3 flex items-baseline justify-between">
              <span className="stat-label">Realized PnL (on-chain)</span>
              <DeltaPoints value={summary.realized} />
            </div>
          )}
        </div>

        {loading && <CardSkeleton rows={2} />}
        {!loading && !loadError && history.length === 0 && (
          <EmptyState
            icon={<IconReceipt size={28} />}
            title="No settled positions yet"
            body="Closed and liquidated positions land here with their outcome."
          />
        )}

        {!loading &&
          !loadError &&
          history.map((row) => {
            const record = settlements[row.address];
            const liquidated = row.status === "liquidated";
            return (
              <div key={row.address} className="card flex items-center gap-3">
                <AssetMark symbol={row.symbol} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight">
                    {row.leverage}× {row.symbol}
                  </span>
                  <span className="block text-2xs text-faint tnum">
                    {pts(row.stake)} pts · {shortDate(row.openedTs)}
                  </span>
                </span>
                <span className="shrink-0 flex flex-col items-end gap-1">
                  <span
                    className={`pill ${liquidated ? "border-loss/40 text-loss" : "text-muted"}`}
                  >
                    {liquidated && <IconSkull size={12} />}
                    {liquidated ? "Liquidated" : "Closed"}
                  </span>
                  {record ? (
                    <DeltaPoints value={record.pnl} />
                  ) : (
                    <span className="text-2xs text-faint">result not recorded here</span>
                  )}
                  {record?.signature && (
                    <a
                      href={explorerTx(record.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-2xs text-accent underline underline-offset-2"
                    >
                      Explorer <IconExternal size={11} />
                    </a>
                  )}
                </span>
              </div>
            );
          })}
      </section>

      {/* ------------------------------------------------------------ sheets */}
      {tradeVault && (
        <OpenPositionSheet
          open={tradeVault !== null}
          onClose={() => {
            if (busy === null) setTradeVault(null);
          }}
          vault={tradeVault}
          price={priceOf(tradeVault.symbol)}
          series={getPriceSeries(tradeVault.feedId)}
          windowChange={windowChangePct(tradeVault.feedId)}
          balance={Number(balance)}
          feeBps={caps.feeBps}
          stakeCap={Math.min(caps.maxPositionStake, activeVaultInfo.maxStake)}
          exposureHeadroom={caps.exposureHeadroom}
          paused={caps.paused}
          vaultActive={activeVaultInfo.active}
          pending={busy === "open"}
          error={sheetError}
          onSubmit={submitOpen}
        />
      )}

      <ClosePositionSheet
        open={closeTarget !== null}
        onClose={() => {
          if (busy === null) setCloseTarget(null);
        }}
        position={closeTarget}
        price={closeTarget ? priceOf(closeTarget.symbol) : null}
        feeBps={caps.feeBps}
        pending={busy === "close"}
        error={sheetError}
        onConfirm={submitClose}
      />

      {toast && (
        <TxToast
          message={toast.message}
          signature={toast.signature}
          onClose={() => setToast(null)}
        />
      )}
    </Screen>
  );
}
