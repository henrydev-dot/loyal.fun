"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWallet } from "@/lib/wallet";
import { fetchProfile, loyalBalance } from "@/lib/actions";
import { explorerAddr } from "@/lib/config";

const TIERS = ["🥉 Bronze", "🥈 Silver", "🥇 Gold", "💎 Degen"];

export default function Home() {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [address, setAddress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wallet = getWallet();
    setAddress(wallet.publicKey.toBase58());
    loyalBalance(wallet.publicKey)
      .then(setBalance)
      .catch(() => setBalance(0n));
    fetchProfile(wallet)
      .then(setProfile)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          loyal<span className="text-loyal">.fun</span>
        </h1>
        <a
          href={explorerAddr(address)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-500 underline"
        >
          {address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "…"}
        </a>
      </header>

      <div className="card text-center py-8 space-y-2">
        <p className="stat-label">your bag</p>
        <p className="text-5xl font-bold text-loyal animate-pop">
          {balance === null ? "…" : balance.toLocaleString()}
        </p>
        <p className="text-zinc-400">$LOYAL points</p>
        {profile && (
          <div className="flex justify-center gap-6 pt-2 text-sm">
            <span>
              🔥 <b>{profile.streakDays}</b> day streak
            </span>
            <span>{TIERS[profile.tier] ?? TIERS[0]}</span>
          </div>
        )}
      </div>

      {!profile && !error && (
        <div className="card text-center text-zinc-400 text-sm">
          Fresh wallet, zero baggage. Scan your first QR at the till and the
          points start flowing — no seed phrase, no gas, no crypto homework.
        </div>
      )}
      {error && (
        <div className="card border-dump/40 text-sm text-dump break-all">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/scan" className="btn-loyal">
          📷 Scan &amp; Earn
        </Link>
        <Link href="/degen" className="btn-ghost">
          🎰 Ape the points
        </Link>
      </div>

      {profile && (
        <div className="card grid grid-cols-3 text-center divide-x divide-edge">
          <div>
            <p className="stat-label">earned</p>
            <p className="font-bold">{profile.earnedTotal.toString()}</p>
          </div>
          <div>
            <p className="stat-label">spent</p>
            <p className="font-bold">{profile.spentTotal.toString()}</p>
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
        </div>
      )}

      <p className="text-center text-xs text-zinc-600 pt-2">
        closed-loop utility points · not money · no fiat off-ramp
      </p>
    </div>
  );
}
