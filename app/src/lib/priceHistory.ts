/**
 * Rolling in-memory price window that backs the sparklines.
 *
 * Hermes' "latest price" endpoint returns a point, not a series, so we keep
 * the last N samples the app has seen. It survives tab switches (module
 * state) but intentionally not reloads — a sparkline that lies about history
 * it never observed would be worse than a short one.
 */
import type { SparklinePoint } from "@/components/viz";

const MAX_POINTS = 60;
const series = new Map<string, SparklinePoint[]>();

export function pushPrice(feedId: string, value: number, at = Date.now()): void {
  if (!Number.isFinite(value) || value <= 0) return;
  const points = series.get(feedId) ?? [];
  const last = points[points.length - 1];
  // Ignore duplicate publishes so the line reflects real movement only.
  if (last && last.v === value && at - last.t < 1_000) return;
  points.push({ t: at, v: value });
  if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
  series.set(feedId, points);
}

export function getPriceSeries(feedId: string): SparklinePoint[] {
  return series.get(feedId) ?? [];
}

/** Percentage move across the observed window; null until we have two points. */
export function windowChangePct(feedId: string): number | null {
  const points = series.get(feedId) ?? [];
  if (points.length < 2) return null;
  const first = points[0].v;
  const last = points[points.length - 1].v;
  if (!first) return null;
  return ((last - first) / first) * 100;
}
