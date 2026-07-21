/**
 * Deterministic unit tests for the settlement math, mirroring
 * programs/loyal_core/src/math.rs exactly (integer fixed-point, no floats).
 *
 * These run with `npm run test:unit` — no validator required. The same
 * vectors are asserted on-chain by the Rust unit tests in math.rs, so any
 * client/program drift shows up as a failing pair.
 */
import { expect } from "chai";

const PRICE_SCALE = 1_000_000n;
const MAX_MULTIPLIER_1E6 = 5_000_000n;
const LIQUIDATION_MULTIPLIER_1E6 = 200_000n;
const BPS_DENOMINATOR = 10_000n;

/** clamp(1 + L * (exit-entry)/entry, 0, 5) in 1e6 fixed point. */
export function settlementMultiplier1e6(
  entry: bigint,
  exit: bigint,
  leverage: bigint
): bigint {
  if (entry <= 0n || exit <= 0n) throw new Error("InvalidPrice");
  const delta1e6 = ((exit - entry) * PRICE_SCALE) / entry;
  const raw = PRICE_SCALE + leverage * delta1e6;
  if (raw < 0n) return 0n;
  if (raw > MAX_MULTIPLIER_1E6) return MAX_MULTIPLIER_1E6;
  return raw;
}

export function grossPayout(
  stake: bigint,
  entry: bigint,
  exit: bigint,
  leverage: bigint
): bigint {
  return (stake * settlementMultiplier1e6(entry, exit, leverage)) / PRICE_SCALE;
}

export function settlementFee(payout: bigint, feeBps: bigint): bigint {
  return (payout * feeBps) / BPS_DENOMINATOR;
}

export function isLiquidatable(
  entry: bigint,
  current: bigint,
  leverage: bigint
): boolean {
  return settlementMultiplier1e6(entry, current, leverage) <= LIQUIDATION_MULTIPLIER_1E6;
}

const P = 1_000_000n; // 1.0

describe("settlement math (mirrors math.rs)", () => {
  it("returns the stake on a flat price", () => {
    expect(grossPayout(1_000n, P, P, 5n)).to.equal(1_000n);
  });

  it("pays 1.5x on +10% at 5x leverage", () => {
    expect(grossPayout(1_000n, P, 1_100_000n, 5n)).to.equal(1_500n);
  });

  it("pays 0.8x on -10% at 2x leverage", () => {
    expect(grossPayout(1_000n, P, 900_000n, 2n)).to.equal(800n);
  });

  it("clamps the win at 5x (a +200% move at 5x is 11x raw)", () => {
    expect(grossPayout(1_000n, P, 3_000_000n, 5n)).to.equal(5_000n);
  });

  it("clamps the loss at 0 (never negative)", () => {
    expect(grossPayout(1_000n, P, 500_000n, 5n)).to.equal(0n);
  });

  it("burns a 2% settlement fee", () => {
    expect(settlementFee(1_500n, 200n)).to.equal(30n);
  });

  it("rounds the fee down (dust favors the user)", () => {
    expect(settlementFee(99n, 200n)).to.equal(1n);
  });

  it("liquidates a 5x position at -16% but not at -15%", () => {
    expect(isLiquidatable(P, 850_000n, 5n)).to.equal(false);
    expect(isLiquidatable(P, 840_000n, 5n)).to.equal(true);
  });

  it("liquidates a 1x position only at -80%", () => {
    expect(isLiquidatable(P, 210_000n, 1n)).to.equal(false);
    expect(isLiquidatable(P, 200_000n, 1n)).to.equal(true);
  });

  it("keeps loss+win symmetric around the entry (1x, small moves)", () => {
    for (const bump of [1_000n, 10_000n, 250_000n]) {
      const win = grossPayout(10_000n, P, P + bump, 1n) - 10_000n;
      const loss = 10_000n - grossPayout(10_000n, P, P - bump, 1n);
      expect(win).to.equal(loss);
    }
  });

  it("survives extreme prices without overflow (bigint sanity)", () => {
    const huge = 100_000_000_000n; // $100k in 1e6
    expect(grossPayout(2n ** 60n, P, huge, 5n)).to.equal(2n ** 60n * 5n);
  });
});
