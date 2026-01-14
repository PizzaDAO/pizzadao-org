import { NextResponse } from 'next/server';
import { fetchFilteredPOAPs } from '@/app/lib/poap';
import { POAPCollectionResponse } from '@/app/lib/poap-types';
import { parseGvizJson } from '@/app/lib/gviz-parser';
import { findColumnIndex } from '@/app/lib/sheet-utils';
import { GvizResponse, GvizCell } from '@/app/lib/types/gviz';

const SHEET_ID = '16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM';
const TAB_NAME = 'Crew';

/**
 * Get wallet address from Google Sheet for a given member ID
 */
async function getWalletForMember(memberId: string): Promise<string | null> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
      TAB_NAME
    )}&tqx=out:json&headers=0`;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;

    const text = await res.text();
    const gviz: GvizResponse = parseGvizJson(text);
    const rows = gviz?.table?.rows || [];

    // Find header row (same logic as member-repository.ts)
    let headerRowIdx = -1;
    let headerVals: string[] = [];

    for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
      const rowCells = rows[ri]?.c || [];
      const rowVals = rowCells.map((c: GvizCell) =>
        String(c?.v || c?.f || '').trim().toLowerCase()
      );
      const hasName = rowVals.includes('name');
      const hasStatus = rowVals.includes('status') || rowVals.includes('frequency');
      const hasCity = rowVals.includes('city') || rowVals.includes('crews');

      if (hasName && (hasStatus || hasCity)) {
        headerRowIdx = ri;
        headerVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || '').trim());
        break;
      }
    }

    if (headerRowIdx === -1) return null;

    // Find ID and Wallet columns
    const idxId = findColumnIndex(headerVals, ['id', 'member id', 'memberid'], 0) ?? 0;
    const idxWallet = findColumnIndex(headerVals, ['wallet', 'wallet address', 'eth address', 'address']);

    if (idxWallet == null) return null;

    // Find member row
    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const cells = rows[ri]?.c || [];
      const idVal = String(cells[idxId]?.v ?? cells[idxId]?.f ?? '').trim();

      if (idVal && idVal === memberId) {
        const walletVal = String(cells[idxWallet]?.v ?? cells[idxWallet]?.f ?? '').trim();
        return walletVal || null;
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching wallet for member:', error);
    return null;
  }
}

/**
 * GET /api/poaps/[memberId]
 * Returns user's POAPs filtered by whitelist, with oldest + 10 newest selected
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse<POAPCollectionResponse>> {
  const { memberId } = await params;

  if (!memberId) {
    return NextResponse.json(
      { error: 'Member ID is required' } as any,
      { status: 400 }
    );
  }

  // 1. Get wallet address from Google Sheet
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

  // 2. Fetch filtered POAPs
  try {
    const { poaps, totalCount, hiddenCount } = await fetchFilteredPOAPs(walletAddress);

    return NextResponse.json({
      poaps,
      totalCount,
      hiddenCount,
      walletAddress,
    });
  } catch (error) {
    console.error('Error fetching POAPs:', error);

    // Graceful degradation: return empty collection
    return NextResponse.json({
      poaps: [],
      totalCount: 0,
      hiddenCount: 0,
      walletAddress,
    });
  }
}
