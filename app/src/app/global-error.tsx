"use client";

/** Last-resort boundary for crashes in the root layout itself. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#0D0B09", color: "#EFE9DF", fontFamily: "system-ui", padding: 24 }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Something broke</h1>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            fontSize: 12,
            color: "#D9705C",
            border: "1px solid #2A231E",
            borderRadius: 8,
            padding: 12,
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack.slice(0, 600)}` : ""}
        </pre>
        <button
          onClick={reset}
          style={{
            marginTop: 16,
            background: "#D9A441",
            color: "#0D0B09",
            border: 0,
            borderRadius: 8,
            padding: "10px 18px",
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
