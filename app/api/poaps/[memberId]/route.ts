import { NextResponse } from 'next/server';
import { fetchFilteredPOAPs } from '@/app/lib/poap';
import { POAPCollectionResponse } from '@/app/lib/poap-types';
import { getWalletForMember } from '@/app/lib/wallet-lookup';

/**
 * GET /api/poaps/[memberId]
 * Returns user's POAPs filtered by whitelist, with oldest + 10 newest selected
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

  // 1. Get wallet address (DB first, sheet fallback + auto-cache)
  const walletAddress = await getWalletForMember(memberId);

  if (!walletAddress) {
    // No wallet address - return noWallet flag
    return NextResponse.json({
      poaps: [],
      totalCount: 0,
      hiddenCount: 0,
      walletAddress: '',
      noWallet: true,
    });
  }

  // 2. Fetch filtered POAPs (uses incremental caching)
  try {
    const { poaps, totalCount, fromCache, debug } = await fetchFilteredPOAPs(walletAddress);

    // When limit is set, return first (limit-1) newest + 1 oldest POAP
    // This matches the collapsed UI layout (13 newest + 1 oldest = limit 14)
    if (limit > 0 && poaps.length > limit) {
      const newest = poaps.slice(0, limit - 1);
      const oldest = poaps[poaps.length - 1];
      return NextResponse.json({
        poaps: [...newest, oldest],
        totalCount,
        walletAddress,
        fromCache,
        debug,
      });
    }

    return NextResponse.json({
      poaps,
      totalCount,
      walletAddress,
      fromCache,
      debug,
    });
  } catch (error) {
    console.error('Error fetching POAPs:', error);

    // Graceful degradation: return empty collection
    return NextResponse.json({
      poaps: [],
      totalCount: 0,
      walletAddress,
      fromCache: false,
      debug: { error: String(error) },
    });
  }
}
