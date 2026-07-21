import { PublicKey } from "@solana/web3.js";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const RELAYER_URL =
  process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:8787";
export const CORE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CORE_PROGRAM_ID ??
    "CF5FkJ9GKoFk3SMkBZuXgGnXwfN6TETs5eAYS7V6gggr"
);
export const MERCHANT_API_KEY =
  process.env.NEXT_PUBLIC_MERCHANT_API_KEY ?? "demo-kadikoy-coffee-lab";

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export const explorerTx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (addr: string) =>
  `https://explorer.solana.com/address/${addr}?cluster=devnet`;

/** Vaults shown in the Degen tab; feed ids match scripts/create_vaults.ts. */
export const VAULTS: Array<{
  symbol: string;
  label: string;
  emoji: string;
  feedId: string;
}> = [
  {
    symbol: "SOL",
    label: "Solana",
    emoji: "◎",
    feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  },
  {
    symbol: "BTC",
    label: "Bitcoin",
    emoji: "₿",
    feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  },
  {
    symbol: "WIF",
    label: "dogwifhat",
    emoji: "🐶",
    feedId: "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
  },
  {
    symbol: "BONK",
    label: "Bonk",
    emoji: "🔨",
    feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
  },
];
