"use client";

/**
 * Data-viz primitives.
 *
 * Palette notes (validated against the #131010 card surface):
 *  - gain #199E70 / loss #E66767 is the diverging pair. Its worst CVD
 *    separation sits in the 6–8 band, which is only legal WITH secondary
 *    encoding — so every gain/loss mark here ALWAYS ships a sign, an arrow
 *    glyph and a text label. Never remove those and leave color alone.
 *  - magnitude bars use one hue (#B8862C) for every row: bar length already
 *    encodes the value, so tinting per-row would double-encode it.
 */
import { useId, useState, type ReactNode } from "react";

/* --------------------------------------------------------------- sparkline */

export interface SparklinePoint {
  t: number;
  v: number;
}

/**
 * Single-series price line. One series → no legend; the caller's heading
 * names it and the current value is direct-labeled beside it.
 */
export function Sparkline({
  points,
  width = 120,
  height = 34,
  tone = "neutral",
  interactive = false,
  formatValue = (v: number) => v.toPrecision(6),
}: {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  tone?: "gain" | "loss" | "neutral";
  interactive?: boolean;
  formatValue?: (value: number) => string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          className="text-edge"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const pad = 3;
  const x = (i: number) => (i / (points.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(2)},${height} L${x(0).toFixed(2)},${height} Z`;
  const stroke =
    tone === "gain" ? "var(--viz-gain)" : tone === "loss" ? "var(--viz-loss)" : "var(--viz-neutral)";

  const active = hover ?? points.length - 1;

  return (
    <span className="relative inline-block" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role={interactive ? "img" : undefined}
        aria-label={interactive ? "Price over the last hour" : undefined}
        aria-hidden={interactive ? undefined : "true"}
        style={
          {
            "--viz-gain": "#199E70",
            "--viz-loss": "#E66767",
            "--viz-neutral": "#B8862C",
          } as React.CSSProperties
        }
        onPointerMove={
          interactive
            ? (event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - box.left) / box.width;
                const index = Math.round(ratio * (points.length - 1));
                setHover(Math.max(0, Math.min(points.length - 1, index)));
              }
            : undefined
        }
        onPointerLeave={interactive ? () => setHover(null) : undefined}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {interactive && hover !== null && (
          <line x1={x(active)} y1={0} x2={x(active)} y2={height} stroke="#3B322C" strokeWidth={1} />
        )}
        <circle cx={x(active)} cy={y(points[active].v)} r={4} fill={stroke} stroke="#131010" strokeWidth={2} />
      </svg>
      {interactive && hover !== null && (
        <span
          className="absolute -top-1 px-2 py-1 rounded-lg bg-overlay border border-edgeStrong text-2xs tnum whitespace-nowrap pointer-events-none"
          style={{ left: Math.min(Math.max(x(active) - 30, 0), width - 70) }}
        >
          {formatValue(points[active].v)}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------ pnl / change */

/**
 * Signed percentage. Color is never the only cue: the sign, the arrow glyph
 * and (optionally) a text label carry the same information.
 */
export function DeltaValue({
  percent,
  size = "md",
  showLabel = false,
}: {
  percent: number | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  if (percent === null || Number.isNaN(percent)) {
    return <span className="text-faint tnum">—</span>;
  }
  const up = percent >= 0;
  const cls = up ? "text-gain" : "text-loss";
  const sizes = { sm: "text-sm", md: "text-base", lg: "text-2xl" }[size];
  return (
    <span className={`inline-flex items-center gap-1 font-semibold tnum ${cls} ${sizes}`}>
      <svg width={size === "lg" ? 14 : 11} height={size === "lg" ? 14 : 11} viewBox="0 0 12 12" aria-hidden="true">
        <path
          d={up ? "M6 1.5 L11 10.5 L1 10.5 Z" : "M6 10.5 L1 1.5 L11 1.5 Z"}
          fill="currentColor"
        />
      </svg>
      {up ? "+" : "−"}
      {Math.abs(percent).toFixed(percent >= 100 ? 0 : 1)}%
      {showLabel && <span className="font-normal text-muted">{up ? "up" : "down"}</span>}
    </span>
  );
}

/** Signed points amount, same secondary-encoding rules as DeltaValue. */
export function DeltaPoints({ value, suffix = "pts" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold tnum ${up ? "text-gain" : "text-loss"}`}>
      {up ? "+" : "−"}
      {Math.abs(value).toLocaleString()} <span className="font-normal text-muted">{suffix}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- meters */

/**
 * Distance-to-liquidation. Deliberately positional + labelled rather than a
 * three-colour status ramp: the marker's place on the track is the reading,
 * the text states it, and the fill only echoes the already-labelled PnL sign.
 */
export function RiskMeter({
  multiplier,
  liquidationLabel,
}: {
  /** Settlement multiplier, 1 = break-even, 0.2 = liquidation, 5 = capped win. */
  multiplier: number;
  liquidationLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(5, multiplier));
  // 0.2 → 0%, 1 → 40%, 5 → 100% (piecewise so break-even sits at a fixed place)
  const position =
    clamped <= 1
      ? ((clamped - 0.2) / 0.8) * 40
      : 40 + ((clamped - 1) / 4) * 60;
  const pct = Math.max(0, Math.min(100, position));
  const state =
    clamped <= 0.35 ? "At risk" : clamped < 1 ? "Below entry" : clamped >= 4.9 ? "Capped" : "In profit";
  const tone = clamped < 1 ? "bg-loss" : "bg-gain";

  return (
    <div className="space-y-1.5">
      <div className="relative h-2 rounded-full bg-vizTrack overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${tone} opacity-60`} style={{ width: `${pct}%` }} />
        {/* break-even reference */}
        <div className="absolute inset-y-0 w-px bg-edgeStrong" style={{ left: "40%" }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full border-2 border-bg bg-ink"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-2xs text-faint">
        <span>{liquidationLabel ? `Liq ${liquidationLabel}` : "Liquidation"}</span>
        <span className={clamped < 1 ? "text-loss" : "text-gain"}>{state}</span>
        <span>5× cap</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- bars */

/**
 * Ranked magnitude row. One hue for every bar — length is the encoding.
 */
export function BarRow({
  label,
  value,
  max,
  valueLabel,
  leading,
  highlight = false,
}: {
  label: ReactNode;
  value: number;
  max: number;
  valueLabel: string;
  leading?: ReactNode;
  highlight?: boolean;
}) {
  const pct = max > 0 ? Math.max(2, (Math.max(0, value) / max) * 100) : 2;
  return (
    <div className={`space-y-1.5 ${highlight ? "" : ""}`}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 min-w-0">{leading}{label}</span>
        <span className={`tnum shrink-0 ${highlight ? "text-accent font-semibold" : "text-muted"}`}>
          {valueLabel}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-vizTrack overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: highlight ? "#D9A441" : "#B8862C" }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- stat tile */

/** When the story is one number, the number IS the chart. */
export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "gain" | "loss" | "accent";
}) {
  const toneCls = {
    default: "text-ink",
    gain: "text-gain",
    loss: "text-loss",
    accent: "text-accent",
  }[tone];
  return (
    <div className="min-w-0">
      <p className="stat-label">{label}</p>
      <p className={`font-semibold tnum pt-1 truncate ${toneCls}`}>{value}</p>
      {hint && <p className="text-2xs text-faint truncate">{hint}</p>}
    </div>
  );
}
