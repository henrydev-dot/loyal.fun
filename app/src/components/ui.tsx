"use client";

/**
 * UI primitives shared by every screen. Kept in one file on purpose: the set
 * is small, and a single import keeps page code readable.
 */
import { useEffect, type ReactNode } from "react";
import { IconAlert, IconClose, IconSpinner } from "./icons";

/* ------------------------------------------------------------------ layout */

export function Screen({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0 pt-1">{right}</div>}
      </header>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 pt-1">
      <h2 className="font-display text-lg font-semibold text-ink/90">{children}</h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card space-y-2.5">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card text-center py-9 space-y-2.5">
      {icon && <div className="inline-flex text-faint">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {body && <p className="text-sm text-muted leading-relaxed max-w-[34ch] mx-auto">{body}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="card border-loss/40 space-y-2">
      <div className="flex gap-2 text-sm text-loss">
        <span className="shrink-0 pt-0.5">
          <IconAlert size={16} />
        </span>
        <span className="break-words min-w-0">{humanizeError(error)}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost w-full !py-2 text-sm">
          Try again
        </button>
      )}
    </div>
  );
}

/** Turns raw chain/RPC noise into something a barista could act on. */
export function humanizeError(raw: string): string {
  const s = raw ?? "";
  if (/QrExpired/.test(s)) return "That code expired — ask for a fresh one (they last 60 seconds).";
  if (/already in use|IssuanceNonce/.test(s)) return "This code was already used. Each QR works exactly once.";
  if (/QrSignerMismatch|QrPayloadMismatch/.test(s)) return "That code wasn't signed by this shop — it can't be redeemed.";
  if (/IssueCapExceeded/.test(s)) return "That amount is over the per-scan limit.";
  if (/StalePrice|LowConfidencePrice/.test(s)) return "The price feed is momentarily unreliable. Try again in a few seconds.";
  if (/InvalidLeverage/.test(s)) return "Leverage must be 1×, 2× or 5×.";
  if (/StakeCapExceeded/.test(s)) return "That stake is above the per-position cap.";
  if (/GlobalExposureCapExceeded/.test(s)) return "The protocol is at its open-risk cap right now. Try a smaller stake.";
  if (/NotLiquidatable/.test(s)) return "That position is still healthy — it can't be liquidated.";
  if (/OutOfStock/.test(s)) return "That reward just sold out.";
  if (/insufficient (lamports|funds)/i.test(s)) return "The wallet ran out of devnet SOL for account rent. Refresh and retry.";
  if (/0x1\b/.test(s) && /Transfer/.test(s)) return "Not enough devnet SOL to cover account rent. Refresh and retry.";
  if (/fetch|network|Failed to fetch/i.test(s)) return "Network hiccup — check your connection and retry.";
  if (/IDL missing/.test(s)) return "App is still deploying (program interface not loaded yet). Refresh in a moment.";
  // Anchor errors arrive as "…Error Message: <text>." — surface just that.
  const anchor = s.match(/Error Message: ([^.]+)\./);
  if (anchor) return anchor[1];
  return s.length > 220 ? `${s.slice(0, 220)}…` : s;
}

/* ------------------------------------------------------------------ inputs */

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 p-1 rounded-xl bg-bg border border-edge">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              active ? "bg-accent text-bg" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
            {option.hint && (
              <span className={`block text-2xs font-normal ${active ? "text-bg/70" : "text-faint"}`}>
                {option.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- sheet */

/** Bottom sheet: the mobile-native way to confirm an irreversible action. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 animate-fade" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md bg-raised border-t border-edgeStrong rounded-t-3xl
                   shadow-sheet animate-sheetUp max-h-[88dvh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-raised/95 backdrop-blur px-4 pt-3 pb-3 border-b border-edge flex items-center justify-between">
          <span className="mx-auto absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full bg-edgeStrong" />
          <h2 className="font-display text-lg font-semibold pt-2">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink p-1 pt-2">
            <IconClose size={20} />
          </button>
        </div>
        <div className="p-4 pb-8 space-y-4">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <IconSpinner size={16} />
      {label}
    </span>
  );
}

/** Deterministic wallet avatar — no network, no library. */
export function WalletAvatar({ address, size = 32 }: { address: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < address.length; i++) hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const cells = Array.from({ length: 9 }, (_, i) => ((hash >> i) & 1) === 1);
  return (
    <span
      className="inline-grid grid-cols-3 rounded-lg overflow-hidden border border-edge shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {cells.map((on, i) => (
        <span
          key={i}
          style={{
            background: on
              ? `oklch(0.62 0.11 ${hue})`
              : `oklch(0.26 0.03 ${(hue + 40) % 360})`,
          }}
        />
      ))}
    </span>
  );
}

export const shortAddress = (address: string, size = 4) =>
  address.length > size * 2 + 1 ? `${address.slice(0, size)}…${address.slice(-size)}` : address;
