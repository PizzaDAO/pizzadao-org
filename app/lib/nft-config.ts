// PizzaDAO NFT Collection Configuration
// Contract addresses come from the NFT contracts Google Sheet, or the NftCollection table once
// `sheets.source.nftCollections` is "db" (plans/sheets-cutover.md).

import { fetchGviz } from "@/app/lib/sheets/gviz";
import { SHEET_IDS } from "@/app/lib/sheets/config";
import { findColumnIndex } from "@/app/lib/sheet-utils";
import type { GvizResponse } from "@/app/lib/gviz-parser";
import type { NFTContract } from "./nft-types";

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

/** A valid contract address: 0x + 40 characters (as the sheet path has always checked). */
export function isContractAddress(address: string): boolean {
  return address.startsWith("0x") && address.length === 42;
}

/**
 * Parse the NFT contracts sheet (GViz, headers=1). Pure; shared by the read path and the importer.
 * `badRows` are 1-based data rows that had something in them but no valid chain + address.
 */
export function parseNFTContracts(gviz: GvizResponse): { contracts: NFTContract[]; badRows: number[]; found: boolean } {
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
    return { contracts: [], badRows: [], found: false };
  }

  const contracts: NFTContract[] = [];
  const badRows: number[] = [];

  rows.forEach((row, i) => {
    const cells = row?.c || [];
    const chain = String(cells[chainIdx]?.v || "").trim().toLowerCase();
    const address = String(cells[contractIdx]?.v || "").trim();
    const name = nameIdx !== -1 ? String(cells[nameIdx]?.v || "").trim() : "";
    const orderVal = orderIdx !== -1 ? cells[orderIdx]?.v : undefined;
    const order = typeof orderVal === "number" ? orderVal : parseInt(String(orderVal), 10);
    const description = detailsIdx !== -1 ? String(cells[detailsIdx]?.v || "").trim() : "";

    // Validate contract address format
    if (chain && address && isContractAddress(address)) {
      contracts.push({
        chain,
        address,
        name: name || "Unknown Collection",
        order: !isNaN(order) ? order : undefined,
        description: description || undefined,
      });
    } else if (chain || address) {
      // +2: the header row is row 1.
      badRows.push(i + 2);
    }
  });

  return { contracts, badRows, found: true };
}

/** The contracts straight from the sheet. Throws when the sheet cannot be read. */
export async function getNFTContractsFromSheet(): Promise<{ contracts: NFTContract[]; badRows: number[]; found: boolean }> {
  const gviz = await fetchGviz(
    NFT_CONTRACTS_SHEET_ID,
    { headers: 1 },
    { revalidate: NFT_CONTRACTS_REVALIDATE_SECONDS },
  );
  return parseNFTContracts(gviz);
}

/** The contracts from the database (active rows, in sheet order). */
export async function getNFTContractsFromDb(): Promise<NFTContract[]> {
  const { prisma } = await import("./db");
  const rows = await prisma.nftCollection.findMany({ where: { active: true }, orderBy: { position: "asc" } });
  return rows.map((r) => ({
    chain: r.chain,
    address: r.address,
    name: r.name,
    order: r.sortOrder ?? undefined,
    description: r.description ?? undefined,
  }));
}

/**
 * Fetch NFT contract addresses. Empty on any read error.
 */
export async function getNFTContracts(): Promise<NFTContract[]> {
  try {
    const { usesDb } = await import("./sheets-import/source");
    if (await usesDb("nftCollections")) return await getNFTContractsFromDb();
    return (await getNFTContractsFromSheet()).contracts;
  } catch {
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
