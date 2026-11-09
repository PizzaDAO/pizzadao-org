import { NextRequest, NextResponse, after } from 'next/server'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { getTicketSummary, scanMembers, shouldRefreshOnView } from '@/app/lib/unlock/scan'

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

    const summary = await getTicketSummary(memberId)
    let refreshing = false
    try {
      if (await shouldRefreshOnView(memberId)) {
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
