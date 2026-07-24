"use client";

/**
 * Reward market — spend points on merchant rewards, present coupons at the
 * till.
 *
 * Two chain surfaces meet here: reward listings (plain program accounts, read
 * instantly) and coupon cNFTs (DAS-indexed, which lags a purchase by seconds).
 * The UI treats that lag as a first-class state instead of showing an empty
 * shelf right after a buy.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { PublicKey } from "@solana/web3.js";
import { getWallet } from "@/lib/wallet";
import { buyReward, fetchConfig, fetchListings, loyalBalance } from "@/lib/actions";
import { fetchShops, invalidateQueries, type ShopRow } from "@/lib/queries";
import { fetchCoupons, type CouponAsset } from "@/lib/das";
import { recordTx } from "@/lib/history";
import TxToast from "@/components/TxToast";
import {
  CardSkeleton,
  EmptyState,
  ErrorNote,
  Screen,
  SectionTitle,
  Skeleton,
  Spinner,
} from "@/components/ui";
import { IconClose, IconGift, IconTicket } from "@/components/icons";

/** How long to wait for DAS to index a freshly minted coupon. */
const INDEX_POLL_MS = 20_000;
const INDEX_POLL_STEP_MS = 2_500;

const fmt = (value: number) => value.toLocaleString("en-US");

const num = (value: any): number =>
  typeof value === "number" ? value : Number(value?.toString() ?? 0);

interface RewardRow {
  key: string;
  pubkey: PublicKey;
  merchant: string;
  title: string;
  price: number;
  stock: number;
}

interface ShopGroup {
  merchant: string;
  shop: ShopRow | null;
  rows: RewardRow[];
}

