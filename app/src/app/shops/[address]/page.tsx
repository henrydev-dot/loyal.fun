"use client";

/**
 * Shop detail. Read-only on purpose: listings are shown here for discovery,
 * but the buy flow lives on /market where the balance and coupons are.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchShop, type ListingRow, type ShopRow } from "@/lib/queries";
import { explorerAddr } from "@/lib/config";
import { CardSkeleton, EmptyState, ErrorNote, Screen, SectionTitle } from "@/components/ui";
import { Stat } from "@/components/viz";
import { IconExternal, IconGift, IconStore } from "@/components/icons";

const fmt = (value: number) => value.toLocaleString("en-US");

export default function ShopDetailPage() {
  const params = useParams<{ address: string }>();
  const address = Array.isArray(params?.address) ? params.address[0] : (params?.address ?? "");

  const [shop, setShop] = useState<ShopRow | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setError(null);
    setLoading(true);
    try {
      const result = await fetchShop(address);
      setShop(result.shop);
      setListings(result.listings);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Screen title="Shop">
        <ErrorNote error={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen title="Shop">
        <CardSkeleton rows={3} />
      </Screen>
    );
  }

  if (!shop) {
    return (
      <Screen title="Shop">
        <EmptyState
          icon={<IconStore size={30} />}
          title="Shop not found"
          body="No merchant is registered at that address on this cluster."
          action={
            <Link href="/shops" className="btn-ghost">
              Back to shops
            </Link>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen title={shop.name} subtitle={shop.category}>
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className={`pill ${shop.active ? "border-accent/50 text-accent" : "text-faint"}`}>
            {shop.active ? "Issuing points" : "Paused"}
          </span>
          <a
            href={explorerAddr(shop.address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 min-h-[44px] text-xs text-accent"
          >
            Explorer <IconExternal size={11} />
          </a>
        </div>

        <div className="grid grid-cols-2 gap-y-3 gap-x-4">
          <Stat label="Points issued" value={fmt(shop.totalIssued)} />
          <Stat label="Coupons redeemed" value={fmt(shop.couponsRedeemed)} />
          <Stat label="Listings" value={fmt(shop.listingCount)} />
          <Stat label="Reward budget" value={fmt(shop.rewardBudget)} hint="points" />
        </div>
      </div>

      <section className="space-y-2">
        <SectionTitle
          action={
            <Link
              href="/market"
              className="inline-flex items-center min-h-[44px] px-1 -mr-1 text-xs text-accent"
            >
              Buy on market
            </Link>
          }
        >
          Rewards
        </SectionTitle>

        {listings.length === 0 ? (
          <EmptyState
            icon={<IconGift size={30} />}
            title="No rewards listed"
            body="This shop hasn't put anything up for points yet."
          />
        ) : (
          <ul className="space-y-2">
            {listings.map((listing) => {
              const soldOut = listing.stock === 0;
              return (
                <li key={listing.address} className={`card flex items-center gap-3 ${soldOut ? "opacity-55" : ""}`}>
                  <span className="text-accent shrink-0">
                    <IconGift size={24} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{listing.title}</p>
                    <p className="text-2xs text-faint tnum">
                      {soldOut ? "Sold out" : `${fmt(listing.stock)} left`}
                    </p>
                  </div>
                  <span className="tnum text-sm font-semibold shrink-0">
                    {fmt(listing.pricePoints)} pts
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-2xs text-faint leading-relaxed">
          Rewards are bought with points on the market tab — any shop&apos;s points work here.
        </p>
      </section>
    </Screen>
  );
}
