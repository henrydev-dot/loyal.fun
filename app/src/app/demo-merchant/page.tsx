"use client";

/**
 * /demo-merchant — one-tap demo till.
 *
 * A kiosk-style shortcut for judges and testers: open this page on one
 * device, tap an amount, and a signed 60-second sale QR appears instantly.
 * On first use it registers a throwaway "Demo Till" merchant on-chain
 * (sponsored by the relayer) using this browser's merchant keys — the same
 * identity the full /merchant panel manages.
 */
import { useCallback, useEffect, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import QRCode from "qrcode";
import { getMerchantWallet, getMerchantQrSigner } from "@/lib/wallet";
import { getProgram } from "@/lib/program";
import { sendSponsored } from "@/lib/relayer";
import { configPda } from "@/lib/pdas";
import { demoMerchantPda, makeSaleQrUrl, QR_TTL_SECS } from "@/lib/saleQr";
import { IconAlert, IconReceipt, IconSpinner, LogoMark } from "@/components/icons";

const PRESETS = [50, 100, 200, 500];

type Status = "checking" | "unregistered" | "registering" | "ready";

export default function DemoMerchantPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [points, setPoints] = useState(100);
  const [qr, setQr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const program = await getProgram(getMerchantWallet());
      await (program.account as any).merchant.fetch(demoMerchantPda());
      setStatus("ready");
    } catch {
      setStatus("unregistered");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    if (countdown === 1) setQr(null);
    return () => clearTimeout(timer);
  }, [countdown]);

  const register = async () => {
    setStatus("registering");
    setError(null);
    try {
      const wallet = getMerchantWallet();
      const program = await getProgram(wallet);
      const ix = await program.methods
        .registerMerchant(
          "Demo Till",
          "demo",
          getMerchantQrSigner().publicKey,
          new anchor.BN(1_000_000)
        )
        .accounts({
          authority: wallet.publicKey,
          config: configPda(),
          merchant: demoMerchantPda(),
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      await sendSponsored([ix], [wallet]);
      setStatus("ready");
    } catch (err) {
      setError(String(err));
      setStatus("unregistered");
    }
  };

  const generate = async (pts: number) => {
    setPoints(pts);
    setError(null);
    try {
      const url = makeSaleQrUrl(pts);
      setQr(
        await QRCode.toDataURL(url, {
          margin: 2,
          width: 560,
          errorCorrectionLevel: "L",
        })
      );
      setCountdown(QR_TTL_SECS);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2.5">
        <LogoMark size={30} />
        <h1 className="text-2xl font-semibold">
          Demo till
          <span className="text-muted font-body text-base font-normal"> — instant sale QR</span>
        </h1>
      </div>
      <p className="text-sm text-muted leading-relaxed">
        Testing shortcut: tap an amount, scan the code with the customer app
        (Scan tab) on another device. Each code is signed and valid for {QR_TTL_SECS}s.
      </p>

      {status === "checking" && (
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <IconSpinner size={16} /> Checking demo merchant…
        </p>
      )}

      {(status === "unregistered" || status === "registering") && (
        <button
          onClick={register}
          disabled={status === "registering"}
          className="btn-primary w-full"
        >
          <IconReceipt size={18} />
          {status === "registering"
            ? "Registering demo till on-chain…"
            : "One-tap setup: register demo till"}
        </button>
      )}

      {status === "ready" && (
        <>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => generate(preset)}
                className={`btn !py-3 tabular-nums ${
                  qr && points === preset
                    ? "bg-accent text-bg"
                    : "border border-edge text-ink/80 hover:border-faint"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {qr ? (
            <div className="card text-center space-y-2 animate-pop">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="sale QR" className="rounded-lg mx-auto w-72 h-72" />
              <p className="text-sm text-muted">
                <b className="text-accent tabular-nums">+{points} LOYAL</b> · expires in{" "}
                <b className="text-accent tabular-nums">{countdown}s</b>
              </p>
              <button onClick={() => generate(points)} className="btn-ghost w-full !py-2">
                New code, same amount
              </button>
            </div>
          ) : (
            <p className="text-sm text-faint text-center py-8">
              Pick an amount above to render the QR.
            </p>
          )}
        </>
      )}

      {error && (
        <div className="card border-loss/40 text-sm text-loss break-all flex gap-2">
          <span className="shrink-0 pt-0.5">
            <IconAlert size={16} />
          </span>
          {error}
        </div>
      )}

      <p className="text-[11px] text-faint leading-relaxed">
        Demo-grade: keys live in this browser. Same closed loop, same on-chain
        verification — the customer transaction still checks the ed25519
        signature, nonce and expiry.
      </p>
    </div>
  );
}
