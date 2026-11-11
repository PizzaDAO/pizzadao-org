import { NextRequest, NextResponse, after } from 'next/server'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import {
  isRefreshing,
  collectionStatsFreshHours,
  isStale,
  readCollectionStats,
  refreshCollectionStats,
} from '@/app/lib/collection-stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/collection-stats/[memberId] — public POAP / NFT / ticket counts from the nightly
 * precompute. One indexed read; when the row is missing or stale the response is still served
 * (zeros + `pending` when missing) and a refresh runs after it. Counts only, no wallet data.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  if (!memberId) return NextResponse.json({ error: 'Missing memberId' }, { status: 400 })

  // Unknown or malformed ids never reach the database (no junk rows, no refresh).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(memberId)) return NextResponse.json({ error: 'Invalid memberId' }, { status: 400 })
  const member = await fetchMemberById(memberId).catch(() => null)
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404, headers: { 'Cache-Control': 'public, s-maxage=60' } })

  const stored = await readCollectionStats(memberId)
  let refreshing = false
  try {
    const stale = !stored || isStale(stored.computedAt, await collectionStatsFreshHours())
    if (stale && !isRefreshing(memberId)) {
      refreshing = true
      after(async () => {
        try {
          await refreshCollectionStats(memberId)
        } catch (e) {
          console.error('[collection-stats] background refresh failed', e)
        }
      })
    }
  } catch {
    // outside a request scope or settings unavailable: serve what we have
  }

  return NextResponse.json(
    {
      poapCount: stored?.poapCount ?? 0,
      nftCount: stored?.nftCount ?? 0,
      nftCollections: stored?.nftCollections ?? 0,
      ticketCount: stored?.ticketCount ?? 0,
      hasWallet: stored?.hasWallet ?? false,
      computedAt: stored?.computedAt?.toISOString() ?? null,
      pending: !stored,
      refreshing,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } },
  )
}
