import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { fetchCallEvents, proposeRows, runEventTimeSync } from '@/app/lib/calls/event-time-sync'
import { DEFAULT_CALL_TIME_ZONE } from '@/app/lib/calls/zoned-time'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { getSetting } from '@/app/lib/settings'
import { saveSetting } from '@/app/lib/settings/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/calls/event-times (Dread Pizza Roberts only, like call review)
 *   { action: 'fill' }                  add a row for every recurring call-channel event that has none,
 *                                       from the event's CURRENT next start in America/New_York. Saved
 *                                       through the normal settings path (audited).
 *   { action: 'dry-run', now?: ISO }    plan and log what the DST sync would change. NEVER patches Discord;
 *                                       `now` lets an admin preview a coming clock change.
 */
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

export const POST = withErrorHandling(async (request: Request) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { action?: unknown; now?: unknown } | null
  if (body?.action === 'fill') {
    const { events, callChannelId } = await fetchCallEvents()
    const existing = await getSetting('calls.eventLocalTimes')
    const rows = proposeRows(events, existing, { callChannelId, timeZone: DEFAULT_CALL_TIME_ZONE })
    const added = rows.length - existing.length
    if (added > 0) await saveSetting('calls.eventLocalTimes', rows, auth.session.discordId, { note: 'Fill from Discord' })
    return NextResponse.json({ added, total: rows.length, rows }, NO_STORE)
  }
  if (body?.action === 'dry-run') {
    let now: Date | undefined
    if (body.now !== undefined) {
      now = typeof body.now === 'string' ? new Date(body.now) : undefined
      if (!now || Number.isNaN(now.getTime())) throw new ValidationError('now must be an ISO date')
    }
    const result = await runEventTimeSync({ dryRun: true, now, post: false })
    return NextResponse.json('notRun' in result ? result : { ...result, logged: result.logged.length }, NO_STORE)
  }
  throw new ValidationError('action must be "fill" or "dry-run"')
})
