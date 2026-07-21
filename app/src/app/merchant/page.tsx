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
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import QRCode from "qrcode";
import nacl from "tweetnacl";
import { getMerchantWallet, getMerchantQrSigner } from "@/lib/wallet";
import { getProgram } from "@/lib/program";
import { connection, sendSponsored } from "@/lib/relayer";
import { configPda } from "@/lib/pdas";
import { CORE_PROGRAM_ID, explorerTx } from "@/lib/config";
import TxToast from "@/components/TxToast";

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

export default function MerchantPage() {
  const [tab, setTab] = useState<Tab>("sale");
  const [merchantState, setMerchantState] = useState<any | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; signature?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const refresh = useCallback(async () => {
    const wallet = getMerchantWallet();
    const program = await getProgram(wallet);
    const merchant = merchantPda(wallet.publicKey);
    try {
      const state = await (program.account as any).merchant.fetch(merchant);
      setMerchantState(state);
      const all = await (program.account as any).rewardListing.all([
        { memcmp: { offset: 8, bytes: merchant.toBase58() } },
      ]);
      setListings(all);
    } catch {
      setMerchantState(null);
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
      setToast({ message: "Shop registered on-chain 🏪", signature });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  /** €1 = 10 points, signed locally by the tablet's QR key. */
  const newSale = async () => {
    setError(null);
    const wallet = getMerchantWallet();
    const merchant = merchantPda(wallet.publicKey);
    const points = amount * 10;
    const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);

    const msg = Buffer.alloc(56);
    merchant.toBuffer().copy(msg, 0);
    msg.writeBigUInt64LE(BigInt(points), 32);
    msg.writeBigUInt64LE(nonce, 40);
    msg.writeBigInt64LE(expiry, 48);
    const signature = nacl.sign.detached(msg, getMerchantQrSigner().secretKey);

    const payload = JSON.stringify({
      merchant: merchant.toBase58(),
      qrSigner: getMerchantQrSigner().publicKey.toBase58(),
      points,
      nonce: nonce.toString(),
      expiry: expiry.toString(),
      signature: Buffer.from(signature).toString("base64"),
      expiresInSecs: 60,
    });
    setSaleQr(await QRCode.toDataURL(payload, { margin: 1, width: 480 }));
    setCountdown(60);
  };

  const createListing = async () => {
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
          newTitle || "1 Free Coffee",
          new anchor.BN(newPrice),
          newStock,
          "https://loyal.fun/rewards/generic.json"
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
      setToast({ message: `Listed "${newTitle}" 🎁`, signature });
      setNewTitle("");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const startRedeemScanner = async () => {
    setError(null);
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode("redeem-region");
    scannerRef.current = scanner;
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 240 },
      async (text: string) => {
        await scanner.stop().catch(() => undefined);
        try {
          const parsed = JSON.parse(text);
          if (parsed.kind !== "loyal.fun/redeem-tx") throw new Error("not a coupon QR");
          const tx = Transaction.from(Buffer.from(parsed.tx, "base64"));
          // Co-sign as merchant authority, then let the relayer pay the fee.
          tx.partialSign(getMerchantWallet());
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:8787"}/sponsor`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                transaction: tx
                  .serialize({ requireAllSignatures: false })
                  .toString("base64"),
              }),
            }
          );
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "sponsor failed");
          setToast({ message: "Coupon burned — enjoy! ☕", signature: body.signature });
          await refresh();
        } catch (err) {
          setError(String(err));
        }
      },
      () => undefined
    );
  };

  useEffect(() => () => scannerRef.current?.stop().catch(() => undefined), []);

  if (merchantState === undefined) {
    return <p className="text-zinc-500 text-sm pt-10 text-center">loading…</p>;
  }

  if (merchantState === null) {
    return (
      <div className="space-y-4 pt-6">
        <h1 className="text-2xl font-bold">
          loyal<span className="text-loyal">.fun</span> for shops
        </h1>
        <p className="text-sm text-zinc-400">
          Register once. Your tablet becomes the loyalty terminal: signed QRs
          per sale, zero extra hardware, points customers actually care about.
        </p>
        <input
          className="input"
          placeholder="Shop name (e.g. Kadıköy Coffee Lab)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
        />
        <button onClick={register} disabled={busy} className="btn-loyal w-full">
          {busy ? "registering…" : "Register shop on Solana"}
        </button>
        {error && <div className="card border-dump/40 text-sm text-dump break-all">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">🏪 {merchantState.name}</h1>
        <span className="text-xs text-zinc-500">
          issued: {merchantState.totalIssued.toString()} pts
        </span>
      </header>

      <div className="flex gap-2">
        {(
          [
            ["sale", "💶 New Sale"],
            ["rewards", "🎁 Rewards"],
            ["redeem", "🎟️ Redeem"],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 btn !py-2 text-sm ${
              tab === key ? "bg-loyal text-black" : "border border-edge text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sale" && (
        <div className="card space-y-4">
          <div>
            <div className="flex justify-between text-sm text-zinc-400 mb-1">
              <span>sale amount</span>
              <span>
                <b className="text-loyal">{amount}€</b> → {amount * 10} pts
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full accent-lime-400"
            />
          </div>
          <button onClick={newSale} className="btn-loyal w-full">
            Generate sale QR
          </button>
          {saleQr && (
            <div className="text-center space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={saleQr} alt="sale QR" className="rounded-xl mx-auto w-64 h-64" />
              <p className="text-sm text-zinc-400">
                customer scans within <b className="text-loyal">{countdown}s</b>
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
              maxLength={48}
            />
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-zinc-500">
                price (pts)
                <input
                  type="number"
                  className="input mt-1"
                  value={newPrice}
                  onChange={(e) => setNewPrice(Number(e.target.value))}
                />
              </label>
              <label className="flex-1 text-xs text-zinc-500">
                stock
                <input
                  type="number"
                  className="input mt-1"
                  value={newStock}
                  onChange={(e) => setNewStock(Number(e.target.value))}
                />
              </label>
            </div>
            <button onClick={createListing} disabled={busy} className="btn-loyal w-full">
              {busy ? "…" : "Create listing"}
            </button>
          </div>
          {listings.map((listing) => (
            <div key={listing.publicKey.toBase58()} className="card flex justify-between text-sm">
              <span>{listing.account.title}</span>
              <span className="text-zinc-500">
                {listing.account.pricePoints.toString()} pts · {listing.account.stock} left
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "redeem" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Scan the coupon QR on the customer&apos;s phone. You co-sign the burn:
            the coupon can never be used twice.
          </p>
          <div id="redeem-region" className="rounded-2xl overflow-hidden border border-edge min-h-[100px]" />
          <button onClick={startRedeemScanner} className="btn-loyal w-full">
            📷 Scan coupon
          </button>
          <p className="text-xs text-zinc-600">
            redeemed so far: {merchantState.couponsRedeemed.toString()}
          </p>
        </div>
      )}

      {error && <div className="card border-dump/40 text-sm text-dump break-all">{error}</div>}
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
