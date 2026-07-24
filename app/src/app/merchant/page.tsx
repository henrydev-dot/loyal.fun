"use client";

/**
 * Merchant dashboard — runs on the shop's tablet.
 *
 * - Register: creates the on-chain Merchant with this device's burner wallet
 *   as authority and a locally-held ed25519 key as the QR signer.
 * - New Sale: signs (merchant, points, nonce, expiry) locally and shows a
 *   60-second QR. Zero extra hardware: the tablet IS the POS add-on.
 * - Rewards: create listings customers buy with points.
 * - Redeem: scans the customer's coupon QR (a partially-signed burn tx),
 *   co-signs as merchant authority, submits via the relayer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import QRCode from "qrcode";
import { getMerchantWallet, getMerchantQrSigner } from "@/lib/wallet";
import { makeSaleQrUrl } from "@/lib/saleQr";
import { getProgram } from "@/lib/program";
import { sendSponsored } from "@/lib/relayer";
import { verifyRedeemTransaction } from "@/lib/verifyRedeem";
import { isAccountMissing } from "@/lib/actions";
import { configPda } from "@/lib/pdas";
import { CORE_PROGRAM_ID, RELAYER_URL } from "@/lib/config";
import TxToast from "@/components/TxToast";
import { CardSkeleton, ErrorNote } from "@/components/ui";
import {
  IconAlert,
  IconGift,
  IconReceipt,
  IconScan,
  IconStore,
  IconTicket,
  LogoMark,
} from "@/components/icons";

const merchantPda = (authority: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("merchant"), authority.toBuffer()],
    CORE_PROGRAM_ID
  )[0];

const listingPda = (merchant: PublicKey, listingId: bigint) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(listingId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), merchant.toBuffer(), buf],
    CORE_PROGRAM_ID
  )[0];
};

type Tab = "sale" | "rewards" | "redeem";

const TAB_META: Array<{ key: Tab; label: string; Icon: typeof IconReceipt }> = [
  { key: "sale", label: "New sale", Icon: IconReceipt },
  { key: "rewards", label: "Rewards", Icon: IconGift },
  { key: "redeem", label: "Redeem", Icon: IconTicket },
];

export default function MerchantPage() {
  const [tab, setTab] = useState<Tab>("sale");
  const [merchantState, setMerchantState] = useState<any | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; signature?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // sale state
  const [amount, setAmount] = useState(10); // €
  const [saleQr, setSaleQr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  // rewards state
  const [listings, setListings] = useState<any[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newPrice, setNewPrice] = useState(500);
  const [newStock, setNewStock] = useState(50);

  const scannerRef = useRef<any>(null);
  const scanHandled = useRef(false);
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const wallet = getMerchantWallet();
      const program = await getProgram(wallet);
      const merchant = merchantPda(wallet.publicKey);
      const state = await (program.account as any).merchant.fetch(merchant);
      setMerchantState(state);
      const all = await (program.account as any).rewardListing.all([
        { memcmp: { offset: 8, bytes: merchant.toBase58() } },
      ]);
      setListings(all);
    } catch (err) {
      if (isAccountMissing(err)) {
        setMerchantState(null); // genuinely not registered yet
      } else {
        // A network blip must not bounce a live shop back to onboarding,
        // where "Register" then fails with "already in use".
        setLoadError(String(err));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    if (countdown === 1) setSaleQr(null);
    return () => clearTimeout(timer);
  }, [countdown]);

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const wallet = getMerchantWallet();
      const program = await getProgram(wallet);
      const ix = await program.methods
        .registerMerchant(
          name || "My Shop",
          "cafe",
          getMerchantQrSigner().publicKey,
          new anchor.BN(1_000_000)
        )
        .accounts({
          authority: wallet.publicKey,
          config: configPda(),
          merchant: merchantPda(wallet.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      const signature = await sendSponsored([ix], [wallet]);
      setToast({ message: "Shop registered on-chain", signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  /** €1 = 10 points, signed locally by the tablet's QR key. The QR carries a
   * deep link so even a phone's native camera lands on the Scan page. */
  const newSale = async () => {
    setError(null);
    const url = makeSaleQrUrl(amount * 10);
    setSaleQr(
      await QRCode.toDataURL(url, { margin: 2, width: 560, errorCorrectionLevel: "L" })
    );
    setCountdown(60);
  };

  const createListing = async () => {
    const title = newTitle.trim() || "1 Free Coffee";
    if (!Number.isInteger(newPrice) || newPrice <= 0) {
      setError("Price must be a whole number above zero.");
      return;
    }
    if (!Number.isInteger(newStock) || newStock <= 0) {
      setError("Stock must be a whole number above zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wallet = getMerchantWallet();
      const program = await getProgram(wallet);
      const merchant = merchantPda(wallet.publicKey);
      const state: any = await (program.account as any).merchant.fetch(merchant);
      const listing = listingPda(merchant, BigInt(state.listingCount.toString()));
      const ix = await program.methods
        .createListing(
          title,
          new anchor.BN(newPrice),
          newStock,
          // The listing PDA rides along in the URI so redemption can resolve
          // the coupon back to this exact listing instead of matching titles.
          `https://loyal.fun/rewards/generic.json?listing=${listing.toBase58()}`
        )
        .accounts({
          authority: wallet.publicKey,
          config: configPda(),
          merchant,
          listing,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      const signature = await sendSponsored([ix], [wallet]);
      setToast({ message: `Listed "${title}"`, signature });
      setNewTitle("");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Point the on-chain merchant at this browser's QR key. */
  const rotateSigner = async () => {
    setBusy(true);
    setError(null);
    try {
      const wallet = getMerchantWallet();
      const program = await getProgram(wallet);
      const ix = await program.methods
        .updateMerchantSigner(getMerchantQrSigner().publicKey)
        .accounts({
          authority: wallet.publicKey,
          merchant: merchantPda(wallet.publicKey),
        })
        .instruction();
      const signature = await sendSponsored([ix], [wallet]);
      setToast({ message: "Sale signing restored on this device", signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const startRedeemScanner = async () => {
    if (scanning) return;
    setError(null);
    scanHandled.current = false;
    setScanning(true);
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode("redeem-region");
    scannerRef.current = scanner;
    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 12,
        qrbox: { width: 280, height: 280 },
        // @ts-expect-error html5-qrcode types omit this documented option
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      },
      async (text: string) => {
        if (scanHandled.current) return;
        scanHandled.current = true;
        await scanner.stop().catch(() => undefined);
        setScanning(false);
        try {
          const parsed = JSON.parse(text);
          if (parsed.kind !== "loyal.fun/redeem-tx") throw new Error("not a coupon QR");

          // NEVER sign an unverified transaction: this key is the shop's
          // on-chain authority, so a hostile QR could otherwise carry
          // `update_merchant_signer(attacker)` and take the shop over.
          const wallet = getMerchantWallet();
          const verified = verifyRedeemTransaction(parsed.tx, {
            merchantAuthority: wallet.publicKey,
            merchant: merchantPda(wallet.publicKey),
          });

          verified.transaction.partialSign(wallet);
          const res = await fetch(`${RELAYER_URL}/sponsor`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              transaction: verified.transaction
                .serialize({ requireAllSignatures: false })
                .toString("base64"),
            }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "sponsor failed");
          setToast({ message: "Coupon burned — redeemed", signature: body.signature });
          await refresh();
        } catch (err) {
          setError(String(err));
        }
      },
      () => undefined
    ).catch((err: unknown) => {
      // Denied permission or no rear camera: without this the button looks
      // dead and the cashier has no way back.
      setScanning(false);
      scanHandled.current = false;
      setError(
        `Camera unavailable — allow camera access in your browser settings and try again. (${String(err).slice(0, 90)})`
      );
    });
  };

  useEffect(() => () => scannerRef.current?.stop().catch(() => undefined), []);

  const signerMismatch =
    !!merchantState &&
    merchantState.qrSigner?.toBase58?.() !== getMerchantQrSigner().publicKey.toBase58();

  if (merchantState === undefined) {
    return (
      <div className="pt-10 space-y-3">
        {loadError ? (
          <ErrorNote
            error={loadError}
            onRetry={() => {
              setLoadError(null);
              void refresh();
            }}
          />
        ) : (
          <CardSkeleton rows={2} />
        )}
      </div>
    );
  }

  if (merchantState === null) {
    return (
      <div className="space-y-4 pt-6">
        <div className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <h1 className="text-2xl font-semibold">
            loyal<span className="text-accent">.fun</span>{" "}
            <span className="text-muted font-body text-base font-normal">for shops</span>
          </h1>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Register once. Your tablet becomes the loyalty terminal — a signed QR
          per sale, no extra hardware, points customers actually care about.
        </p>
        <input
          className="input"
          placeholder="Shop name (e.g. Kadıköy Coffee Lab)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
        />
        <button onClick={register} disabled={busy} className="btn-primary w-full">
          <IconStore size={18} />
          {busy ? "Registering…" : "Register shop on Solana"}
        </button>
        {error && <ErrorNote error={error} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="text-accent">
            <IconStore size={22} />
          </span>
          <h1 className="text-xl font-semibold truncate">{merchantState.name}</h1>
        </span>
        <span className="text-xs text-faint tabular-nums">
          {Number(merchantState.totalIssued.toString()).toLocaleString("en-US")} pts issued
        </span>
      </header>

      {signerMismatch && (
        <div className="card border-loss/40 space-y-2">
          <p className="text-sm text-loss font-semibold">This device can't sign sales</p>
          <p className="text-xs text-muted leading-relaxed">
            The QR key stored in this browser no longer matches the one registered
            on-chain — browser data was probably cleared. Every sale code will be
            rejected until the shop points at this device's key again.
          </p>
          <button onClick={rotateSigner} disabled={busy} className="btn-primary w-full !py-2">
            {busy ? "Rotating…" : "Use this device's key"}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {TAB_META.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 btn !py-2 text-sm whitespace-nowrap ${
              tab === key
                ? "bg-accent text-bg"
                : "border border-edge text-muted hover:text-ink"
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === "sale" && (
        <div className="card space-y-4">
          <div>
            <div className="flex justify-between text-sm text-muted mb-2">
              <span>Sale amount</span>
              <span className="tabular-nums">
                <b className="text-accent">{amount} €</b>
                <span className="text-faint"> → {amount * 10} pts</span>
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <button onClick={newSale} className="btn-primary w-full">
            <IconReceipt size={18} /> Generate sale QR
          </button>
          {saleQr && (
            <div className="text-center space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={saleQr} alt="sale QR" className="rounded-lg mx-auto w-64 h-64" />
              <p className="text-sm text-muted">
                Valid for <b className="text-accent tabular-nums">{countdown}s</b>
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "rewards" && (
        <div className="space-y-3">
          <div className="card space-y-3">
            <p className="font-semibold text-sm">New listing</p>
            <input
              className="input"
              placeholder="Title (e.g. 1 Free Coffee)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={32}
            />
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-faint">
                Price (pts)
                <input
                  type="number"
                  className="input mt-1"
                  value={newPrice}
                  onChange={(e) => setNewPrice(Number(e.target.value))}
                />
              </label>
              <label className="flex-1 text-xs text-faint">
                Stock
                <input
                  type="number"
                  className="input mt-1"
                  value={newStock}
                  onChange={(e) => setNewStock(Number(e.target.value))}
                />
              </label>
            </div>
            <button onClick={createListing} disabled={busy} className="btn-primary w-full">
              {busy ? "…" : "Create listing"}
            </button>
          </div>
          {listings.map((listing) => (
            <div
              key={listing.publicKey.toBase58()}
              className="card flex justify-between text-sm"
            >
              <span>{listing.account.title}</span>
              <span className="text-faint tabular-nums">
                {listing.account.pricePoints.toString()} pts · {listing.account.stock} left
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "redeem" && (
        <div className="space-y-3">
          <p className="text-sm text-muted leading-relaxed">
            Scan the coupon QR on the customer&apos;s phone. Your signature burns
            the coupon on-chain — it can never be used twice.
          </p>
          <div
            id="redeem-region"
            className="rounded-xl overflow-hidden border border-edge min-h-[100px]"
          />
          <button onClick={startRedeemScanner} className="btn-primary w-full">
            <IconScan size={18} /> Scan coupon
          </button>
          <p className="text-xs text-faint tabular-nums">
            Redeemed so far: {merchantState.couponsRedeemed.toString()}
          </p>
        </div>
      )}

      {error && <ErrorNote error={error} />}
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
