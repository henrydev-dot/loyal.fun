/**
 * Read-only chain queries that power discovery surfaces (leaderboard, shop
 * directory, protocol stats, position history).
 *
 * Everything here is derived from accounts the deployed program already
 * writes — no indexer, no backend, no program change. `getProgramAccounts`
 * on devnet is cheap at demo scale; results are memoised briefly so tab
 * switches don't re-hammer the RPC.
 */
import { PublicKey } from "@solana/web3.js";
import { getProgram } from "./program";
import { getWallet } from "./wallet";
import { vaultPda } from "./pdas";
import { VAULTS } from "./config";

/* ------------------------------------------------------------------ cache */

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateQueries(): void {
  cache.clear();
}

const num = (value: any): number =>
  typeof value === "number" ? value : Number(value?.toString() ?? 0);

/* ------------------------------------------------------------- leaderboard */

export interface TraderRow {
  wallet: string;
  earnedTotal: number;
  spentTotal: number;
  degenScore: number;
  streakDays: number;
  tier: number;
  positionsClosed: number;
  timesLiquidated: number;
  badges: number;
  badgeCount: number;
}

const popcount = (n: number): number => {
  let count = 0;
  let v = n >>> 0;
  while (v) {
    v &= v - 1;
    count++;
  }
  return count;
};

export async function fetchTraders(): Promise<TraderRow[]> {
  return cached("traders", async () => {
    const program = await getProgram(getWallet());
    const accounts = await (program.account as any).userProfile.all();
    return accounts.map((entry: any): TraderRow => {
      const a = entry.account;
      const badges = num(a.badges);
      return {
        wallet: a.wallet.toBase58(),
        earnedTotal: num(a.earnedTotal),
        spentTotal: num(a.spentTotal),
        degenScore: num(a.degenScore),
        streakDays: num(a.streakDays),
        tier: num(a.tier),
        positionsClosed: num(a.positionsClosed),
        timesLiquidated: num(a.timesLiquidated),
        badges,
        badgeCount: popcount(badges),
      };
    });
  });
}

export type LeaderboardMetric = "degenScore" | "earnedTotal" | "streakDays" | "badgeCount";

/** Sorted view over the trader set; ties broken so the order is stable. */
export function rankTraders(rows: TraderRow[], metric: LeaderboardMetric): TraderRow[] {
  return [...rows]
    .filter((row) => row[metric] !== 0 || metric === "degenScore")
    .sort((a, b) => b[metric] - a[metric] || b.earnedTotal - a.earnedTotal || a.wallet.localeCompare(b.wallet));
}

/* ------------------------------------------------------------------ shops */

export interface ShopRow {
  address: string;
  authority: string;
  name: string;
  category: string;
  totalIssued: number;
  rewardBudget: number;
  listingCount: number;
  couponsRedeemed: number;
  active: boolean;
}

export interface ListingRow {
  address: string;
  merchant: string;
  listingId: number;
  title: string;
  pricePoints: number;
  stock: number;
  uri: string;
}

export async function fetchShops(): Promise<ShopRow[]> {
  return cached("shops", async () => {
    const program = await getProgram(getWallet());
    const accounts = await (program.account as any).merchant.all();
    return accounts
      .map((entry: any): ShopRow => {
        const a = entry.account;
        return {
          address: entry.publicKey.toBase58(),
          authority: a.authority.toBase58(),
          name: a.name,
          category: a.category,
          totalIssued: num(a.totalIssued),
          rewardBudget: num(a.rewardBudget),
          listingCount: num(a.listingCount),
          couponsRedeemed: num(a.couponsRedeemed),
          active: Boolean(a.active),
        };
      })
      .sort((a: ShopRow, b: ShopRow) => b.totalIssued - a.totalIssued);
  });
}

export async function fetchListings(): Promise<ListingRow[]> {
  return cached("listings", async () => {
    const program = await getProgram(getWallet());
    const accounts = await (program.account as any).rewardListing.all();
    return accounts.map((entry: any): ListingRow => {
      const a = entry.account;
      return {
        address: entry.publicKey.toBase58(),
        merchant: a.merchant.toBase58(),
        listingId: num(a.listingId),
        title: a.title,
        pricePoints: num(a.pricePoints),
        stock: num(a.stock),
        uri: a.uri,
      };
    });
  });
}

export async function fetchShop(address: string): Promise<{ shop: ShopRow | null; listings: ListingRow[] }> {
  const [shops, listings] = await Promise.all([fetchShops(), fetchListings()]);
  return {
    shop: shops.find((s) => s.address === address) ?? null,
    listings: listings.filter((l) => l.merchant === address),
  };
}

/* --------------------------------------------------------------- positions */

export type PositionStatusName = "open" | "closed" | "liquidated";

