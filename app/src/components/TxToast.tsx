"use client";

import { explorerTx } from "@/lib/config";
import { IconCheck, IconClose, IconExternal } from "./icons";

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
    <div className="fixed bottom-24 inset-x-4 z-50 mx-auto max-w-md animate-rise">
      <div className="card border-accent/40 flex items-center gap-3">
        <span className="text-gain shrink-0">
          <IconCheck size={26} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{message}</p>
          {signature && (
            <a
              href={explorerTx(signature)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent underline underline-offset-2"
            >
              View on Solana Explorer <IconExternal size={12} />
            </a>
          )}
        </div>
        <button onClick={onClose} aria-label="dismiss" className="text-faint hover:text-ink px-1">
          <IconClose size={18} />
        </button>
      </div>
    </div>
  );
}
