/**
 * Guard for the merchant-side redemption scan.
 *
 * The till scans a QR that contains a *transaction*, then co-signs it with
 * the shop's authority key. Signing whatever arrives would be a shop
 * takeover waiting to happen: a hostile QR could carry
 * `update_merchant_signer(attacker)` — which the merchant authority is
 * allowed to sign — and every future sale QR would then be forged.
 *
 * So: decode first, prove the transaction is exactly one `redeem_reward`
 * against THIS merchant, and only then hand it to the wallet.
 */
import { PublicKey, Transaction } from "@solana/web3.js";
import { CORE_PROGRAM_ID } from "./config";

/** Anchor discriminator for `redeem_reward`, from the built IDL. */
const REDEEM_DISCRIMINATOR = Buffer.from([20, 221, 205, 146, 25, 114, 178, 198]);

/** Account order declared by the instruction (IDL `redeem_reward`). */
const ACCOUNT_INDEX = {
  user: 0,
  merchantAuthority: 1,
  config: 2,
  merchant: 3,
  listing: 4,
} as const;

export interface VerifiedRedeem {
  transaction: Transaction;
  /** Coupon holder — the other required signer. */
  user: PublicKey;
  /** The listing PDA being redeemed, for display before confirming. */
  listing: PublicKey;
}

export class RedeemRejected extends Error {}

/**
 * Throws `RedeemRejected` unless `base64Tx` is a single `redeem_reward`
 * instruction whose merchant accounts are the ones we expect.
 */
export function verifyRedeemTransaction(
  base64Tx: string,
  expected: { merchantAuthority: PublicKey; merchant: PublicKey }
): VerifiedRedeem {
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(base64Tx, "base64"));
  } catch {
    throw new RedeemRejected("That code isn't a readable transaction.");
  }

  if (tx.instructions.length !== 1) {
    throw new RedeemRejected(
      `Expected a single redemption instruction, found ${tx.instructions.length}. Not signing.`
    );
  }

  const ix = tx.instructions[0];
  if (!ix.programId.equals(CORE_PROGRAM_ID)) {
    throw new RedeemRejected("That code targets a different program. Not signing.");
  }

  if (ix.data.length < 8 || !ix.data.subarray(0, 8).equals(REDEEM_DISCRIMINATOR)) {
    throw new RedeemRejected("That code is not a coupon redemption. Not signing.");
  }

  const keyAt = (index: number): PublicKey => {
    const meta = ix.keys[index];
    if (!meta) throw new RedeemRejected("Redemption instruction is missing accounts.");
    return meta.pubkey;
  };

  if (!keyAt(ACCOUNT_INDEX.merchantAuthority).equals(expected.merchantAuthority)) {
    throw new RedeemRejected("This coupon is addressed to a different shop.");
  }
  if (!keyAt(ACCOUNT_INDEX.merchant).equals(expected.merchant)) {
    throw new RedeemRejected("This coupon belongs to a different shop.");
  }

  // The holder must sign too — a coupon can't be burned by the shop alone.
  const user = keyAt(ACCOUNT_INDEX.user);
  if (!ix.keys[ACCOUNT_INDEX.user]?.isSigner) {
    throw new RedeemRejected("The coupon holder's signature is missing.");
  }

  return { transaction: tx, user, listing: keyAt(ACCOUNT_INDEX.listing) };
}
