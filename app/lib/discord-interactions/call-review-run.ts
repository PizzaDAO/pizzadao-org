/**
 * The deferred half of the call review buttons (route: after()). The interaction handler
 * (./call-review.ts) has already checked the toggles, the reviewer's role, the call and the card version
 * and answered Discord within 3 s; this runs afterwards:
 *
 *   approve  build the exact recap text and its target channel, then edit the private reply into a
 *            preview with Confirm / Cancel buttons (the version rides in the Confirm id)
 *   confirm  the same publish + recap path as the website: publishRecording (a capo with
 *            refuseStaleRedactions), then postCallRecap on a fresh publish, the audit row (via "discord")
 *            and a card refresh; the private reply is edited to the outcome
 *   hold     setHold (via "discord"), then the reply says it is held; setHold refreshes the card
 *
 * Dependencies are injected so tests never reach Discord or the database.
 */
import { makeEmbed, type Embed } from './embeds'
import { callCancelId, callConfirmId, type CallReviewJob } from './call-review'

export interface RecapPreview {
  /** The exact text that would be posted. */
  text: string
  /** Where it would be posted ("#education"), or null when no channel resolves. */
  channelLabel: string | null
  /** calls.recapPostEnabled. */
  postingOn: boolean
  /** The recap would be skipped (crew excluded, stale lines, imported). */
  willSkip: boolean
}

export type PublishOutcome = 'ok' | 'already' | 'not-found' | 'not-allowed' | 'incomplete' | 'transcribing' | 'conflict' | 'stale-redactions'
export type RecapOutcome = 'posted' | 'disabled' | 'already-posted' | 'not-published' | 'excluded' | 'stale-redactions' | 'no-channel' | 'no-token' | 'imported' | 'failed'

export interface CallReviewRunDeps {
  /** The recap preview and the card version it belongs to; null: the call is gone or has no summary. */
  preview: (id: string) => Promise<(RecapPreview & { version: string }) | null>
  /** `version`: the card version confirmed; the publish refuses (conflict) when the call has moved on, and a capo's also when it is held. */
  publish: (id: string, reviewerId: string, role: 'owner' | 'capo', version?: string) => Promise<PublishOutcome>
  /** The call's status and who reviewed it, read fresh (to tell a lost double-Confirm from a real refusal). */
  current: (id: string) => Promise<{ status: string; reviewedBy: string | null } | null>
  recap: (id: string) => Promise<RecapOutcome>
  audit: (ev: { recordingId: string; actorId: string; recap: RecapOutcome | null }) => Promise<void>
  hold: (id: string, actorId: string) => Promise<'ok' | 'already' | 'not-found'>
  syncCard: (id: string) => Promise<unknown>
  /** Edit the deferred / ephemeral reply (PATCH /webhooks/{app}/{token}/messages/@original). */
  edit: (applicationId: string, token: string, body: { embeds: Embed[]; components: unknown[]; content?: string }) => Promise<void>
  appUrl?: string
}

const NO_BUTTONS: unknown[] = []
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const siteLink = (deps: CallReviewRunDeps, id: string) => (deps.appUrl ? ` [Open on the website](<${deps.appUrl}/admin/calls/${id}>)` : '')

export function recapTargetLine(p: Pick<RecapPreview, 'channelLabel' | 'postingOn' | 'willSkip'>): string {
  if (!p.postingOn) return 'Recap posting is off, so this publishes the call on the website only.'
  if (p.willSkip || !p.channelLabel) return 'No recap will be posted in Discord for this call; it is published on the website only.'
  return `The recap below will be posted in ${p.channelLabel}.`
}

