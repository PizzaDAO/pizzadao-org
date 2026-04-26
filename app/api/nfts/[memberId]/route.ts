import { NextRequest, NextResponse } from "next/server";
import { fetchPizzaDAONFTs } from "@/app/lib/nft";
import { NFTDisplayItem, NFTGroupInfo } from "@/app/lib/nft-types";
import { getEvmWalletsForMember, getWalletForMember } from "@/app/lib/wallet-lookup";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params;

    if (!memberId) {
      return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
    }

    // Get ALL EVM wallets for this member
    let walletAddresses = await getEvmWalletsForMember(memberId);

    // If no wallets in DB, try sheet fallback for backward compat
    if (walletAddresses.length === 0) {
      const sheetWallet = await getWalletForMember(memberId);
      if (sheetWallet) {
        walletAddresses = [sheetWallet];
      }
    }

    if (walletAddresses.length === 0) {
      return NextResponse.json({
        nfts: [],
        totalCount: 0,
        walletAddress: null,
        noWallet: true,
        message: "No wallet address found for this member",
      });
    }

    // Fetch NFTs from all EVM wallets in parallel
    const results = await Promise.all(
      walletAddresses.map((addr) => fetchPizzaDAONFTs(addr))
    );

    // Merge and deduplicate by chain:contract:tokenId
    const seen = new Set<string>();
    const allNfts: NFTDisplayItem[] = [];

    for (const result of results) {
      for (const nft of result.nfts) {
        const key = `${nft.chain}:${nft.contractAddress}:${nft.tokenId}`;
        if (!seen.has(key)) {
          seen.add(key);
          allNfts.push(nft);
        }
      }
    }

    const totalCount = allNfts.length;
    // Use primary wallet for OpenSea link
    const primaryWallet = walletAddresses[0];

    // Optional limit param — when set, return at most `limit` NFTs per
    // collection group but still include full group metadata with counts.
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 0;

    if (limit > 0 && allNfts.length > 0) {
      // Group NFTs by chain:contract
      const groupMap = new Map<string, NFTDisplayItem[]>();
      for (const nft of allNfts) {
        const key = `${nft.chain}:${nft.contractAddress}`;
        const list = groupMap.get(key) || [];
        list.push(nft);
        groupMap.set(key, list);
      }

      const limitedNfts: NFTDisplayItem[] = [];
      const groups: NFTGroupInfo[] = [];

      for (const [, nfts] of groupMap) {
        const first = nfts[0];
        groups.push({
          contractName: first.contractName,
          chain: first.chain,
          contract: first.contractAddress,
          totalInGroup: nfts.length,
          order: first.order,
        });
        limitedNfts.push(...nfts.slice(0, limit));
      }

      // Sort groups by order
      groups.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return 0;
      });

      return NextResponse.json({
        nfts: limitedNfts,
        totalCount,
        walletAddress: primaryWallet,
        noWallet: false,
        groups,
      });
    }

    return NextResponse.json({
      nfts: allNfts,
      totalCount,
      walletAddress: primaryWallet,
      noWallet: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch NFTs",
        nfts: [],
        totalCount: 0,
        walletAddress: null,
      },
      { status: 500 }
    );
  }
}
