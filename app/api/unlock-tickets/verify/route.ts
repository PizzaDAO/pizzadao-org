import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { getTicketSummary, scanMembers } from '@/app/lib/unlock/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET: after the Unlock sign-in redirect, scan the member's saved wallets for tickets.
 * The Unlock flow does not add wallets; wallets are added from the wallet manager.
 * If the scan fails nothing is stored as "0 tickets".
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session?.discordId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const memberId = await fetchMemberIdByDiscordId(session.discordId)
    if (!memberId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    try {
      await scanMembers([memberId])
    } catch (e) {
      console.error('[unlock-tickets/verify] scan failed', e)
      return NextResponse.json({ error: 'The Unlock service could not be reached. Use Rescan in a few minutes.' }, { status: 502 })
    }
    return NextResponse.json(await getTicketSummary(memberId))
  } catch (error) {
    console.error('Error scanning unlock tickets:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
