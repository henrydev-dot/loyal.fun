"use client";

import { useEffect, useRef, useState } from "react";
import { getWallet } from "@/lib/wallet";
import { scanAndEarn } from "@/lib/actions";
import { QrPayload } from "@/lib/relayer";
import { recordTx } from "@/lib/history";
import TxToast from "@/components/TxToast";

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
      setState({ kind: "error", message: "That QR is not a loyal.fun sale code." });
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
      <h1 className="text-2xl font-bold">Scan &amp; Earn</h1>
      <p className="text-sm text-zinc-400">
        Point your camera at the QR on the till. It&apos;s signed by the shop and
        dies in 60 seconds — screenshots won&apos;t fly.
      </p>

      <div id={regionId} className="rounded-2xl overflow-hidden border border-edge min-h-[100px]" />

      {state.kind === "idle" && (
        <button onClick={startCamera} className="btn-loyal w-full">
          📷 Open camera
        </button>
      )}
      {state.kind === "scanning" && (
        <p className="text-center text-sm text-zinc-400">scanning…</p>
      )}
      {state.kind === "submitting" && (
        <p className="text-center text-sm text-loyal animate-pulse">
          minting your points on Solana…
        </p>
      )}
      {state.kind === "done" && (
        <div className="card text-center py-8 space-y-2 border-loyal/50">
          <p className="text-5xl animate-floatUp">🎉</p>
          <p className="text-3xl font-bold text-loyal animate-pop">
            +{state.points} LOYAL
          </p>
          <p className="text-sm text-zinc-400">stacked. go long or grab a coffee.</p>
        </div>
      )}
      {state.kind === "error" && (
        <div className="card border-dump/40 text-sm text-dump break-all">
          {state.message}
        </div>
      )}

      <details className="card text-sm text-zinc-400">
        <summary className="cursor-pointer">No camera? Paste the QR payload</summary>
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

      {(state.kind === "done" || state.kind === "error") && state.kind === "done" && (
        <TxToast
          message={`+${state.points} LOYAL earned`}
          signature={state.signature}
          onClose={() => setState({ kind: "idle" })}
        />
      )}
    </div>
  );
}