export async function runCallReview(job: CallReviewJob, deps: CallReviewRunDeps): Promise<string> {
  const reply = (embed: Embed, components: unknown[] = NO_BUTTONS) =>
    deps.edit(job.applicationId, job.token, { embeds: [embed], components }).catch((err) => console.error('[call review] reply failed:', err instanceof Error ? err.message : err))
  try {
    if (job.action === 'approve') {
      const p = await deps.preview(job.recordingId)
      if (!p) {
        await reply(makeEmbed('error', 'Could not build the recap.', `Nothing was published.${siteLink(deps, job.recordingId)}`))
        return 'no-preview'
      }
      const embed = makeEmbed(
        'cooldown',
        'Publish this call?',
        [
          recapTargetLine(p),
          'Publishing is public and cannot be undone here: unpublishing later does not delete a recap that was already posted.',
          '',
          clip(p.text, 3000),
        ].join('\n'),
      )
      await reply(embed, [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Confirm publish', custom_id: callConfirmId(job.recordingId, p.version) },
            { type: 2, style: 2, label: 'Cancel', custom_id: callCancelId(job.recordingId) },
          ],
        },
      ])
      return 'previewed'
    }

    if (job.action === 'hold') {
      const r = await deps.hold(job.recordingId, job.userId)
      if (r === 'not-found') {
        await reply(makeEmbed('error', 'That call no longer exists.'))
        return 'not-found'
      }
      await reply(makeEmbed('success', r === 'already' ? 'Already held for owner review.' : 'Held for owner review.', 'Only Dread Pizza Roberts can publish it now.'))
      await deps.syncCard(job.recordingId).catch(() => undefined)
      return r
    }

    // confirm
    const result = await deps.publish(job.recordingId, job.userId, job.role, job.version)
    if (result === 'ok') {
      // Only a fresh publish posts the recap, exactly like the website (a double confirm sees 'already').
      const recap = await deps.recap(job.recordingId).catch((err): RecapOutcome => {
        console.error('[call review] recap failed:', err instanceof Error ? err.message : err)
        return 'failed'
      })
      await deps.audit({ recordingId: job.recordingId, actorId: job.userId, recap })
      await deps.syncCard(job.recordingId).catch(() => undefined)
      await reply(makeEmbed('success', 'Published.', recapOutcomeText(recap)))
      return 'published'
    }
    await deps.syncCard(job.recordingId).catch(() => undefined)
    if (result === 'conflict' || result === 'already') {
      // A double Confirm: the other click published it and wrote "Published." onto this same reply. Do not overwrite that.
      const now = await deps.current(job.recordingId).catch(() => null)
      if (now?.status === 'PUBLISHED') {
        if (now.reviewedBy === job.userId) return 'already'
        await reply(makeEmbed('success', 'Already published.', `Someone else published this call just now.${siteLink(deps, job.recordingId)}`))
        return 'already'
      }
    }
    const [headline, body] = refusalCopy(result)
    await reply(makeEmbed('error', headline, `${body}${siteLink(deps, job.recordingId)}`.trim()))
    return result
  } catch (err) {
    console.error(`[call review] ${job.action} of ${job.recordingId} failed:`, err instanceof Error ? err.message : err)
    await reply(makeEmbed('error', 'Something went wrong.', `Nothing was changed. Please try again, or review on the website.${siteLink(deps, job.recordingId)}`))
    return 'error'
  }
}

export function recapOutcomeText(r: RecapOutcome): string {
  switch (r) {
    case 'posted':
      return 'The recap was posted.'
    case 'disabled':
      return 'Recap posting is off, so no recap was posted.'
    case 'failed':
      return 'The call is published, but the recap could not be posted. Ask the owner to repost it.'
    case 'already-posted':
      return 'A recap was already posted for this call.'
    default:
      return 'No recap was posted for this call.'
  }
}

/** Refusal copy shared with the website's publish route. */
export function refusalCopy(r: PublishOutcome): [string, string] {
  switch (r) {
    case 'already':
      return ['Already published.', 'Nothing more to do.']
    case 'not-found':
      return ['That call no longer exists.', '']
    case 'not-allowed':
      return ["That call isn't in a state that can be published.", '']
    case 'conflict':
      return ['The call changed while publishing.', 'Nothing was published. The card is being updated: check it and approve again.']
    case 'stale-redactions':
      return ['Needs the website.', 'Lines were hidden after the summary was written. Regenerate or edit the summary first.']
    case 'transcribing':
      return ['Transcription is still pending for this call.', 'Publish once it has finished.']
    case 'incomplete':
      return ['A transcript and a summary are required before publishing.', '']
    default:
      return ['Could not publish.', '']
  }
}
