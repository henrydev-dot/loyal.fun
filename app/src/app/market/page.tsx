"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { getWallet } from "@/lib/wallet";
import { buyReward, fetchConfig, fetchListings, loyalBalance } from "@/lib/actions";
import { fetchCoupons, CouponAsset } from "@/lib/das";
import { recordTx } from "@/lib/history";
import TxToast from "@/components/TxToast";
import { IconAlert, IconGift, IconTicket } from "@/components/icons";

export default function MarketPage() {
  const [listings, setListings] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<CouponAsset[]>([]);
  const [couponQr, setCouponQr] = useState<{ name: string; dataUrl: string } | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; signature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dasAvailable, setDasAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const wallet = getWallet();
    setBalance(await loyalBalance(wallet.publicKey).catch(() => 0n));
    try {
      setListings(await fetchListings(wallet));
    } catch (err) {
      // Programs not deployed / IDL missing — an empty market, not a crash.
      console.warn("listings unavailable:", err);
    }
    try {
      const config = await fetchConfig(wallet);
      setCoupons(
        await fetchCoupons(wallet.publicKey.toBase58(), config.couponTree.toBase58())
      );
      setDasAvailable(true);
    } catch {
      setDasAvailable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buy = async (listing: any) => {
    setBusy(listing.publicKey.toBase58());
    setError(null);
    try {
      const wallet = getWallet();
      const config = await fetchConfig(wallet);
      const signature = await buyReward(wallet, listing.publicKey, config.couponTree);
      recordTx(`Bought "${listing.account.title}"`, signature);
      setToast({ message: `Coupon minted: ${listing.account.title}`, signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const showCoupon = async (coupon: CouponAsset) => {
    // The QR the merchant scans at the till: a partially-signed
    // burn-to-redeem transaction (customer's signature already on it).
    // The merchant panel co-signs as authority and submits via the relayer.
    setError(null);
    try {
      const { buildRedeemTxBase64 } = await import("@/lib/redeem");
      const txBase64 = await buildRedeemTxBase64(getWallet(), coupon);
      const payload = JSON.stringify({ kind: "loyal.fun/redeem-tx", tx: txBase64 });
      setCouponQr({
        name: coupon.name,
        dataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 480 }),
      });
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reward market</h1>
        <span className="text-sm text-muted">
          Balance <b className="text-accent">{balance.toLocaleString()}</b> pts
        </span>
      </header>

      <section className="space-y-3">
        {listings.length === 0 && (
          <p className="text-sm text-faint">No listings yet — check back soon.</p>
        )}
        {listings.map((listing) => {
          const key = listing.publicKey.toBase58();
          const affordable = balance >= BigInt(listing.account.pricePoints.toString());
          return (
            <div key={key} className="card flex items-center gap-3">
              <span className="text-accent shrink-0">
                <IconGift size={26} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{listing.account.title}</p>
                <p className="text-xs text-faint">
                  {listing.account.stock} left · compressed-NFT coupon
                </p>
              </div>
              <button
                onClick={() => buy(listing)}
                disabled={busy !== null || !affordable || listing.account.stock === 0}
                className="btn-primary shrink-0 !py-2 tabular-nums"
              >
                {busy === key ? "…" : `${listing.account.pricePoints.toString()} pts`}
              </button>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-muted text-lg">My coupons</h2>
        {!dasAvailable && (
          <p className="text-xs text-faint leading-relaxed">
            Coupon inventory needs a DAS-capable RPC (e.g. free Helius devnet) in
            NEXT_PUBLIC_RPC_URL. Purchases still work — the coupon lands in your
            wallet either way.
          </p>
        )}
        {dasAvailable && coupons.length === 0 && (
          <p className="text-sm text-faint">Nothing here yet. Treat yourself.</p>
        )}
        {coupons.map((coupon) => (
          <button
            key={coupon.id}
            onClick={() => showCoupon(coupon)}
            className="card w-full flex items-center gap-3 text-left hover:border-accent/60"
          >
            <span className="text-champagne shrink-0">
              <IconTicket size={26} />
            </span>
            <span className="flex-1">
              <span className="block font-semibold">{coupon.name}</span>
              <span className="block text-xs text-faint">Tap to present at the till</span>
            </span>
          </button>
        ))}
      </section>

      {couponQr && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setCouponQr(null)}
        >
          <div className="card text-center space-y-3 animate-pop">
            <p className="font-semibold">{couponQr.name}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={couponQr.dataUrl} alt="coupon QR" className="rounded-lg w-64 h-64" />
            <p className="text-xs text-faint leading-relaxed">
              The shop scans this and the coupon burns on-chain.
              <br />
              One use. Ever.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border-loss/40 text-sm text-loss break-all flex gap-2">
          <span className="shrink-0 pt-0.5">
            <IconAlert size={16} />
          </span>
          {error}
        </div>
      )}
      {toast && (
        <TxToast
          message={toast.message}
          signature={toast.signature}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
