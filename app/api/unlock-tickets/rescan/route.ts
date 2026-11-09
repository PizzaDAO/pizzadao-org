import { NextResponse } from 'next/server'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { getSession } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { getTicketSummary, rescanWaitSeconds, scanMembers } from '@/app/lib/unlock/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST: the signed-in member rescans their own wallets. Rate limited per member (tickets.rescanCooldownMinutes). */
export async function POST(request: Request) {
  const bad = rejectUnsafeWrite(request)
  if (bad) return bad
  const session = await getSession()
  if (!session?.discordId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const memberId = await fetchMemberIdByDiscordId(session.discordId)
  if (!memberId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const state = await prisma.unlockScanState.findUnique({ where: { memberId } })
  const wait = rescanWaitSeconds(state, await getSetting('tickets.rescanCooldownMinutes'))
  if (wait > 0) {
    return NextResponse.json({ error: 'Please wait before rescanning', retryAfterSeconds: wait }, { status: 429, headers: { 'Retry-After': String(wait) } })
  }
  const extra = session.unlockWallet ? [{ memberId, wallet: session.unlockWallet }] : []
  let partial = false
  try {
    const r = await scanMembers([memberId], extra)
    partial = r.failedChains.length > 0
  } catch (e) {
    console.error('[unlock-tickets/rescan]', e)
    return NextResponse.json({ error: 'The Unlock service could not be reached. Your tickets are unchanged; try again later.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, partial, ...(await getTicketSummary(memberId)) })
}
