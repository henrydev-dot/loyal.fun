/** Local action log so the Profile tab can link every action to Explorer. */

export interface HistoryEntry {
  label: string;
  signature: string;
  ts: number;
}

const KEY = "loyal.fun/history/v1";

export function recordTx(label: string, signature: string) {
  if (typeof window === "undefined") return;
  const entries = getHistory();
  entries.unshift({ label, signature, ts: Date.now() });
  window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 100)));
}

export function getHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
