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
  contract: NFTContract,
  strict = false
): Promise<AlchemyNFT[]> {
  // `strict` (holdings that gate something, e.g. the Rare Pizza Box level
  // gate) throws on any lookup failure instead of returning an empty list,
  // so "could not check" is never mistaken for "owns none".
  if (!ALCHEMY_API_KEY) {
    if (strict) throw new Error("ALCHEMY_API_KEY is not set");
    return [];
  }

  const baseUrl = ALCHEMY_CHAIN_URLS[contract.chain];
  if (!baseUrl) {
    if (strict) throw new Error(`No Alchemy endpoint for chain ${contract.chain}`);
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
        if (strict) throw new Error(`Alchemy ${res.status} for ${contract.chain}`);
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
    if (strict) throw error;
    return allNfts; // Return whatever we got so far
  }
}

/**
 * Whether `walletAddress` holds at least one token of `contract`. Strict:
 * throws when Alchemy can't be reached (never returns false on an error).
 */
export async function holdsNFTOfContract(walletAddress: string, contract: NFTContract): Promise<boolean> {
  return (await fetchNFTsForContract(walletAddress, contract, true)).length > 0;
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
