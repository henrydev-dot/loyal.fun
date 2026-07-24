"use client";

/**
 * Home — a dashboard for the wallet that is already earning, not a landing
 * page. The streak countdown is the retention hook: the 48h window lives on
 * `UserProfile.last_earn_ts`, so it can be shown exactly, not estimated.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getWallet } from "@/lib/wallet";
import { fetchProfile, loyalBalance } from "@/lib/actions";
import { fetchProtocolStats, tierName, type ProtocolStats } from "@/lib/queries";
import { explorerAddr } from "@/lib/config";
import { ErrorNote, SectionTitle, Skeleton, shortAddress } from "@/components/ui";
import { BarRow, DeltaPoints, Stat } from "@/components/viz";
import {
  IconChart,
  IconExternal,
  IconFlame,
  IconScan,
  LogoMark,
} from "@/components/icons";

/** Mirrors constants.rs STREAK_WINDOW_SECS. */
const STREAK_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Mirrors constants.rs TIER_*_EARNED, on lifetime earned points. */
const TIER_STEPS = [
  { name: "Silver", at: 1_000 },
  { name: "Gold", at: 5_000 },
  { name: "Degen", at: 20_000 },
] as const;

const fmt = (value: number) => value.toLocaleString("en-US");

/** Anchor hands back BN for u64/i64 fields and plain numbers for u8/u32. */
const num = (value: any): number =>
  typeof value === "number" ? value : Number(value?.toString() ?? 0);

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const wallet = getWallet();
    setAddress(wallet.publicKey.toBase58());
    try {
      const [nextBalance, nextProfile] = await Promise.all([
        loyalBalance(wallet.publicKey),
        fetchProfile(wallet),
      ]);
      setBalance(nextBalance);
      setProfile(nextProfile);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
    // Protocol stats are ambient context — a failure here must not blank the
    // dashboard, so the strip simply stays hidden.
    fetchProtocolStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Minute-resolution countdown: a 30s tick keeps it honest without churn.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const earned = profile ? num(profile.earnedTotal) : 0;
  const spent = profile ? num(profile.spentTotal) : 0;
  const score = profile ? num(profile.degenScore) : 0;
  const streakDays = profile ? num(profile.streakDays) : 0;
  const lastEarnTs = profile ? num(profile.lastEarnTs) : 0;
  const nextStep = TIER_STEPS.find((step) => earned < step.at) ?? null;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <LogoMark size={30} />
          <h1 className="text-2xl font-semibold truncate">
            loyal<span className="text-accent">.fun</span>
          </h1>
        </div>
        <a
          href={explorerAddr(address)}
          target="_blank"
          rel="noreferrer"
          className="pill shrink-0 min-h-[36px] tnum hover:text-ink"
        >
          {address ? shortAddress(address) : "…"}
          <IconExternal size={11} />
        </a>
      </header>

      {error && <ErrorNote error={error} onRetry={() => void load()} />}

      {loading && !error && (
        <>
          <div className="card py-9 space-y-3">
            <Skeleton className="h-3 w-20 mx-auto" />
            <Skeleton className="h-12 w-48 mx-auto" />
            <Skeleton className="h-3 w-28 mx-auto" />
          </div>
          <div className="card space-y-3">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-1.5 w-full" />
          </div>
          <div className="card space-y-3">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </>
      )}

      {!loading && !error && (
        <>
          <section className="card text-center py-8 space-y-2 animate-rise">
            <p className="stat-label">Balance</p>
            <p className="font-display text-6xl font-semibold text-accent tracking-tight tnum">
              {fmt(Number(balance ?? 0n))}
            </p>
            <p className="text-muted text-sm">$LOYAL points</p>
            {profile && (
              <div className="flex justify-center gap-2 pt-2">
                <span className="pill text-champagne border-edgeStrong">
                  {tierName(num(profile.tier))} tier
                </span>
                <span className="pill">
                  <IconFlame size={13} />
                  <span className="tnum">{fmt(streakDays)}</span>
                  <span>-day streak</span>
                </span>
              </div>
            )}
            {profile && (
              <div className="pt-4 mt-2 border-t border-edge">
                <StreakCountdown
                  streakDays={streakDays}
                  lastEarnTs={lastEarnTs}
                  now={now}
                />
              </div>
            )}
          </section>

          {profile ? (
            <>
              <section className="card space-y-2">
                {nextStep ? (
                  <>
                    <BarRow
                      label={<span className="text-muted">Progress to {nextStep.name}</span>}
                      value={earned}
                      max={nextStep.at}
                      valueLabel={`${fmt(earned)} / ${fmt(nextStep.at)}`}
                    />
                    <p className="text-2xs text-faint">
                      <span className="tnum">{fmt(nextStep.at - earned)}</span> more points
                      earned at the till unlocks {nextStep.name}.
                    </p>
                  </>
                ) : (
                  <>
                    <BarRow
                      label={<span className="text-muted">Degen tier</span>}
                      value={1}
                      max={1}
                      valueLabel="Max tier"
                      highlight
                    />
                    <p className="text-2xs text-faint">
                      Top of the ladder — <span className="tnum">{fmt(earned)}</span> points
                      earned all time. Nothing left to climb.
                    </p>
                  </>
                )}
              </section>

              <section className="card grid grid-cols-3 gap-3">
                <Stat label="Earned" value={fmt(earned)} hint="all time" />
                <Stat label="Spent" value={fmt(spent)} hint="on rewards" />
                <Stat
                  label="Degen score"
                  value={<DeltaPoints value={score} />}
                  hint="settled PnL"
                />
              </section>
            </>
          ) : (
            <section className="card space-y-2">
              <p className="font-semibold">A fresh ledger</p>
              <p className="text-sm text-muted leading-relaxed">
                Scan your first code at the till and the points start flowing — no seed
                phrase, no gas, nothing to configure. Your profile, tier and streak all
                open up on that first scan.
              </p>
            </section>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Link href="/scan" className="btn-primary">
              <IconScan size={18} /> Scan &amp; earn
            </Link>
            <Link href="/degen" className="btn-ghost">
              <IconChart size={18} /> Open a position
            </Link>
          </div>

          {stats && (
            <section className="card space-y-3">
              <SectionTitle>Protocol pulse</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Circulating" value={fmt(stats.circulating)} hint="points" />
                <Stat label="Shops" value={fmt(stats.shops)} hint="live" />
                <Stat label="Traders" value={fmt(stats.traders)} hint="profiles" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Link href="/leaderboard" className="btn-ghost !py-2 text-sm">
                  Leaderboard
                </Link>
                <Link href="/shops" className="btn-ghost !py-2 text-sm">
                  Shops
                </Link>
              </div>
            </section>
          )}
        </>
      )}

      <p className="text-center text-2xs text-faint pt-2 tracking-wide">
        Closed-loop utility points · not money · no fiat off-ramp
      </p>
    </div>
  );
}

/**
 * The streak dies 48h after the last earn. Showing the exact remaining time is
 * the whole point — a vague "keep it up" would not bring anyone back.
 */
function StreakCountdown({
  streakDays,
  lastEarnTs,
  now,
}: {
  streakDays: number;
  lastEarnTs: number;
  now: number;
}) {
  if (streakDays <= 0 || lastEarnTs <= 0) {
    return (
      <p className="text-sm text-muted leading-relaxed">
        No streak yet. Your next scan starts one — earn again within 48 hours to keep it
        alive.
      </p>
    );
  }

  const msLeft = lastEarnTs * 1000 + STREAK_WINDOW_MS - now;

  if (msLeft <= 0) {
    return (
      <p className="text-sm text-muted leading-relaxed">
        Your streak window closed. The next scan starts again at day one.
      </p>
    );
  }

  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  const urgent = msLeft < 6 * 3_600_000;

  return (
    <p className="text-sm leading-relaxed">
      <span className="text-muted">Your </span>
      <span className="tnum font-semibold">{streakDays}</span>
      <span className="text-muted">-day streak resets in </span>
      <span className={`tnum font-semibold ${urgent ? "text-accent" : "text-ink"}`}>
        {hours}h {minutes}m
      </span>
    </p>
  );
}
