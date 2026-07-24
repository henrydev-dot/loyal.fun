"use client";

/**
 * Public standings, derived entirely from on-chain `userProfile` accounts.
 * Four rankings over the same row set — switching metric never refetches.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchProtocolStats,
  fetchTraders,
  rankTraders,
  tierName,
  type LeaderboardMetric,
  type ProtocolStats,
  type TraderRow,
} from "@/lib/queries";
import { explorerAddr } from "@/lib/config";
import { getWallet } from "@/lib/wallet";
import {
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Screen,
  SectionTitle,
  Segmented,
  WalletAvatar,
  shortAddress,
} from "@/components/ui";
import { BarRow, Stat } from "@/components/viz";
import { IconExternal, IconMedal } from "@/components/icons";

const TOP_N = 25;

const fmt = (value: number) => value.toLocaleString("en-US");

const METRICS: Array<{
  value: LeaderboardMetric;
  label: string;
  caption: string;
  format: (value: number) => string;
}> = [
  {
    value: "degenScore",
    label: "Traders",
    caption: "Ranked by degen score — the running result of every settled position.",
    format: (v) => fmt(v),
  },
  {
    value: "earnedTotal",
    label: "Earners",
    caption: "Ranked by points earned at the till, all time.",
    format: (v) => `${fmt(v)} pts`,
  },
  {
    value: "streakDays",
    label: "Streaks",
    caption: "Ranked by consecutive days with an earn.",
    format: (v) => `${fmt(v)} d`,
  },
  {
    value: "badgeCount",
    label: "Badges",
    caption: "Ranked by soulbound badges claimed.",
    format: (v) => `${v}/4`,
  },
];

export default function LeaderboardPage() {
  const [rows, setRows] = useState<TraderRow[] | null>(null);
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [metric, setMetric] = useState<LeaderboardMetric>("degenScore");
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);

  // The burner keypair only exists in the browser; reading it during render
  // would desync the SSR pass.
  useEffect(() => {
    setMe(getWallet().publicKey.toBase58());
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const [traders, protocol] = await Promise.all([fetchTraders(), fetchProtocolStats()]);
      setRows(traders);
      setStats(protocol);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = METRICS.find((m) => m.value === metric)!;
  const ranked = useMemo(() => (rows ? rankTraders(rows, metric) : []), [rows, metric]);

  const top = ranked.slice(0, TOP_N);
  const myIndex = me ? ranked.findIndex((row) => row.wallet === me) : -1;
  const pinned = myIndex >= TOP_N ? ranked[myIndex] : null;
  const max = ranked.length > 0 ? ranked[0][metric] : 0;

  return (
    <Screen title="Leaderboard" subtitle="Every rank is read straight off the chain.">
      {stats && (
        <div className="card grid grid-cols-2 gap-y-3 gap-x-4">
          <Stat label="Circulating" value={fmt(stats.circulating)} hint="points" />
          <Stat label="Traders" value={fmt(stats.traders)} />
          <Stat label="Shops" value={fmt(stats.shops)} />
          <Stat label="Coupons redeemed" value={fmt(stats.couponsRedeemed)} />
        </div>
      )}

      <div className="space-y-2">
        <Segmented
          label="Ranking metric"
          options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
          value={metric}
          onChange={setMetric}
        />
        <p className="text-2xs text-faint leading-relaxed">{active.caption}</p>
      </div>

      {error && <ErrorNote error={error} onRetry={() => void load()} />}

      {!error && rows === null && <CardSkeleton rows={5} />}

      {!error && rows !== null && ranked.length === 0 && (
        <EmptyState
          icon={<IconMedal size={30} />}
          title="Nobody ranked yet"
          body="The board fills up as soon as the first wallet earns points."
        />
      )}

      {!error && ranked.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Top {Math.min(TOP_N, ranked.length)}</SectionTitle>
          <ol className="space-y-2">
            {top.map((row, index) => (
              <li key={row.wallet}>
                <TraderCard
                  row={row}
                  rank={index + 1}
                  metric={metric}
                  max={max}
                  format={active.format}
                  isMe={row.wallet === me}
                />
              </li>
            ))}
          </ol>

          {pinned && (
            <div className="pt-2 space-y-2">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-edge" />
                <span className="text-2xs text-faint">Your position</span>
                <span className="h-px flex-1 bg-edge" />
              </div>
              <TraderCard
                row={pinned}
                rank={myIndex + 1}
                metric={metric}
                max={max}
                format={active.format}
                isMe
              />
            </div>
          )}

          {me && myIndex === -1 && (
            <p className="text-2xs text-faint leading-relaxed pt-1">
              Your wallet isn&apos;t on this board yet — earn points at a shop to enter.
            </p>
          )}
        </section>
      )}
    </Screen>
  );
}

function TraderCard({
  row,
  rank,
  metric,
  max,
  format,
  isMe,
}: {
  row: TraderRow;
  rank: number;
  metric: LeaderboardMetric;
  max: number;
  format: (value: number) => string;
  isMe: boolean;
}) {
  return (
    <div className={`card space-y-2 ${isMe ? "border-accent/50" : ""}`}>
      <BarRow
        value={row[metric]}
        max={max}
        valueLabel={format(row[metric])}
        highlight={isMe}
        leading={
          <>
            <span className={`tnum text-sm w-6 shrink-0 ${rank <= 3 ? "text-champagne" : "text-faint"}`}>
              {rank}
            </span>
            <WalletAvatar address={row.wallet} size={28} />
          </>
        }
        label={
          <span className="flex items-center gap-2 min-w-0">
            <a
              href={explorerAddr(row.wallet)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 min-h-[44px] font-medium hover:text-accent"
            >
              {shortAddress(row.wallet)}
              <IconExternal size={11} className="text-faint" />
            </a>
            {isMe && <span className="pill border-accent/50 text-accent shrink-0">You</span>}
          </span>
        }
      />
      <div className="flex items-center gap-2 text-2xs text-faint overflow-x-auto no-scrollbar">
        <span className="shrink-0 text-muted">{tierName(row.tier)}</span>
        <span className="shrink-0">·</span>
        <span className="shrink-0 tnum">{fmt(row.positionsClosed)} closed</span>
        <span className="shrink-0">·</span>
        <span className="shrink-0 tnum">{fmt(row.timesLiquidated)} liquidated</span>
      </div>
    </div>
  );
}
