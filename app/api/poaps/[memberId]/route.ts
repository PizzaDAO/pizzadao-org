import { NextResponse } from 'next/server';
import { fetchFilteredPOAPs } from '@/app/lib/poap';
import { POAPCollectionResponse, POAPDisplayItem } from '@/app/lib/poap-types';
import { getEvmWalletsForMember, getWalletForMember } from '@/app/lib/wallet-lookup';
import { prisma } from '@/app/lib/db';

/**
 * Fire-and-forget: persist a "first seen" timestamp for each POAP we
 * observe for this member. Idempotent via the unique (memberId, poapEventId)
 * constraint. Feeds the dashboard activity feed (poap_received kind).
 * Errors are swallowed so the GET response is never delayed or broken.
 */
function recordPoapFirstSeen(memberId: string, poaps: POAPDisplayItem[]): void {
  if (poaps.length === 0) return;
  const writes = poaps.map((p) =>
    prisma.poapFirstSeen.upsert({
      where: {
        memberId_poapEventId: { memberId, poapEventId: p.eventId },
      },
      update: {}, // first observation wins
      create: {
        memberId,
        poapEventId: p.eventId,
        poapTokenId: p.tokenId,
        title: p.title ?? null,
        imageUrl: p.imageUrl ?? null,
      },
    }),
  );
  Promise.allSettled(writes).catch(() => {});
}

/**
 * GET /api/poaps/[memberId]
 * Returns user's POAPs filtered by whitelist, from ALL EVM wallets, deduplicated
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse<POAPCollectionResponse>> {
  const { memberId } = await params;
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 0;

  if (!memberId) {
    return NextResponse.json(
      { error: 'Member ID is required' } as any,
      { status: 400 }
    );
  }

  // 1. Get ALL EVM wallets for this member
  let walletAddresses = await getEvmWalletsForMember(memberId);

  // Fallback to sheet if no wallets in DB
  if (walletAddresses.length === 0) {
    const sheetWallet = await getWalletForMember(memberId);
    if (sheetWallet) {
      walletAddresses = [sheetWallet];
    }
  }

  const cacheHeaders = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' };

  if (walletAddresses.length === 0) {
    // No wallet address - return noWallet flag
    return NextResponse.json({
      poaps: [],
      totalCount: 0,
      hiddenCount: 0,
      walletAddress: '',
      noWallet: true,
    }, { headers: cacheHeaders });
  }

  // 2. Fetch filtered POAPs from ALL wallets, deduplicate by eventId
  try {
    const results = await Promise.all(
      walletAddresses.map((addr) => fetchFilteredPOAPs(addr))
    );

    // Merge and deduplicate by eventId
    const seenEvents = new Set<string>();
    const allPoaps: POAPDisplayItem[] = [];
    let fromCacheAll = true;

    for (const result of results) {
      if (!result.fromCache) fromCacheAll = false;
      for (const poap of result.poaps) {
        if (!seenEvents.has(poap.eventId)) {
          seenEvents.add(poap.eventId);
          allPoaps.push(poap);
        }
      }
    }

    // Sort by tokenId descending (newest first)
    allPoaps.sort((a, b) => parseInt(b.tokenId) - parseInt(a.tokenId));

    // Persist first-seen timestamps so the activity feed can surface
    // poap_received events. Fire-and-forget — does not block the response.
    recordPoapFirstSeen(memberId, allPoaps);

    const totalCount = allPoaps.length;
    const primaryWallet = walletAddresses[0];

    // When limit is set, return first (limit-1) newest + 1 oldest POAP
    if (limit > 0 && allPoaps.length > limit) {
      const newest = allPoaps.slice(0, limit - 1);
      const oldest = allPoaps[allPoaps.length - 1];
      return NextResponse.json({
        poaps: [...newest, oldest],
        totalCount,
        walletAddress: primaryWallet,
        fromCache: fromCacheAll,
      }, { headers: cacheHeaders });
    }

    return NextResponse.json({
      poaps: allPoaps,
      totalCount,
      walletAddress: primaryWallet,
      fromCache: fromCacheAll,
    }, { headers: cacheHeaders });
  } catch (error) {
    console.error('Error fetching POAPs:', error);

    // Graceful degradation: return empty collection
    return NextResponse.json({
      poaps: [],
      totalCount: 0,
      walletAddress: walletAddresses[0],
      fromCache: false,
      debug: { error: String(error) },
    });
  }
}
