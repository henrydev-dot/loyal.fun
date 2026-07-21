/** Live prices straight from Pyth's Hermes API (same feeds the program reads). */

const HERMES = "https://hermes.pyth.network";

export interface LivePrice {
  price: number;
  confidence: number;
  publishTime: number;
}

export async function fetchLatestPrices(
  feedIds: string[]
): Promise<Record<string, LivePrice>> {
  const params = feedIds.map((id) => `ids[]=0x${id}`).join("&");
  const res = await fetch(`${HERMES}/v2/updates/price/latest?${params}&parsed=true`);
  if (!res.ok) throw new Error(`hermes ${res.status}`);
  const body = await res.json();
  const out: Record<string, LivePrice> = {};
  for (const item of body.parsed ?? []) {
    const p = item.price;
    const scale = Math.pow(10, p.expo);
    out[item.id] = {
      price: Number(p.price) * scale,
      confidence: Number(p.conf) * scale,
      publishTime: p.publish_time,
    };
  }
  return out;
}

export function formatUsd(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}
