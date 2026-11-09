import { NextRequest, NextResponse, after } from 'next/server'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { getSession } from '@/app/lib/session'
import { claimRefreshOnView, getTicketSummary, scanMembers } from '@/app/lib/unlock/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET: the member's Pizza Party Tickets from the cache. When the cache is older than
 * tickets.scanIntervalHours the response is still served from the cache and a refresh runs after it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  try {
    const { memberId } = await params
    if (!memberId) return NextResponse.json({ error: 'Missing memberId' }, { status: 400 })
    const member = await fetchMemberById(memberId)
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    // Before the migration (or on a DB hiccup) show 0 rather than an error.
    const summary = await getTicketSummary(memberId).catch(() => ({ totalTickets: 0, events: [], wallets: 0, lastScanAt: null }))
    let refreshing = false
    try {
      // Only signed-in viewers can trigger the background refresh (it spends subgraph calls).
      const session = await getSession()
      if (session?.discordId && (await claimRefreshOnView(memberId))) {
        refreshing = true
        after(async () => {
          try {
            await scanMembers([memberId])
          } catch (e) {
            console.error('[unlock-tickets] background refresh failed', e)
          }
        })
      }
    } catch (e) {
      console.error('[unlock-tickets] staleness check failed', e)
    }
    return NextResponse.json({ ...summary, refreshing })
  } catch (error) {
    console.error('Error fetching unlock tickets:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
