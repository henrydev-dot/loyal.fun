"use client";

/**
 * Trade sheets for the Degen tab, plus the settlement math behind their
 * previews.
 *
 * The math is a line-for-line mirror of `programs/loyal_core/src/math.rs`:
 * integer 1e6 fixed point, truncating division, clamp to [0, 5×], then a
 * basis-point fee floored off the gross payout. Floats are only used at the
 * very end, for display — anything looser and the preview would disagree with
 * the chain at the last point.
 */
import { useEffect, useMemo, useState } from "react";
import { humanizeError, Segmented, Sheet } from "@/components/ui";
import { DeltaPoints, DeltaValue, Sparkline, type SparklinePoint } from "@/components/viz";
import { AssetMark, IconAlert, IconBolt, IconSpinner } from "@/components/icons";
import { formatUsd } from "@/lib/pyth";

/* --------------------------------------------------------------- program math */

const PRICE_SCALE = 1_000_000n;
const MAX_MULTIPLIER_1E6 = 5_000_000n;
const LIQUIDATION_MULTIPLIER_1E6 = 200_000n;
const BPS_DENOMINATOR = 10_000n;

export const LEVERAGES = [1, 2, 5] as const;
export type Leverage = (typeof LEVERAGES)[number];

/** USD float → the u64 1e6 fixed point the oracle reader produces. */
export const toPrice1e6 = (price: number): bigint =>
  Number.isFinite(price) && price > 0 ? BigInt(Math.round(price * 1e6)) : 0n;

/** `clamp(1 + leverage * (exit - entry) / entry, 0, 5)` in 1e6 fixed point. */
export function settlementMultiplier1e6(
  entry1e6: bigint,
  exit1e6: bigint,
  leverage: number
): bigint {
  if (entry1e6 <= 0n || exit1e6 <= 0n) return 0n;
  // BigInt division truncates toward zero, exactly like the program's i128 div.
  const delta1e6 = ((exit1e6 - entry1e6) * PRICE_SCALE) / entry1e6;
  const raw = PRICE_SCALE + BigInt(leverage) * delta1e6;
  if (raw < 0n) return 0n;
  return raw > MAX_MULTIPLIER_1E6 ? MAX_MULTIPLIER_1E6 : raw;
}

export interface Settlement {
  /** 1 = break-even, 0.2 = liquidation floor, 5 = capped win. */
  multiplier: number;
  payout: number;
  fee: number;
  net: number;
  pnl: number;
  liquidatable: boolean;
  capped: boolean;
}

/** Gross payout, burned fee and net mint for one exit price. */
export function settle(
  stake: bigint,
  entry1e6: bigint,
  exit1e6: bigint,
  leverage: number,
  feeBps: number
): Settlement {
  const multiplier = settlementMultiplier1e6(entry1e6, exit1e6, leverage);
  const payout = (stake * multiplier) / PRICE_SCALE;
  const fee = (payout * BigInt(feeBps)) / BPS_DENOMINATOR;
  const net = payout - fee;
  return {
    multiplier: Number(multiplier) / 1e6,
    payout: Number(payout),
    fee: Number(fee),
    net: Number(net),
    pnl: Number(net - stake),
    liquidatable: multiplier <= LIQUIDATION_MULTIPLIER_1E6,
    capped: multiplier >= MAX_MULTIPLIER_1E6,
  };
}

/** Price at which the multiplier reaches 0.2 — i.e. −0.8/leverage. */
export const liquidationPrice = (entry1e6: bigint, leverage: number): number =>
  (Number(entry1e6) / 1e6) * (1 - 0.8 / leverage);

/** Price at which the 5× clamp binds — i.e. +4/leverage. */
export const capPrice = (entry1e6: bigint, leverage: number): number =>
  (Number(entry1e6) / 1e6) * (1 + 4 / leverage);

/* ------------------------------------------------------- local settlement log */

/**
 * The Position account keeps no exit price, so a settled position on chain
 * cannot tell you what it paid. We remember the settlements this device
 * performed — enough for the history strip and an Explorer link — and label
 * everything else as unknown rather than guessing.
 */
export interface SettlementRecord {
  net: number;
  pnl: number;
  signature: string;
  at: number;
}

