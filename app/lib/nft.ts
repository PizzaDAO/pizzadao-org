// PizzaDAO NFT Fetching Library
// Fetches NFTs from Alchemy API for configured PizzaDAO contracts

import { getContractsByChain, ALCHEMY_CHAIN_URLS } from "./nft-config";
import { AlchemyNFT, NFTDisplayItem, NFTCollectionResponse, NFTContract } from "./nft-types";
import { cacheGetOrSet } from "../api/lib/cache";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

/**
 * Fetch NFTs from Alchemy for a specific wallet and contract (with pagination)
 */
async function fetchNFTsForContract(
  walletAddress: string,
  contract: NFTContract
): Promise<AlchemyNFT[]> {
  if (!ALCHEMY_API_KEY) {
    return [];
  }

  const baseUrl = ALCHEMY_CHAIN_URLS[contract.chain];
  if (!baseUrl) {
    return [];
  }

  const allNfts: AlchemyNFT[] = [];
  let pageKey: string | undefined;
  const maxPages = 10; // Safety limit to prevent infinite loops

  try {
    for (let page = 0; page < maxPages; page++) {
      let url = `${baseUrl}/${ALCHEMY_API_KEY}/getNFTsForOwner?owner=${walletAddress}&contractAddresses[]=${contract.address}&withMetadata=true`;
      if (pageKey) {
        url += `&pageKey=${pageKey}`;
      }

      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        break;
      }

      const data = await res.json();
      const nfts = data.ownedNfts || [];
      allNfts.push(...nfts);

      // Check if there are more pages
      if (!data.pageKey) {
        break;
      }
      pageKey = data.pageKey;
    }

    return allNfts;
  } catch (error) {
    return allNfts; // Return whatever we got so far
  }
}

/**
 * Transform Alchemy NFT to display format
 */
function transformNFT(nft: AlchemyNFT, contract: NFTContract): NFTDisplayItem {
  return {
    contractAddress: nft.contract.address,
    contractName: contract.name || nft.contract.name || "Unknown Collection",
    tokenId: nft.tokenId,
    name: nft.name || `#${nft.tokenId}`,
    imageUrl: nft.image?.cachedUrl || nft.image?.originalUrl || "",
    thumbnailUrl: nft.image?.thumbnailUrl || nft.image?.cachedUrl || "",
    chain: contract.chain,
    order: contract.order,
    metadata: nft.raw?.metadata,
  };
}

/**
 * Fetch all PizzaDAO NFTs for a wallet (multi-chain)
 */
export async function fetchPizzaDAONFTs(
  walletAddress: string
): Promise<NFTCollectionResponse> {
  if (!walletAddress || !walletAddress.startsWith("0x")) {
    return {
      nfts: [],
      totalCount: 0,
      walletAddress: null,
      error: "Invalid wallet address",
    };
  }

  const cacheKey = `nfts:${walletAddress.toLowerCase()}`;

  return cacheGetOrSet(
    cacheKey,
    async () => {
      const contractsByChain = await getContractsByChain();
      const allNFTs: NFTDisplayItem[] = [];

      // Fetch from all chains in parallel
      const chainPromises = Object.entries(contractsByChain).map(
        async ([, contracts]) => {
          // Fetch all contracts for this chain in parallel
          const contractPromises = contracts.map(async (contract) => {
            const nfts = await fetchNFTsForContract(walletAddress, contract);
            return nfts.map((nft) => transformNFT(nft, contract));
          });

          const results = await Promise.all(contractPromises);
          return results.flat();
        }
      );

      const chainResults = await Promise.all(chainPromises);
      allNFTs.push(...chainResults.flat());

      return {
        nfts: allNFTs,
        totalCount: allNFTs.length,
        walletAddress,
      };
    },
    2 * 60 * 60 // 2 hours — NFT holdings change rarely
  );
}

/** The contract's chain has no Alchemy endpoint here: skip it (it can never be checked). */
export class UnsupportedChainError extends Error {
  constructor(chain: string) {
    super(`No Alchemy endpoint for chain ${chain}`);
    this.name = "UnsupportedChainError";
  }
}

/**
 * Whether `walletAddress` holds at least one token of `contract`. Strict: it
 * throws when Alchemy can't be asked or answers badly (never returns false on
 * an error), and UnsupportedChainError for a chain without an endpoint. Asks
 * for a single token without metadata, so it stops at the first match and
 * costs one small call.
 */
export async function holdsNFTOfContract(walletAddress: string, contract: NFTContract): Promise<boolean> {
  const baseUrl = ALCHEMY_CHAIN_URLS[contract.chain];
  if (!baseUrl) throw new UnsupportedChainError(contract.chain);
  if (!ALCHEMY_API_KEY) throw new Error("ALCHEMY_API_KEY is not set");

  const url =
    `${baseUrl}/${ALCHEMY_API_KEY}/getNFTsForOwner?owner=${encodeURIComponent(walletAddress)}` +
    `&contractAddresses[]=${contract.address}&withMetadata=false&pageSize=1`;
  const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Alchemy ${res.status} for ${contract.chain}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.ownedNfts)) throw new Error("Unexpected Alchemy response");
  return data.ownedNfts.length > 0;
}
