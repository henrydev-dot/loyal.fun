/**
 * Minimal DAS (Digital Asset Standard) JSON-RPC client for reading the
 * user's coupon cNFTs and their merkle proofs. Requires a DAS-capable RPC
 * (e.g. free Helius devnet) in NEXT_PUBLIC_RPC_URL; plain public devnet RPC
 * does not index compressed assets — the UI degrades gracefully.
 */
import { RPC_URL } from "./config";

async function dasCall<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "loyal-fun", method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`DAS ${method}: ${body.error.message}`);
  return body.result as T;
}

export interface CouponAsset {
  id: string;
  name: string;
  uri: string;
  burnt: boolean;
  compression: {
    tree: string;
    leaf_id: number;
    data_hash: string;
    creator_hash: string;
  };
}

export async function fetchCoupons(
  owner: string,
  couponTree: string
): Promise<CouponAsset[]> {
  const result = await dasCall<{ items: any[] }>("getAssetsByOwner", {
    ownerAddress: owner,
    page: 1,
    limit: 50,
  });
  return (result.items ?? [])
    .filter(
      (item) =>
        item.compression?.compressed && item.compression?.tree === couponTree && !item.burnt
    )
    .map((item) => ({
      id: item.id,
      name: item.content?.metadata?.name ?? "Coupon",
      uri: item.content?.json_uri ?? "",
      burnt: item.burnt,
      compression: item.compression,
    }));
}

export interface AssetProof {
  root: string;
  proof: string[];
  node_index: number;
  leaf: string;
  tree_id: string;
}

export function getAssetProof(assetId: string): Promise<AssetProof> {
  return dasCall<AssetProof>("getAssetProof", { id: assetId });
}