const SETTLEMENT_KEY = "loyal.fun/degen/settlements/v1";

export function getSettlements(): Record<string, SettlementRecord> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(SETTLEMENT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function recordSettlement(address: string, record: SettlementRecord): void {
  if (typeof window === "undefined") return;
  try {
    const all = getSettlements();
    all[address] = record;
    window.localStorage.setItem(SETTLEMENT_KEY, JSON.stringify(all));
  } catch {
    /* private mode — the strip just shows fewer known outcomes */
  }
}

/* ------------------------------------------------------------------ shared UI */

const pts = (value: number): string => value.toLocaleString();

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">
        {label}
        {hint && <span className="block text-2xs text-faint">{hint}</span>}
      </span>
      <span className="tnum font-semibold text-right">{value}</span>
    </div>
  );
}

function SheetError({ error }: { error: string }) {
  return (
    <p className="flex gap-2 text-sm text-loss">
      <span className="shrink-0 pt-0.5">
        <IconAlert size={16} />
      </span>
      <span className="min-w-0 break-words">{humanizeError(error)}</span>
    </p>
  );
}

/* ---------------------------------------------------------------- open sheet */

export interface OpenSheetProps {
  open: boolean;
  onClose: () => void;
  vault: { symbol: string; label: string };
  price: number | null;
  series: SparklinePoint[];
  windowChange: number | null;
  /** Spendable points balance (LOYAL has 0 decimals: 1 token = 1 point). */
  balance: number;
  feeBps: number;
  /** min(config.max_position_stake, vault.max_stake_per_position). */
  stakeCap: number;
  /** config.max_global_exposure − config.global_open_exposure. */
  exposureHeadroom: number;
  paused: boolean;
  vaultActive: boolean;
  pending: boolean;
  error: string | null;
  onSubmit: (stake: number, leverage: Leverage) => void;
}

