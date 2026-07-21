"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWallet } from "@/lib/wallet";
import { fetchProfile, loyalBalance } from "@/lib/actions";
import { explorerAddr } from "@/lib/config";
import { IconChart, IconExternal, IconFlame, IconScan, LogoMark } from "@/components/icons";

const TIERS = ["Bronze", "Silver", "Gold", "Degen"];

export default function Home() {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [address, setAddress] = useState<string>("");

  useEffect(() => {
    const wallet = getWallet();
    setAddress(wallet.publicKey.toBase58());
    loyalBalance(wallet.publicKey)
      .then(setBalance)
      .catch(() => setBalance(0n));
    // No profile yet (or programs not deployed) simply means a fresh start.
    fetchProfile(wallet)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <h1 className="text-2xl font-semibold">
            loyal<span className="text-accent">.fun</span>
          </h1>
        </div>
        <a
          href={explorerAddr(address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-faint hover:text-muted"
        >
          {address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "…"}
          <IconExternal size={11} />
        </a>
      </header>

      <div className="card text-center py-9 space-y-2 animate-rise">
        <p className="stat-label">Balance</p>
        <p className="font-display text-6xl font-semibold text-accent tracking-tight">
          {balance === null ? "—" : balance.toLocaleString()}
        </p>
        <p className="text-muted text-sm">$LOYAL points</p>
        {profile && (
          <div className="flex justify-center gap-6 pt-3 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-accent">
                <IconFlame size={16} />
              </span>
              <b className="text-ink">{profile.streakDays}</b>-day streak
            </span>
            <span>
              Tier: <b className="text-champagne">{TIERS[profile.tier] ?? TIERS[0]}</b>
            </span>
          </div>
        )}
      </div>

      {!profile && (
        <div className="card text-sm text-muted leading-relaxed">
          A fresh ledger. Scan your first code at the till and the points start
          flowing — no seed phrase, no gas, nothing to configure.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/scan" className="btn-primary">
          <IconScan size={18} /> Scan &amp; earn
        </Link>
        <Link href="/degen" className="btn-ghost">
          <IconChart size={18} /> Open a position
        </Link>
      </div>

      {profile && (
        <div className="card grid grid-cols-3 text-center divide-x divide-edge">
          <div>
            <p className="stat-label">Earned</p>
            <p className="font-semibold pt-1">{profile.earnedTotal.toString()}</p>
          </div>
          <div>
            <p className="stat-label">Spent</p>
            <p className="font-semibold pt-1">{profile.spentTotal.toString()}</p>
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
        </div>
      )}

      <p className="text-center text-[11px] text-faint pt-2 tracking-wide">
        Closed-loop utility points · not money · no fiat off-ramp
      </p>
    </div>
  );
}
