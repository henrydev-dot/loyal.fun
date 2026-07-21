"use client";

import { explorerTx } from "@/lib/config";

/** Success toast with an explorer link — every action stays verifiable. */
export default function TxToast({
  message,
  signature,
  onClose,
}: {
  message: string;
  signature?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed bottom-24 inset-x-4 z-50 mx-auto max-w-md animate-pop">
      <div className="card border-loyal/40 flex items-center gap-3">
        <span className="text-2xl">✅</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{message}</p>
          {signature && (
            <a
              href={explorerTx(signature)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-loyal underline break-all"
            >
              view on Solana Explorer ↗
            </a>
          )}
        </div>
        <button onClick={onClose} className="text-zinc-500 px-1">
          ✕
        </button>
      </div>
    </div>
  );
}
