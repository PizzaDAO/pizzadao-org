// PizzaDAO NFT Collection Configuration
// Contract addresses are loaded from Google Sheets for easy management

import { NFTContract } from "./nft-types";

const NFT_CONTRACTS_SHEET_ID = "1I9Sjj5kNQOushVbYGSnG668tMOAz0SJ3L8StaCG5r0I";

// Alchemy API endpoints by chain
export const ALCHEMY_CHAIN_URLS: Record<string, string> = {
  ethereum: "https://eth-mainnet.g.alchemy.com/nft/v3",
  base: "https://base-mainnet.g.alchemy.com/nft/v3",
  polygon: "https://polygon-mainnet.g.alchemy.com/nft/v3",
  zora: "https://zora-mainnet.g.alchemy.com/nft/v3",
  optimism: "https://opt-mainnet.g.alchemy.com/nft/v3",
};

// Cache for NFT contracts
let contractsCache: { contracts: NFTContract[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function parseGvizJson(text: string) {
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("GViz: Unexpected response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Fetch NFT contract addresses from the Google Sheet
 */
export async function getNFTContracts(): Promise<NFTContract[]> {
  // Check cache
  if (contractsCache && Date.now() - contractsCache.fetchedAt < CACHE_TTL) {
    return contractsCache.contracts;
  }

  try {
    const url = `https://docs.google.com/spreadsheets/d/${NFT_CONTRACTS_SHEET_ID}/gviz/tq?tqx=out:json&headers=1`;
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      console.error("[nft-config] Failed to fetch contracts sheet:", res.status);
      return contractsCache?.contracts || [];
    }

    const text = await res.text();
    const gviz = parseGvizJson(text);
    const cols = gviz?.table?.cols || [];
    const rows = gviz?.table?.rows || [];

    // Find column indices
    const headers = cols.map((c: { label?: string }) =>
      String(c?.label || "").trim().toLowerCase()
    );
    const chainIdx = headers.findIndex((h: string) => h === "chain");
    const contractIdx = headers.findIndex((h: string) => h === "contract");
    const nameIdx = headers.findIndex((h: string) => h === "name");
    const orderIdx = headers.findIndex((h: string) => h === "order");

    if (chainIdx === -1 || contractIdx === -1) {
      console.error("[nft-config] Missing required columns (chain, contract)");
      return contractsCache?.contracts || [];
    }

    const contracts: NFTContract[] = [];

    for (const row of rows) {
      const cells = row?.c || [];
      const chain = String(cells[chainIdx]?.v || "").trim().toLowerCase();
      const address = String(cells[contractIdx]?.v || "").trim();
      const name = nameIdx !== -1 ? String(cells[nameIdx]?.v || "").trim() : "";
      const orderVal = orderIdx !== -1 ? cells[orderIdx]?.v : undefined;
      const order = typeof orderVal === "number" ? orderVal : parseInt(String(orderVal), 10);

      // Validate contract address format
      if (chain && address && address.startsWith("0x") && address.length === 42) {
        contracts.push({
          chain,
          address,
          name: name || "Unknown Collection",
          order: !isNaN(order) ? order : undefined,
        });
      }
    }

    // Update cache
    contractsCache = { contracts, fetchedAt: Date.now() };
    console.log(`[nft-config] Loaded ${contracts.length} NFT contracts`);

    return contracts;
  } catch (error) {
    console.error("[nft-config] Error fetching contracts:", error);
    return contractsCache?.contracts || [];
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
