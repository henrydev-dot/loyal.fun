"use client";

import { useEffect, useState } from "react";
import { getWallet, exportWallet } from "@/lib/wallet";
import { claimBadge, fetchProfile } from "@/lib/actions";
import { getHistory, HistoryEntry, recordTx } from "@/lib/history";
import { explorerTx } from "@/lib/config";
import TxToast from "@/components/TxToast";
import {
  IconAlert,
  IconDroplet,
  IconExternal,
  IconFlame,
  IconRocket,
  IconSkull,
} from "@/components/icons";

const BADGES = [
  { id: 0, name: "First Blood", Icon: IconDroplet, hint: "Settle your first position" },
  { id: 1, name: "Full Send", Icon: IconRocket, hint: "Hit the 5× payout cap" },
  { id: 2, name: "Liquidated", Icon: IconSkull, hint: "You know what you did" },
  { id: 3, name: "Seven Streak", Icon: IconFlame, hint: "Earn 7 days in a row" },
];

const TIERS = ["Bronze", "Silver", "Gold", "Degen"];

export default function ProfilePage() {
  const [profile, setProfile] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; signature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  const refresh = async () => {
    setProfile(await fetchProfile(getWallet()).catch(() => null));
    setHistory(getHistory());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const claim = async (badgeId: number) => {
    setBusy(badgeId);
    setError(null);
    try {
      const signature = await claimBadge(getWallet(), badgeId);
      const badge = BADGES.find((b) => b.id === badgeId)!;
      recordTx(`Claimed badge "${badge.name}"`, signature);
      setToast({ message: `${badge.name} — soulbound, forever`, signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const eligible = profile?.badgeEligible ?? 0;
  const claimed = profile?.badges ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Profile</h1>

      {profile && (
        <div className="card grid grid-cols-3 text-center divide-x divide-edge">
          <div>
            <p className="stat-label">Tier</p>
            <p className="font-semibold pt-1 text-champagne">
              {TIERS[profile.tier] ?? TIERS[0]}
            </p>
          </div>
          <div>
            <p className="stat-label">Score</p>
            <p
              className={`font-semibold pt-1 ${
                profile.degenScore.toNumber() >= 0 ? "text-gain" : "text-loss"
              }`}
            >
              {profile.degenScore.toString()}
            </p>
          </div>
          <div>
            <p className="stat-label">Liquidated</p>
            <p className="font-semibold pt-1">{profile.timesLiquidated}×</p>
          </div>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold text-muted text-lg">Badges — soulbound</h2>
        <div className="grid grid-cols-2 gap-3">
          {BADGES.map((badge) => {
            const isClaimed = (claimed & (1 << badge.id)) !== 0;
            const isEligible = (eligible & (1 << badge.id)) !== 0;
            const { Icon } = badge;
            return (
              <div
                key={badge.id}
                className={`card text-center space-y-2 ${
                  isClaimed
                    ? "border-champagne/60"
                    : isEligible
                      ? "border-accent/60"
                      : "opacity-45"
                }`}
              >
                <span
                  className={`inline-flex ${
                    isClaimed ? "text-champagne" : isEligible ? "text-accent" : "text-faint"
                  }`}
                >
                  <Icon size={30} strokeWidth={1.3} />
                </span>
                <p className="font-semibold text-sm">{badge.name}</p>
                {isClaimed ? (
                  <p className="text-xs text-champagne tracking-wide">Minted</p>
                ) : isEligible ? (
                  <button
                    onClick={() => claim(badge.id)}
                    disabled={busy !== null}
                    className="btn-primary w-full !py-1.5 text-sm"
                  >
                    {busy === badge.id ? "…" : "Claim"}
                  </button>
                ) : (
                  <p className="text-xs text-faint">{badge.hint}</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-faint leading-relaxed">
          Badges are NonTransferable Token-2022 mints — any dApp can gate on
          them, and nobody can buy their way in.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-muted text-lg">Activity</h2>
        {history.length === 0 && (
          <p className="text-sm text-faint">Every action you take links here.</p>
        )}
        <div className="space-y-2">
          {history.map((entry) => (
            <a
              key={entry.signature}
              href={explorerTx(entry.signature)}
              target="_blank"
              rel="noreferrer"
              className="card flex items-center justify-between text-sm hover:border-accent/60"
            >
              <span>{entry.label}</span>
              <span className="inline-flex items-center gap-1 text-xs text-accent">
                Explorer <IconExternal size={11} />
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="card text-xs text-faint space-y-2 leading-relaxed">
        <p>
          Your wallet is an embedded burner keypair — no seed-phrase ceremony,
          fees paid by the relayer. Export it before clearing your browser.
        </p>
        <button onClick={() => setShowExport((s) => !s)} className="btn-ghost w-full !py-2">
          {showExport ? "Hide" : "Export"} secret key
        </button>
        {showExport && (
          <p className="font-mono break-all bg-bg rounded-lg p-2 text-muted">
            {exportWallet()}
          </p>
        )}
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
