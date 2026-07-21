"use client";

import { useEffect, useRef, useState } from "react";
import { getWallet } from "@/lib/wallet";
import { scanAndEarn } from "@/lib/actions";
import { QrPayload } from "@/lib/relayer";
import { recordTx } from "@/lib/history";
import TxToast from "@/components/TxToast";
import { IconAlert, IconCheck, IconScan, IconSpinner } from "@/components/icons";

type ScanState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "submitting" }
  | { kind: "done"; points: number; signature: string }
  | { kind: "error"; message: string };

export default function ScanPage() {
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  const [manual, setManual] = useState("");
  const scannerRef = useRef<any>(null);
  const regionId = "qr-region";

  const handlePayload = async (raw: string) => {
    let payload: QrPayload;
    try {
      payload = JSON.parse(raw);
      if (!payload.merchant || !payload.signature) throw new Error();
    } catch {
      setState({ kind: "error", message: "That code is not a loyal.fun sale QR." });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const signature = await scanAndEarn(getWallet(), payload);
      recordTx(`Earned ${payload.points} $LOYAL`, signature);
      setState({ kind: "done", points: payload.points, signature });
    } catch (err) {
      setState({ kind: "error", message: String(err) });
    }
  };

  const startCamera = async () => {
    setState({ kind: "scanning" });
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode(regionId);
    scannerRef.current = scanner;
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 240 },
      (text: string) => {
        scanner.stop().catch(() => undefined);
        void handlePayload(text);
      },
      () => undefined
    );
  };

  useEffect(() => {
    return () => {
      scannerRef.current?.stop().catch(() => undefined);
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Scan &amp; earn</h1>
      <p className="text-sm text-muted leading-relaxed">
        Point the camera at the code on the till. Each QR is signed by the shop
        and expires in 60 seconds — screenshots don&apos;t work.
      </p>

      <div id={regionId} className="rounded-xl overflow-hidden border border-edge min-h-[100px]" />

      {state.kind === "idle" && (
        <button onClick={startCamera} className="btn-primary w-full">
          <IconScan size={18} /> Open camera
        </button>
      )}
      {state.kind === "scanning" && (
        <p className="text-center text-sm text-muted">Scanning…</p>
      )}
      {state.kind === "submitting" && (
        <p className="inline-flex w-full items-center justify-center gap-2 text-sm text-accent">
          <IconSpinner size={16} /> Minting your points on Solana…
        </p>
      )}
      {state.kind === "done" && (
        <div className="card text-center py-9 space-y-3 border-accent/50 animate-pop">
          <span className="inline-flex text-gain">
            <IconCheck size={44} strokeWidth={1.2} />
          </span>
          <p className="font-display text-4xl font-semibold text-accent">
            +{state.points} LOYAL
          </p>
          <p className="text-sm text-muted">Banked. Take a position or treat yourself.</p>
        </div>
      )}
      {state.kind === "error" && (
        <div className="card border-loss/40 text-sm text-loss break-all flex gap-2">
          <span className="shrink-0 pt-0.5">
            <IconAlert size={16} />
          </span>
          {state.message}
        </div>
      )}

      <details className="card text-sm text-muted">
        <summary className="cursor-pointer select-none">No camera? Paste the QR payload</summary>
        <textarea
          className="input mt-3 h-28 font-mono text-xs"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder='{"merchant":"…","points":200,…}'
        />
        <button onClick={() => handlePayload(manual)} className="btn-ghost w-full mt-2">
          Submit
        </button>
      </details>

      {state.kind === "done" && (
        <TxToast
          message={`+${state.points} LOYAL earned`}
          signature={state.signature}
          onClose={() => setState({ kind: "idle" })}
        />
      )}
    </div>
  );
}
