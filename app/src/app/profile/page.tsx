"use client";

/**
 * Profile — identity, soulbound badges, and the honest small print about what
 * this browser actually holds.
 */
import { useCallback, useEffect, useState } from "react";
import { exportWallet, getWallet } from "@/lib/wallet";
import { claimBadge, fetchProfile } from "@/lib/actions";
import { BADGE_META, invalidateQueries, tierName } from "@/lib/queries";
import { getHistory, recordTx, type HistoryEntry } from "@/lib/history";
import { explorerAddr, explorerTx } from "@/lib/config";
import TxToast from "@/components/TxToast";
import {
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Screen,
  SectionTitle,
  Skeleton,
  WalletAvatar,
  shortAddress,
} from "@/components/ui";
import { DeltaPoints, Stat } from "@/components/viz";
import {
  IconAlert,
  IconCheck,
  IconDroplet,
  IconExternal,
  IconFlame,
  IconMedal,
  IconReceipt,
  IconRocket,
  IconSkull,
} from "@/components/icons";

/**
 * Display names come from the badge mint metadata (Badge::metadata in
 * state.rs) — what a wallet or explorer will show — while ids and unlock
 * hints come from BADGE_META. The two name lists disagree today; the token is
 * the source of truth.
 */
const BADGE_NAMES: Record<number, string> = {
  0: "First Blood",
  1: "5x Full Send",
  2: "Liquidated",
  3: "7-Day Streak",
};

const BADGE_ICONS = [IconDroplet, IconRocket, IconSkull, IconFlame] as const;

const fmt = (value: number) => value.toLocaleString("en-US");

