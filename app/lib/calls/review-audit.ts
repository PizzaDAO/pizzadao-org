/**
 * Audit trail for call review (CallReviewEvent): who did what, and from where. Never stores transcript
 * text: metadata is small flags (e.g. { recap: 'posted' }). Writing an event never throws and never
 * blocks the action it records.
 */
import { prisma } from '@/app/lib/db'
import { toggleEnabled } from '@/app/lib/settings/toggles'

export type CallReviewAction = 'publish' | 'unpublish' | 'reject' | 'hold' | 'release' | 'auto_hold' | 'summary_edit' | 'regenerate' | 'redact' | 'card_posted'
export type CallReviewVia = 'web' | 'discord' | 'bulk' | 'cron'

export interface CallReviewEventInput {
  recordingId: string
  /** Discord id, or "system:<what>". */
  actorId: string
  action: CallReviewAction
  via: CallReviewVia
  metadata?: Record<string, string | number | boolean | null>
}

/**
 * Record one event. Never throws. With `always` unset the event is written only while capo review is on,
 * so with the toggle off the review routes do exactly what they did before this existed.
 */
export async function recordCallReviewEvent(ev: CallReviewEventInput, opts: { always?: boolean } = {}): Promise<void> {
  try {
    if (!opts.always && !(await toggleEnabled('calls.capoReviewEnabled'))) return
    await prisma.callReviewEvent.create({
      data: { recordingId: ev.recordingId, actorId: ev.actorId, action: ev.action, via: ev.via, ...(ev.metadata ? { metadata: ev.metadata } : {}) },
    })
  } catch (err) {
    console.error('[calls/review-audit] could not record event:', err instanceof Error ? err.message : err)
  }
}
