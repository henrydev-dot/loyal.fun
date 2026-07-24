"use client";

/**
 * The coalition directory: every merchant account registered against the
 * program, ordered by points issued (fetchShops already sorts).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchShops, type ShopRow } from "@/lib/queries";
import { CardSkeleton, EmptyState, ErrorNote, Screen } from "@/components/ui";
import { IconStore } from "@/components/icons";

const fmt = (value: number) => value.toLocaleString("en-US");

export default function ShopsPage() {
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setShops(null);
    try {
      setShops(await fetchShops());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen
      title="Shops"
      subtitle="One coalition: points earned at any shop are spendable at every shop."
    >
      {error && <ErrorNote error={error} onRetry={() => void load()} />}

      {!error && shops === null && <CardSkeleton rows={4} />}

      {!error && shops !== null && shops.length === 0 && (
        <EmptyState
          icon={<IconStore size={30} />}
          title="No shops yet"
          body="The directory lists every merchant registered on the program."
        />
      )}

      {!error && shops && shops.length > 0 && (
        <ul className="space-y-2">
          {shops.map((shop) => (
            <li key={shop.address}>
              <Link
                href={`/shops/${shop.address}`}
                className="card block space-y-2.5 hover:border-accent/60 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{shop.name}</p>
                    <p className="text-2xs text-faint tnum pt-0.5">
                      {fmt(shop.listingCount)} {shop.listingCount === 1 ? "listing" : "listings"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="pill">{shop.category}</span>
                    {!shop.active && <span className="pill text-faint">Paused</span>}
                  </div>
                </div>

                <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                  <span className="shrink-0">
                    <span className="stat-label block">Issued</span>
                    <span className="tnum text-sm font-semibold">{fmt(shop.totalIssued)} pts</span>
                  </span>
                  <span className="shrink-0">
                    <span className="stat-label block">Redeemed</span>
                    <span className="tnum text-sm font-semibold">{fmt(shop.couponsRedeemed)}</span>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