export function OpenPositionSheet(props: OpenSheetProps) {
  const {
    open,
    onClose,
    vault,
    price,
    series,
    windowChange,
    balance,
    feeBps,
    stakeCap,
    exposureHeadroom,
    paused,
    vaultActive,
    pending,
    error,
    onSubmit,
  } = props;

  const [leverage, setLeverage] = useState<Leverage>(2);
  const [stake, setStake] = useState(0);

  // Exposure is stake × leverage, so the ceiling moves with the leverage pick.
  const maxStake = Math.max(
    0,
    Math.min(balance, stakeCap, Math.floor(exposureHeadroom / leverage))
  );

  useEffect(() => {
    if (!open) return;
    setStake(Math.min(100, maxStake));
    // Seed once per opening; the clamp effect below keeps it legal afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setStake((current) => Math.min(current, maxStake));
  }, [maxStake]);

  const entry1e6 = toPrice1e6(price ?? 0);
  const stakeBig = BigInt(Math.max(0, Math.floor(stake)));

  const scenarios = useMemo(() => {
    if (entry1e6 <= 0n) return [];
    return [-0.1, 0, 0.1, 0.2].map((move) => {
      const exit1e6 = BigInt(Math.round(Number(entry1e6) * (1 + move)));
      return { move, ...settle(stakeBig, entry1e6, exit1e6, leverage, feeBps) };
    });
  }, [entry1e6, stakeBig, leverage, feeBps]);

  const atCap = useMemo(
    () =>
      entry1e6 > 0n
        ? settle(stakeBig, entry1e6, toPrice1e6(capPrice(entry1e6, leverage)), leverage, feeBps)
        : null,
    [entry1e6, stakeBig, leverage, feeBps]
  );

  const reason = ((): string | null => {
    if (paused) return "Trading is paused by governance right now.";
    if (!vaultActive) return `The ${vault.symbol} vault is not accepting positions.`;
    if (price === null) return "Waiting for a price from the feed.";
    if (balance <= 0) return "No points to stake — earn some first.";
    if (stake <= 0) return "Enter a stake above zero.";
    if (stake > balance) return `Over your balance of ${pts(balance)} pts.`;
    if (stake > stakeCap) return `Per-position cap is ${pts(stakeCap)} pts.`;
    if (stake * leverage > exposureHeadroom)
      return `Protocol exposure headroom is ${pts(exposureHeadroom)} pts — at ${leverage}× that allows ${pts(Math.floor(exposureHeadroom / leverage))} pts.`;
    return null;
  })();

  const tone = windowChange === null ? "neutral" : windowChange >= 0 ? "gain" : "loss";

  return (
    <Sheet open={open} onClose={onClose} title={`Long ${vault.symbol}`}>
      <div className="card-raised flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="stat-label">Entry price</p>
          <p className="text-xl font-semibold tnum leading-tight pt-0.5">
            {price === null ? "—" : formatUsd(price)}
          </p>
          <div className="pt-1">
            <DeltaValue percent={windowChange} size="sm" />
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <Sparkline points={series} width={104} height={40} tone={tone} />
          <AssetMark symbol={vault.symbol} size={34} />
        </div>
      </div>

      {/* stake */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <label htmlFor="degen-stake" className="stat-label">
            Stake
          </label>
          <span className="text-2xs text-faint tnum">
            Balance {pts(balance)} pts · max {pts(maxStake)} pts
          </span>
        </div>
        <div className="flex gap-2">
          <input
            id="degen-stake"
            className="input flex-1 tnum"
            inputMode="numeric"
            autoComplete="off"
            value={stake === 0 ? "" : String(stake)}
            placeholder="0"
            onChange={(event) => {
              const digits = event.target.value.replace(/[^0-9]/g, "").slice(0, 12);
              setStake(digits === "" ? 0 : Number(digits));
            }}
          />
          <span className="self-center text-sm text-muted">pts</span>
        </div>
        <div className="flex gap-2">
          {[
            { label: "25%", value: Math.floor(maxStake * 0.25) },
            { label: "50%", value: Math.floor(maxStake * 0.5) },
            { label: "Max", value: maxStake },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => setStake(chip.value)}
              disabled={maxStake <= 0}
              className="flex-1 min-h-[44px] rounded-xl border border-edge text-sm font-semibold
                         text-muted hover:text-ink hover:border-faint transition
                         disabled:opacity-40 disabled:pointer-events-none"
            >
              {chip.label}
            </button>
          ))}
        </div>
        <input
          type="range"
          aria-label="Stake"
          min={0}
          max={Math.max(1, maxStake)}
          step={1}
          value={Math.min(stake, Math.max(1, maxStake))}
          disabled={maxStake <= 0}
          onChange={(event) => setStake(Number(event.target.value))}
        />
      </div>

      {/* leverage */}
      <div className="space-y-2">
        <p className="stat-label">Leverage</p>
        <Segmented<number>
          label="Leverage"
          value={leverage}
          onChange={(value) => setLeverage(value as Leverage)}
          options={LEVERAGES.map((lev) => ({
            value: lev,
            label: `${lev}×`,
            hint: `liq −${Math.round(80 / lev)}%`,
          }))}
        />
      </div>

      {/* preview */}
      <div className="card space-y-2.5">
        <p className="stat-label">Preview</p>
        <Row
          label="Liquidation price"
          hint={`a ${Math.round(80 / leverage)}% drop`}
          value={entry1e6 > 0n ? formatUsd(liquidationPrice(entry1e6, leverage)) : "—"}
        />
        <Row
          label="5× cap price"
          hint={`a ${Math.round(400 / leverage)}% rise`}
          value={entry1e6 > 0n ? formatUsd(capPrice(entry1e6, leverage)) : "—"}
        />
        <Row
          label="Max payout"
          hint={`after the ${(feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 2)}% fee`}
          value={atCap ? `${pts(atCap.net)} pts` : "—"}
        />

        <div className="border-t border-edge pt-2.5 space-y-1.5">
          <div className="flex text-2xs text-faint uppercase tracking-[0.16em]">
            <span className="w-16">Move</span>
            <span className="flex-1 text-right">Net</span>
            <span className="flex-1 text-right">PnL</span>
          </div>
          {scenarios.length === 0 && (
            <p className="text-sm text-faint">Waiting for a price to model outcomes.</p>
          )}
          {scenarios.map((row) => (
            <div key={row.move} className="flex items-center text-sm">
              <span className="w-16 tnum text-muted">
                {row.move > 0 ? "+" : row.move < 0 ? "−" : "±"}
                {Math.abs(row.move * 100).toFixed(0)}%
              </span>
              <span className="flex-1 text-right tnum">
                {pts(row.net)} pts
                {row.liquidatable && (
                  <span className="block text-2xs text-loss">liquidatable</span>
                )}
                {row.capped && <span className="block text-2xs text-gain">at cap</span>}
              </span>
              <span className="flex-1 text-right">
                <DeltaPoints value={row.pnl} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-faint leading-relaxed">
        Opening burns the stake immediately — your balance drops the moment the
        transaction lands. Closing mints the settlement back: payout ={" "}
        <span className="tnum">stake × clamp(1 + {leverage} × move, 0, 5)</span>,
        minus a {(feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 2)}% fee that is
        burned. Synthetic exposure only — you never hold {vault.label}.
      </p>

      {error && <SheetError error={error} />}
      {reason && !error && <p className="text-xs text-muted">{reason}</p>}

      <button
        type="button"
        onClick={() => onSubmit(stake, leverage)}
        disabled={pending || reason !== null}
        className="btn-primary w-full text-base"
      >
        {pending ? <IconSpinner size={18} /> : <IconBolt size={18} />}
        {pending ? "Opening…" : `Open ${leverage}× ${vault.symbol}`}
      </button>
    </Sheet>
  );
}

/* --------------------------------------------------------------- close sheet */

export interface ClosablePosition {
  address: string;
  symbol: string;
  stake: bigint;
  entry1e6: bigint;
  leverage: number;
}

export function ClosePositionSheet({
  open,
  onClose,
  position,
  price,
  feeBps,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  position: ClosablePosition | null;
  price: number | null;
  feeBps: number;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const exit1e6 = toPrice1e6(price ?? 0);
  const estimate =
    position && exit1e6 > 0n
      ? settle(position.stake, position.entry1e6, exit1e6, position.leverage, feeBps)
      : null;

  return (
    <Sheet
      open={open && position !== null}
      onClose={onClose}
      title={position ? `Close ${position.leverage}× ${position.symbol}` : "Close position"}
    >
      {position && (
        <>
          <div className="card space-y-2.5">
            <p className="stat-label">Settlement estimate</p>
            <Row label="Stake (already burned)" value={`${pts(Number(position.stake))} pts`} />
            <Row
              label="Entry price"
              value={formatUsd(Number(position.entry1e6) / 1e6)}
            />
            <Row label="Exit price" value={price === null ? "—" : formatUsd(price)} />
            <Row
              label="Multiplier"
              value={estimate ? `${estimate.multiplier.toFixed(3)}×` : "—"}
            />
            <div className="border-t border-edge pt-2.5 space-y-2.5">
              <Row label="Payout" value={estimate ? `${pts(estimate.payout)} pts` : "—"} />
              <Row
                label="Fee burned"
                hint={`${(feeBps / 100).toFixed(feeBps % 100 === 0 ? 0 : 2)}% of payout`}
                value={estimate ? `−${pts(estimate.fee)} pts` : "—"}
              />
              <Row
                label="Net minted to you"
                value={estimate ? `${pts(estimate.net)} pts` : "—"}
              />
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted">Result vs stake</span>
                {estimate ? <DeltaPoints value={estimate.pnl} /> : <span className="text-faint tnum">—</span>}
              </div>
            </div>
          </div>

          {estimate?.liquidatable && (
            <p className="text-xs text-loss leading-relaxed">
              This position is at or below the 0.2× liquidation floor. Anyone may
              liquidate it permissionlessly before your close lands.
            </p>
          )}

          <p className="text-xs text-faint leading-relaxed">
            Estimated from the latest observed price. The chain settles on the
            Pyth price at the moment the transaction lands, so the final number
            can differ slightly.
          </p>

          {error && <SheetError error={error} />}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">
              Keep open
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending || price === null}
              className="btn-primary flex-1"
            >
              {pending && <IconSpinner size={18} />}
              {pending ? "Settling…" : "Confirm close"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
