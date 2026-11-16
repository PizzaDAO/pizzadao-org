/**
 * Keeping the posted Discord recap current (plans/recap-action-status.md). A status change asks for
 * a refresh; the cron (every 10 minutes) later EDITS the stored message in place. Several changes
 * close together make one edit, one message is edited at most once per delay, a recap whose render
 * did not change is not touched, and a new message is never posted from here. All of it is behind
 * calls.recapLiveStatusEnabled (off by default).
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { settingInt } from '@/app/lib/settings/numbers'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { repostRecap, type PostRecapDeps } from '@/app/lib/calls/recap'
import type { editDiscordMessage } from '@/app/lib/discord-rest'

const MIN_MS = 60_000
/** A failed edit is tried once more this long later (the failure note then stops further automatic tries). */
const RETRY_MS = 60 * MIN_MS
const EDIT_ERROR_PREFIX = 'edit failed: '

/**
 * Ask for the posted recap of a call to be refreshed. No-op unless live status is on, the call is
 * published and its recap was posted. An earlier pending time is kept (a burst of taps is one
 * edit). Never throws: a member's answer must never fail because of the recap.
 */
export async function requestRecapRefresh(recordingId: string, reason: string, now = new Date()): Promise<boolean> {
  try {
    if (!(await toggleEnabled('calls.recapLiveStatusEnabled'))) return false
    const delay = settingInt('calls.recapRefreshDelayMinutes', await loadSettings())
    const res = await prisma.callRecording.updateMany({
      where: { id: recordingId, status: 'PUBLISHED', recapMessageId: { not: null }, recapRefreshAt: null },
      data: { recapRefreshAt: new Date(now.getTime() + delay * MIN_MS) },
    })
    return res.count > 0
  } catch (err) {
    console.error('[calls/recap-refresh] could not schedule', reason, err instanceof Error ? err.message : err)
    return false
  }
}

export interface RefreshSummary {
  due: number
  updated: number
  unchanged: number
  deferred: number
  gone: number
  failed: number
  skipped?: 'off'
}

export async function refreshDueRecaps(
  opts: { limit?: number; now?: Date } = {},
  deps: PostRecapDeps & { edit?: typeof editDiscordMessage } = {},
): Promise<RefreshSummary> {
  const out: RefreshSummary = { due: 0, updated: 0, unchanged: 0, deferred: 0, gone: 0, failed: 0 }
  if (!(await toggleEnabled('calls.recapLiveStatusEnabled', deps.env))) return { ...out, skipped: 'off' }
  const now = opts.now ?? new Date()
  const settings = await loadSettings()
  const delayMs = settingInt('calls.recapRefreshDelayMinutes', settings) * MIN_MS
  const cutoff = new Date(now.getTime() - settingInt('calls.recapRefreshMaxDays', settings) * 86_400_000)
  // Recaps past the age window are no longer kept current: drop their markers.
  await prisma.callRecording.updateMany({ where: { recapRefreshAt: { not: null }, publishedAt: { lt: cutoff } }, data: { recapRefreshAt: null } })
  const rows = await prisma.callRecording.findMany({
    where: { recapRefreshAt: { lte: now }, status: 'PUBLISHED', publishedAt: { gte: cutoff } },
    orderBy: { recapRefreshAt: 'asc' },
    take: opts.limit ?? 5,
    select: { id: true, recapRefreshAt: true, recapEditedAt: true, recapError: true },
  })
  out.due = rows.length
  for (const row of rows) {
    const seen = row.recapRefreshAt
    // Per-message rate limit: not again within the delay of the last edit.
    if (row.recapEditedAt && row.recapEditedAt.getTime() + delayMs > now.getTime()) {
      await prisma.callRecording.updateMany({ where: { id: row.id, recapRefreshAt: seen }, data: { recapRefreshAt: new Date(row.recapEditedAt.getTime() + delayMs) } })
      out.deferred++
      continue
    }
    // Claim it: a parallel run that already took this marker makes the count 0.
    const claim = await prisma.callRecording.updateMany({ where: { id: row.id, recapRefreshAt: seen }, data: { recapRefreshAt: null } })
    if (claim.count !== 1) continue
    let result: string
    try {
      result = await repostRecap(row.id, { edit: true, ifChanged: true }, deps)
    } catch (err) {
      console.error('[calls/recap-refresh] edit crashed:', err instanceof Error ? err.message : err)
      result = 'failed'
    }
    if (result === 'updated') out.updated++
    else if (result === 'unchanged') out.unchanged++
    else if (result === 'gone') out.gone++
    else if (result === 'failed') {
      out.failed++
      // One more try later, only when no edit note was there before: a broken message gets two automatic tries at most.
      if (!row.recapError?.startsWith(EDIT_ERROR_PREFIX)) {
        await prisma.callRecording.updateMany({ where: { id: row.id, recapRefreshAt: null }, data: { recapRefreshAt: new Date(now.getTime() + RETRY_MS) } })
      }
    }
    // Any other result (disabled, not-published, stale-redactions, excluded, imported, no-message): the marker stays cleared.
  }
  return out
}