export interface PositionRow {
  address: string;
  user: string;
  vault: string;
  symbol: string;
  positionId: number;
  stake: number;
  entryPrice: number;
  leverage: number;
  openedTs: number;
  status: PositionStatusName;
}

/** vault PDA → ticker, computed once. */
const vaultSymbolMap = (): Map<string, string> =>
  new Map(VAULTS.map((v) => [vaultPda(v.symbol).toBase58(), v.symbol]));

function toPositionRow(entry: any, symbols: Map<string, string>): PositionRow {
  const a = entry.account;
  const vault = a.vault.toBase58();
  return {
    address: entry.publicKey.toBase58(),
    user: a.user.toBase58(),
    vault,
    symbol: symbols.get(vault) ?? "?",
    positionId: num(a.positionId),
    stake: num(a.stake),
    // Anchor's IDL camel-cases `entry_price_1e6`; tolerate both spellings.
    entryPrice: num(a.entryPrice1E6 ?? a.entryPrice1e6) / 1e6,
    leverage: num(a.leverage),
    openedTs: num(a.openedTs),
    status: (Object.keys(a.status ?? {})[0] ?? "open") as PositionStatusName,
  };
}

/** Every position for one wallet, newest first (open and settled alike). */
export async function fetchUserPositions(wallet: PublicKey): Promise<PositionRow[]> {
  const program = await getProgram(getWallet());
  const symbols = vaultSymbolMap();
  const accounts = await (program.account as any).position.all([
    { memcmp: { offset: 8, bytes: wallet.toBase58() } },
  ]);
  return accounts
    .map((entry: any) => toPositionRow(entry, symbols))
    .sort((a: PositionRow, b: PositionRow) => b.openedTs - a.openedTs);
}

/** Open positions across all users — the permissionless-liquidation surface. */
export async function fetchAllOpenPositions(): Promise<PositionRow[]> {
  return cached("open-positions", async () => {
    const program = await getProgram(getWallet());
    const symbols = vaultSymbolMap();
    const accounts = await (program.account as any).position.all();
    return accounts
      .map((entry: any) => toPositionRow(entry, symbols))
      .filter((p: PositionRow) => p.status === "open")
      .sort((a: PositionRow, b: PositionRow) => b.stake - a.stake);
  });
}

/* ------------------------------------------------------------ protocol */

export interface ProtocolStats {
  totalMinted: number;
  totalBurned: number;
  circulating: number;
  globalOpenExposure: number;
  maxGlobalExposure: number;
  feeBps: number;
  paused: boolean;
  traders: number;
  shops: number;
  listings: number;
  couponsRedeemed: number;
  pointsIssued: number;
}

export async function fetchProtocolStats(): Promise<ProtocolStats> {
  return cached("protocol", async () => {
    const program = await getProgram(getWallet());
    const { configPda } = await import("./pdas");
    const [config, shops, listings, traders] = await Promise.all([
      (program.account as any).config.fetch(configPda()),
      fetchShops(),
      fetchListings(),
      fetchTraders(),
    ]);
    const minted = num(config.totalMinted);
    const burned = num(config.totalBurned);
    return {
      totalMinted: minted,
      totalBurned: burned,
      circulating: Math.max(0, minted - burned),
      globalOpenExposure: num(config.globalOpenExposure),
      maxGlobalExposure: num(config.maxGlobalExposure),
      feeBps: num(config.feeBps),
      paused: Boolean(config.paused),
      traders: traders.length,
      shops: shops.length,
      listings: listings.length,
      couponsRedeemed: shops.reduce((sum, s) => sum + s.couponsRedeemed, 0),
      pointsIssued: shops.reduce((sum, s) => sum + s.totalIssued, 0),
    };
  });
}

/* ---------------------------------------------------------------- tiers */

export const TIER_NAMES = ["Bronze", "Silver", "Gold", "Degen"] as const;
export const tierName = (tier: number): string => TIER_NAMES[tier] ?? TIER_NAMES[0];

/** Names mirror Badge::metadata in state.rs — the mint is the source of truth. */
export const BADGE_META = [
  { id: 0, name: "First Blood", hint: "Settle your first position" },
  { id: 1, name: "5x Full Send", hint: "Hit the 5× payout cap" },
  { id: 2, name: "Liquidated", hint: "You know what you did" },
  { id: 3, name: "7-Day Streak", hint: "Earn 7 days in a row" },
] as const;

/** Lifetime earned points per tier — mirrors constants.rs TIER_*_EARNED. */
export const TIER_THRESHOLDS = [
  { tier: 1, name: "Silver", at: 1_000 },
  { tier: 2, name: "Gold", at: 5_000 },
  { tier: 3, name: "Degen", at: 20_000 },
] as const;