export default function MarketPage() {
  const [rows, setRows] = useState<RewardRow[] | null>(null);
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [coupons, setCoupons] = useState<CouponAsset[]>([]);
  const [couponTree, setCouponTree] = useState<PublicKey | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [buying, setBuying] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [indexLag, setIndexLag] = useState(false);
  const [dasAvailable, setDasAvailable] = useState(true);
  const [couponQr, setCouponQr] = useState<{ name: string; dataUrl: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; signature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    const wallet = getWallet();
    setBalance(await loyalBalance(wallet.publicKey).catch(() => 0n));

    try {
      const [listings, shopRows] = await Promise.all([fetchListings(wallet), fetchShops()]);
      if (!mounted.current) return;
      setShops(shopRows);
      setRows(
        listings.map((listing: any): RewardRow => ({
          key: listing.publicKey.toBase58(),
          pubkey: listing.publicKey,
          merchant: listing.account.merchant.toBase58(),
          title: String(listing.account.title ?? ""),
          price: num(listing.account.pricePoints),
          stock: num(listing.account.stock),
        }))
      );
    } catch (err) {
      if (!mounted.current) return;
      setRows([]);
      setError(String(err));
      return;
    }

    // Coupons need a DAS-capable RPC; missing indexing is a degraded state,
    // not a failure of the whole screen.
    try {
      const config = await fetchConfig(wallet);
      const tree: PublicKey = config.couponTree;
      const found = await fetchCoupons(wallet.publicKey.toBase58(), tree.toBase58());
      if (!mounted.current) return;
      setCouponTree(tree);
      setCoupons(found);
      setDasAvailable(true);
    } catch {
      if (mounted.current) setDasAvailable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Poll DAS until the new coupon shows up, or give up after ~20s. */
  const waitForCoupon = useCallback(async (tree: PublicKey, knownIds: Set<string>) => {
    const owner = getWallet().publicKey.toBase58();
    const deadline = Date.now() + INDEX_POLL_MS;
    while (Date.now() < deadline) {
      try {
        const found = await fetchCoupons(owner, tree.toBase58());
        if (!mounted.current) return;
        setCoupons(found);
        setDasAvailable(true);
        if (found.some((coupon) => !knownIds.has(coupon.id))) {
          setPending([]);
          return;
        }
      } catch {
        /* indexer still catching up — keep trying until the deadline */
      }
      await new Promise((resolve) => setTimeout(resolve, INDEX_POLL_STEP_MS));
      if (!mounted.current) return;
    }
    if (!mounted.current) return;
    setPending([]);
    setIndexLag(true);
  }, []);

  const buy = async (row: RewardRow) => {
    setBuying(row.key);
    setError(null);
    setIndexLag(false);
    try {
      const wallet = getWallet();
      const config = await fetchConfig(wallet);
      const tree: PublicKey = config.couponTree;
      const signature = await buyReward(wallet, row.pubkey, tree);
      recordTx(`Bought "${row.title}"`, signature);
      setToast({ message: `Coupon minted: ${row.title}`, signature });
      setCouponTree(tree);
      setPending((current) => [...current, row.title]);
      invalidateQueries();
      const knownIds = new Set(coupons.map((coupon) => coupon.id));
      await refresh();
      // The shelf is usable again while the indexer catches up in the
      // background — only the placeholder row is still waiting.
      setBuying(null);
      await waitForCoupon(tree, knownIds);
    } catch (err) {
      if (mounted.current) {
        setError(String(err));
        setPending([]);
      }
    } finally {
      if (mounted.current) setBuying(null);
    }
  };

  const showCoupon = async (coupon: CouponAsset) => {
    // The QR the merchant scans at the till: a partially-signed
    // burn-to-redeem transaction (customer's signature already on it).
    // Three round trips live behind this tap, hence the per-coupon busy state.
    setPreparing(coupon.id);
    setError(null);
    try {
      const { buildRedeemTxBase64 } = await import("@/lib/redeem");
      const txBase64 = await buildRedeemTxBase64(getWallet(), coupon);
      const payload = JSON.stringify({ kind: "loyal.fun/redeem-tx", tx: txBase64 });
      const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 480 });
      if (!mounted.current) return;
      setCouponQr({ name: coupon.name, dataUrl });
    } catch (err) {
      if (mounted.current) setError(String(err));
    } finally {
      if (mounted.current) setPreparing(null);
    }
  };

  const groups: ShopGroup[] = groupByShop(rows ?? [], shops);
  const affordableCount = (rows ?? []).filter(
    (row) => row.stock > 0 && balance >= BigInt(row.price)
  ).length;

  return (
    <Screen
      title="Reward market"
      subtitle={
        rows && rows.length > 0
          ? `${fmt(affordableCount)} of ${fmt(rows.length)} rewards within reach.`
          : "Spend points on things you can hold."
      }
      right={
        <span className="pill text-accent border-edgeStrong">
          <span className="tnum font-semibold">{fmt(Number(balance))}</span> pts
        </span>
      }
    >
      {error && <ErrorNote error={error} onRetry={() => void refresh()} />}

      {rows === null && !error && <CardSkeleton rows={3} />}

      {rows !== null && rows.length === 0 && !error && (
        <EmptyState
          icon={<IconGift size={30} />}
          title="No rewards listed yet"
          body="Shops publish their rewards on-chain. As soon as one does, it shows up here."
        />
      )}

      {groups.map((group) => (
        <section key={group.merchant} className="space-y-2">
          <SectionTitle
            action={
              group.shop?.category ? (
                <span className="text-2xs text-faint shrink-0">{group.shop.category}</span>
              ) : undefined
            }
          >
            <Link
              href={`/shops/${group.merchant}`}
              className="inline-flex items-center gap-1.5 py-2 hover:text-accent"
            >
              {group.shop?.name ?? "Unlisted shop"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m9.5 5.5 6.5 6.5-6.5 6.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-faint"
                />
              </svg>
            </Link>
          </SectionTitle>
          <div className="space-y-2">
            {group.rows.map((row) => (
              <RewardCard
                key={row.key}
                row={row}
                balance={balance}
                busy={buying === row.key}
                disabled={buying !== null}
                onBuy={() => void buy(row)}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <SectionTitle>My coupons</SectionTitle>

        {!dasAvailable && (
          <p className="text-2xs text-faint leading-relaxed">
            Coupon inventory needs a DAS-capable RPC (e.g. free Helius devnet) in
            NEXT_PUBLIC_RPC_URL. Purchases still work — the coupon lands in your wallet
            either way.
          </p>
        )}

        {pending.map((title, index) => (
          <div key={`${title}-${index}`} className="card flex items-center gap-3">
            <span className="text-faint shrink-0">
              <IconTicket size={26} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold truncate">{title}</span>
              <span className="block text-2xs text-faint">
                Minting — appears in a few seconds
              </span>
            </span>
            <Skeleton className="h-4 w-10 shrink-0" />
          </div>
        ))}

        {indexLag && (
          <p className="text-2xs text-faint leading-relaxed">
            The coupon is minted on-chain but the indexer hasn&apos;t caught up yet.
            <button onClick={() => void refresh()} className="text-accent underline underline-offset-2 ml-1">
              Refresh
            </button>
          </p>
        )}

        {dasAvailable && coupons.length === 0 && pending.length === 0 && (
          <EmptyState
            icon={<IconTicket size={28} />}
            title="No coupons yet"
            body="Buy a reward and its coupon lands here as a compressed NFT you present at the till."
          />
        )}

        {coupons.map((coupon) => (
          <button
            key={coupon.id}
            onClick={() => void showCoupon(coupon)}
            disabled={preparing !== null}
            className="card w-full flex items-center gap-3 text-left hover:border-accent/60 disabled:opacity-60"
          >
            <span className="text-champagne shrink-0">
              <IconTicket size={26} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold truncate">{coupon.name}</span>
              <span className="block text-2xs text-faint">
                {preparing === coupon.id ? "Building redemption code…" : "Tap to present at the till"}
              </span>
            </span>
            {preparing === coupon.id && (
              <span className="shrink-0">
                <Spinner />
              </span>
            )}
          </button>
        ))}
      </section>

      {couponQr && (
        <CouponQrModal
          name={couponQr.name}
          dataUrl={couponQr.dataUrl}
          onClose={() => setCouponQr(null)}
        />
      )}

      {toast && (
        <TxToast
          message={toast.message}
          signature={toast.signature}
          onClose={() => setToast(null)}
        />
      )}
    </Screen>
  );
}

/* --------------------------------------------------------------- reward row */

function RewardCard({
  row,
  balance,
  busy,
  disabled,
  onBuy,
}: {
  row: RewardRow;
  balance: bigint;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
}) {
  const soldOut = row.stock === 0;
  const price = BigInt(row.price);
  const affordable = balance >= price;
  const short = affordable ? 0 : Number(price - balance);

  return (
    <div className={`card flex items-center gap-3 ${soldOut ? "opacity-50" : ""}`}>
      <span className={`shrink-0 ${soldOut ? "text-faint" : "text-accent"}`}>
        <IconGift size={26} />
      </span>
      <div className="flex-1 min-w-0">
        {/* Titles run to 48 chars on-chain — one line, clipped, never wrapping
            the price button off the row. */}
        <p className="font-semibold truncate">{row.title}</p>
        <p className="text-2xs text-faint truncate">
          {soldOut ? (
            "Sold out"
          ) : (
            <>
              <span className="tnum">{fmt(row.stock)}</span> left
              {!affordable && (
                <>
                  {" · "}
                  <span className="tnum">{fmt(short)}</span> pts short
                </>
              )}
            </>
          )}
        </p>
      </div>
      <button
        onClick={onBuy}
        disabled={disabled || soldOut || !affordable}
        className={`shrink-0 !py-2 ${affordable && !soldOut ? "btn-primary" : "btn-ghost"}`}
      >
        {busy ? (
          "Buying…"
        ) : soldOut ? (
          "Sold out"
        ) : (
          <span className="tnum">{fmt(row.price)} pts</span>
        )}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- qr modal */

/**
 * Full-screen coupon QR. The customer holds this up to the shop scanner, so
 * a tap on the code itself must never dismiss it — only the backdrop and the
 * explicit close button do.
 */
function CouponQrModal({
  name,
  dataUrl,
  onClose,
}: {
  name: string;
  dataUrl: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 overflow-y-auto animate-fade"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Coupon ${name}`}
          onClick={(event) => event.stopPropagation()}
          className="card-raised w-full max-w-sm text-center space-y-3 animate-pop"
        >
          <div className="flex items-start gap-2">
            <p className="flex-1 min-w-0 font-semibold truncate text-left">{name}</p>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 -mt-1 -mr-1 p-2 text-faint hover:text-ink"
            >
              <IconClose size={20} />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt={`Redemption code for ${name}`}
            className="rounded-lg w-full max-w-[320px] mx-auto"
          />
          <p className="text-2xs text-faint leading-relaxed">
            Turn your screen brightness up so the scanner can read it.
          </p>
          <p className="text-xs text-muted leading-relaxed">
            The shop scans this and the coupon burns on-chain. One use. Ever.
          </p>
          <button onClick={onClose} className="btn-ghost w-full !py-2.5 text-sm">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- grouping */

/** Listings carry only a merchant PDA; the shop directory supplies the name. */
function groupByShop(rows: RewardRow[], shops: ShopRow[]): ShopGroup[] {
  const byAddress = new Map(shops.map((shop) => [shop.address, shop]));
  const groups = new Map<string, ShopGroup>();
  for (const row of rows) {
    let group = groups.get(row.merchant);
    if (!group) {
      group = { merchant: row.merchant, shop: byAddress.get(row.merchant) ?? null, rows: [] };
      groups.set(row.merchant, group);
    }
    group.rows.push(row);
  }
  for (const group of groups.values()) {
    // In-stock first, then cheapest — the buyable things stay at the top.
    group.rows.sort(
      (a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.price - b.price
    );
  }
  // Named shops first (directory order), unlisted merchants last.
  return [...groups.values()].sort((a, b) => {
    if (!a.shop !== !b.shop) return a.shop ? -1 : 1;
    return (b.shop?.totalIssued ?? 0) - (a.shop?.totalIssued ?? 0);
  });
}
