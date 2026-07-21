"use client";

import { useEffect, useState } from "react";
import { getWallet, exportWallet } from "@/lib/wallet";
import { claimBadge, fetchProfile } from "@/lib/actions";
import { getHistory, HistoryEntry, recordTx } from "@/lib/history";
import { explorerTx } from "@/lib/config";
import TxToast from "@/components/TxToast";

const BADGES = [
  { id: 0, name: "First Blood", emoji: "🩸", hint: "settle your first position" },
  { id: 1, name: "5x Full Send", emoji: "🚀", hint: "hit the 5x payout clamp" },
  { id: 2, name: "Got Liquidated", emoji: "💀", hint: "F. you know what you did" },
  { id: 3, name: "7-Day Streak", emoji: "🔥", hint: "earn 7 days in a row" },
];

const TIERS = ["🥉 Bronze", "🥈 Silver", "🥇 Gold", "💎 Degen"];

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
      setToast({ message: `${badge.emoji} ${badge.name} — soulbound forever`, signature });
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
      <h1 className="text-2xl font-bold">Profile</h1>

      {profile && (
        <div className="card grid grid-cols-3 text-center divide-x divide-edge">
          <div>
            <p className="stat-label">tier</p>
            <p className="font-bold">{TIERS[profile.tier] ?? TIERS[0]}</p>
          </div>
          <div>
            <p className="stat-label">degen score</p>
            <p
              className={`font-bold ${
                profile.degenScore.toNumber() >= 0 ? "text-pump" : "text-dump"
              }`}
            >
              {profile.degenScore.toString()}
            </p>
          </div>
          <div>
            <p className="stat-label">liquidated</p>
            <p className="font-bold">{profile.timesLiquidated}×</p>
          </div>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold text-zinc-300">Badge shelf (soulbound)</h2>
        <div className="grid grid-cols-2 gap-3">
          {BADGES.map((badge) => {
            const isClaimed = (claimed & (1 << badge.id)) !== 0;
            const isEligible = (eligible & (1 << badge.id)) !== 0;
            return (
              <div
                key={badge.id}
                className={`card text-center space-y-1 ${
                  isClaimed ? "border-gold/60" : isEligible ? "border-loyal/60" : "opacity-50"
                }`}
              >
                <p className="text-3xl">{badge.emoji}</p>
                <p className="font-semibold text-sm">{badge.name}</p>
                {isClaimed ? (
                  <p className="text-xs text-gold">minted ✓</p>
                ) : isEligible ? (
                  <button
                    onClick={() => claim(badge.id)}
                    disabled={busy !== null}
                    className="btn-loyal w-full !py-1.5 text-sm"
                  >
                    {busy === badge.id ? "…" : "Claim"}
                  </button>
                ) : (
                  <p className="text-xs text-zinc-600">{badge.hint}</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-zinc-600">
          Badges are NonTransferable Token-2022 mints — any dApp can token-gate
          on them, nobody can buy them.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-zinc-300">Activity</h2>
        {history.length === 0 && (
          <p className="text-sm text-zinc-500">Every action you take links here.</p>
        )}
        <div className="space-y-2">
          {history.map((entry) => (
            <a
              key={entry.signature}
              href={explorerTx(entry.signature)}
              target="_blank"
              rel="noreferrer"
              className="card flex items-center justify-between text-sm hover:border-loyal"
            >
              <span>{entry.label}</span>
              <span className="text-xs text-loyal">explorer ↗</span>
            </a>
          ))}
        </div>
      </section>

      <section className="card text-xs text-zinc-500 space-y-2">
        <p>
          Your wallet is an embedded burner keypair — no seed phrase ceremony,
          gas paid by the relayer. Export it before clearing your browser.
        </p>
        <button onClick={() => setShowExport((s) => !s)} className="btn-ghost w-full !py-2">
          {showExport ? "Hide" : "Export"} secret key
        </button>
        {showExport && (
          <p className="font-mono break-all bg-bg rounded-lg p-2">{exportWallet()}</p>
        )}
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