const num = (value: any): number =>
  typeof value === "number" ? value : Number(value?.toString() ?? 0);

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ProfilePage() {
  const [address, setAddress] = useState("");
  const [profile, setProfile] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; signature: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (showSkeleton: boolean) => {
    if (showSkeleton) setLoading(true);
    setError(null);
    const wallet = getWallet();
    setAddress(wallet.publicKey.toBase58());
    try {
      setProfile(await fetchProfile(wallet));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
    setHistory(getHistory());
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const claim = async (badgeId: number) => {
    setClaiming(badgeId);
    setError(null);
    try {
      const signature = await claimBadge(getWallet(), badgeId);
      const name = BADGE_NAMES[badgeId] ?? "Badge";
      recordTx(`Claimed badge "${name}"`, signature);
      setToast({ message: `${name} — soulbound, forever`, signature });
      invalidateQueries();
      await load(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setClaiming(null);
    }
  };

  const copySecret = async () => {
    const secret = exportWallet();
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(String(err));
    }
  };

  const eligible = profile ? num(profile.badgeEligible) : 0;
  const claimed = profile ? num(profile.badges) : 0;
  const claimedCount = BADGE_META.filter((b) => (claimed & (1 << b.id)) !== 0).length;

  return (
    <Screen title="Profile" subtitle="Your wallet, your badges, your receipts.">
      <section className="card flex items-center gap-3">
        {address ? (
          <WalletAvatar address={address} size={44} />
        ) : (
          <Skeleton className="h-11 w-11 rounded-lg" />
        )}
        <div className="flex-1 min-w-0">
          {address ? (
            <a
              href={explorerAddr(address)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold tnum hover:text-accent"
            >
              {shortAddress(address, 6)}
              <IconExternal size={12} className="text-faint" />
            </a>
          ) : (
            <Skeleton className="h-4 w-32" />
          )}
          <p className="text-2xs text-faint">Embedded burner wallet · devnet</p>
        </div>
        {profile && (
          <span className="pill text-champagne border-edgeStrong shrink-0">
            {tierName(num(profile.tier))}
          </span>
        )}
      </section>

      {error && <ErrorNote error={error} onRetry={() => void load(true)} />}

      {loading && !error && (
        <>
          <div className="card grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
          <CardSkeleton rows={2} />
        </>
      )}

      {!loading && !error && !profile && (
        <EmptyState
          icon={<IconMedal size={30} />}
          title="Brand new wallet"
          body="Nothing on-chain for this keypair yet. Your profile, stats and badges are created by your first scan at a shop."
        />
      )}

      {!loading && !error && profile && (
        <section className="card grid grid-cols-3 gap-y-4 gap-x-3">
          <Stat label="Earned" value={fmt(num(profile.earnedTotal))} hint="points" />
          <Stat label="Spent" value={fmt(num(profile.spentTotal))} hint="points" />
          <Stat
            label="Degen score"
            value={<DeltaPoints value={num(profile.degenScore)} />}
            hint="settled PnL"
          />
          <Stat label="Positions closed" value={fmt(num(profile.positionsClosed))} />
          <Stat label="Liquidated" value={`${fmt(num(profile.timesLiquidated))}×`} />
          <Stat label="Badges" value={`${claimedCount}/${BADGE_META.length}`} />
        </section>
      )}

      <section className="space-y-2">
        <SectionTitle>Badges — soulbound</SectionTitle>
        {loading && !error ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="card space-y-2.5">
                <Skeleton className="h-7 w-7 mx-auto rounded-lg" />
                <Skeleton className="h-3 w-3/4 mx-auto" />
                <Skeleton className="h-3 w-1/2 mx-auto" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {BADGE_META.map((badge) => {
              const isClaimed = (claimed & (1 << badge.id)) !== 0;
              const isEligible = (eligible & (1 << badge.id)) !== 0;
              const Icon = BADGE_ICONS[badge.id] ?? IconMedal;
              return (
                <div
                  key={badge.id}
                  className={`card text-center space-y-2 ${
                    isClaimed
                      ? "border-champagne/60"
                      : isEligible
                        ? "border-accent/60"
                        : "opacity-50"
                  }`}
                >
                  <span
                    className={`inline-flex ${
                      isClaimed ? "text-champagne" : isEligible ? "text-accent" : "text-faint"
                    }`}
                  >
                    <Icon size={30} strokeWidth={1.3} />
                  </span>
                  <p className="font-semibold text-sm">{BADGE_NAMES[badge.id]}</p>
                  {isClaimed ? (
                    <p className="inline-flex items-center justify-center gap-1 text-xs text-champagne">
                      <IconCheck size={13} /> Minted
                    </p>
                  ) : isEligible ? (
                    <button
                      onClick={() => claim(badge.id)}
                      disabled={claiming !== null}
                      className="btn-primary w-full !py-2 text-sm"
                    >
                      {claiming === badge.id ? "Claiming…" : "Claim"}
                    </button>
                  ) : (
                    <p className="text-xs text-faint leading-snug">{badge.hint}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-2xs text-faint leading-relaxed">
          Badges are NonTransferable Token-2022 mints — any dApp can gate on them, and
          nobody can buy their way in.
        </p>
      </section>

      <section className="space-y-2">
        <SectionTitle>Activity</SectionTitle>
        {history.length === 0 ? (
          <EmptyState
            icon={<IconReceipt size={28} />}
            title="No activity logged"
            body="Every action you take from this browser lands here with a link to Solana Explorer."
          />
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <a
                key={entry.signature}
                href={explorerTx(entry.signature)}
                target="_blank"
                rel="noreferrer"
                className="card flex items-center gap-3 hover:border-accent/60"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{entry.label}</span>
                  <span className="block text-2xs text-faint tnum">{timeAgo(entry.ts)}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-accent shrink-0">
                  Explorer <IconExternal size={11} />
                </span>
              </a>
            ))}
          </div>
        )}
        <p className="text-2xs text-faint leading-relaxed">
          This log lives in this browser only. Clearing site data erases it — the
          transactions themselves stay on-chain forever.
        </p>
      </section>

      <section className="card space-y-3">
        <SectionTitle>Wallet</SectionTitle>
        <p className="text-xs text-muted leading-relaxed">
          Your wallet is an embedded burner keypair — no seed-phrase ceremony, fees paid
          by the relayer. Export it before you clear your browser, or the points go with
          it.
        </p>
        <div className="flex gap-2 items-start text-xs text-loss">
          <span className="shrink-0 pt-0.5">
            <IconAlert size={15} />
          </span>
          <p className="leading-relaxed">
            The secret key is the wallet. Anyone who sees it owns your points — never
            paste it into a chat, a form or a screenshot.
          </p>
        </div>
        <button
          onClick={() => setShowSecret((s) => !s)}
          className="btn-ghost w-full !py-2.5 text-sm"
        >
          {showSecret ? "Hide secret key" : "Export secret key"}
        </button>
        {showSecret && (
          <div className="space-y-2">
            <p className="font-mono text-xs break-all bg-bg border border-edge rounded-xl p-3 text-muted">
              {exportWallet() ?? "No key stored in this browser."}
            </p>
            <button onClick={() => void copySecret()} className="btn-quiet w-full !py-2.5 text-sm">
              {copied ? "Copied to clipboard" : "Copy to clipboard"}
            </button>
          </div>
        )}
      </section>

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
