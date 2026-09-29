// PizzaDAO NFT Collection Configuration
// Contract addresses are loaded from Google Sheets for easy management

import { fetchGviz } from "@/app/lib/sheets/gviz";
import { SHEET_IDS } from "@/app/lib/sheets/config";
import { findColumnIndex } from "@/app/lib/sheet-utils";
import { NFTContract } from "./nft-types";

const NFT_CONTRACTS_SHEET_ID = SHEET_IDS.nftContracts;

// Alchemy API endpoints by chain
export const ALCHEMY_CHAIN_URLS: Record<string, string> = {
  ethereum: "https://eth-mainnet.g.alchemy.com/nft/v3",
  base: "https://base-mainnet.g.alchemy.com/nft/v3",
  polygon: "https://polygon-mainnet.g.alchemy.com/nft/v3",
  zora: "https://zora-mainnet.g.alchemy.com/nft/v3",
  optimism: "https://opt-mainnet.g.alchemy.com/nft/v3",
};

/** Read-only config sheet: served from Next's data cache for 5 minutes. */
const NFT_CONTRACTS_REVALIDATE_SECONDS = 300;

/**
 * Fetch NFT contract addresses from the Google Sheet
 */
export async function getNFTContracts(): Promise<NFTContract[]> {
  try {
    const gviz = await fetchGviz(
      NFT_CONTRACTS_SHEET_ID,
      { headers: 1 },
      { revalidate: NFT_CONTRACTS_REVALIDATE_SECONDS },
    );
    const cols = gviz?.table?.cols || [];
    const rows = gviz?.table?.rows || [];

    // Find column indices
    const headers = cols.map((c: { label?: string }) => String(c?.label || "").trim());
    const chainIdx = findColumnIndex(headers, ["chain"], -1) ?? -1;
    const contractIdx = findColumnIndex(headers, ["contract"], -1) ?? -1;
    const nameIdx = findColumnIndex(headers, ["name"], -1) ?? -1;
    const orderIdx = findColumnIndex(headers, ["order"], -1) ?? -1;
    const detailsIdx = findColumnIndex(headers, ["details"], -1) ?? -1;

    if (chainIdx === -1 || contractIdx === -1) {
      return [];
    }

    const contracts: NFTContract[] = [];

    for (const row of rows) {
      const cells = row?.c || [];
      const chain = String(cells[chainIdx]?.v || "").trim().toLowerCase();
      const address = String(cells[contractIdx]?.v || "").trim();
      const name = nameIdx !== -1 ? String(cells[nameIdx]?.v || "").trim() : "";
      const orderVal = orderIdx !== -1 ? cells[orderIdx]?.v : undefined;
      const order = typeof orderVal === "number" ? orderVal : parseInt(String(orderVal), 10);
      const description = detailsIdx !== -1 ? String(cells[detailsIdx]?.v || "").trim() : "";

      // Validate contract address format
      if (chain && address && address.startsWith("0x") && address.length === 42) {
        contracts.push({
          chain,
          address,
          name: name || "Unknown Collection",
          order: !isNaN(order) ? order : undefined,
          description: description || undefined,
        });
      }
    }

    return contracts;
  } catch (error) {
    return [];
  }
}

/**
 * Group contracts by chain for efficient fetching
 */
export async function getContractsByChain(): Promise<Record<string, NFTContract[]>> {
  const contracts = await getNFTContracts();
  const byChain: Record<string, NFTContract[]> = {};

  for (const contract of contracts) {
    if (!byChain[contract.chain]) {
      byChain[contract.chain] = [];
    }
    byChain[contract.chain].push(contract);
  }

  return byChain;
}
