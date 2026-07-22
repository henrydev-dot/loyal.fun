"use client";

/**
 * Route-level error boundary: surfaces the actual exception instead of
 * Next's generic "Application error" page, so browser-specific issues
 * (looking at you, Safari) can be diagnosed from a screenshot.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4 pt-10">
      <h1 className="text-2xl font-semibold">Something broke</h1>
      <p className="text-sm text-muted">
        The screen crashed. The exact error is below — a screenshot of this
        helps us fix it fast.
      </p>
      <pre className="card text-xs text-loss whitespace-pre-wrap break-all">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        {error.stack ? `\n\n${error.stack.slice(0, 600)}` : ""}
      </pre>
      <button onClick={reset} className="btn-primary w-full">
        Try again
      </button>
    </div>
  );
}
