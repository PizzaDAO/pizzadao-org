import { NextRequest, NextResponse } from "next/server";
import { fetchPizzaDAONFTs } from "@/app/lib/nft";
import { NFTDisplayItem, NFTGroupInfo } from "@/app/lib/nft-types";
import { getWalletForMember } from "@/app/lib/wallet-lookup";

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

    // Get wallet address (DB first, sheet fallback + auto-cache)
    const walletAddress = await getWalletForMember(memberId);

    if (!walletAddress) {
      return NextResponse.json({
        nfts: [],
        totalCount: 0,
        walletAddress: null,
        noWallet: true,
        message: "No wallet address found for this member",
      });
    }

    // Fetch NFTs from Alchemy
    const nftData = await fetchPizzaDAONFTs(walletAddress);

    // Optional limit param — when set, return at most `limit` NFTs per
    // collection group but still include full group metadata with counts.
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 0;

    if (limit > 0 && nftData.nfts.length > 0) {
      // Group NFTs by chain:contract
      const groupMap = new Map<string, NFTDisplayItem[]>();
      for (const nft of nftData.nfts) {
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
        totalCount: nftData.totalCount,
        walletAddress,
        noWallet: false,
        groups,
      });
    }

    // Ensure walletAddress and noWallet are always included
    return NextResponse.json({
      ...nftData,
      walletAddress,
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
