/**
 * Call review card buttons (plans/capo-recap-approval, Phase 3). Pure apart from the injected deps, like
 * mission-review.ts. Custom ids (all under 100 characters: a cuid plus a base36 version):
 *
 *   cr:approve:<id>:<v>   check, then a deferred EPHEMERAL reply; the recap preview is built in after()
 *   cr:confirm:<id>:<v>   (on the preview) the same checks again, then a deferred update; publish and the
 *                         recap run in after() (./call-review-run.ts)
 *   cr:cancel:<id>        (on the preview) dismiss it
 *   cr:hold:<id>          "Needs owner": a deferred ephemeral reply; setHold runs in after()
 *
 * Every path checks, in order: both toggles (calls.reviewCardsEnabled and calls.capoReviewEnabled), that
 * the clicker is a capo or Dread Pizza Roberts (read from the interaction's member.roles, no Discord call),
 * that the call exists, is a DISCORD call and is still IN_REVIEW, and (approve/confirm) that the card
 * version is the one the clicker saw, so a capo always approves the text they read. A capo is also refused
 * a held call, a call with no summary and a call with lines hidden after the summary. Refusals are
 * ephemeral and carry a website link. The slow work runs after Discord has been answered (3 s limit); the
 * synchronous part is the cached toggles, the payload roles and one lookup.
 */
import { EPHEMERAL, InteractionType, ResponseType } from './commands'
import type { Interaction, InteractionResponse } from './handle'

export type CallReviewRole = 'owner' | 'capo'
export type CallReviewAction = 'approve' | 'confirm' | 'hold'

/** The facts the checks need about the call. */
export interface CallReviewTarget {
  id: string
  source: string
  status: string
  /** cardVersion() of the call now. */
  version: string
  hasSummary: boolean
  /** Manual hold, owner-only filter match, or an unreadable filter. */
  held: boolean
  /** Lines were hidden after the summary was written. */
  staleRedactions: boolean
}

/** What the deferred work needs. */
export interface CallReviewJob {
  action: CallReviewAction
  recordingId: string
  userId: string
  role: CallReviewRole
  applicationId: string
  token: string
}

export interface CallReviewDeps {
  /** calls.reviewCardsEnabled AND calls.capoReviewEnabled. */
  enabled: () => boolean | Promise<boolean>
  /** callReviewRole(member.roles): from the payload, no Discord call. */
  roleFor: (roles: string[]) => Promise<CallReviewRole | null>
  target: (id: string) => Promise<CallReviewTarget | null>
  /** Schedule the preview / publish / hold after the response (route: after()). Must not block. */
  run: (job: CallReviewJob) => void
  /** Schedule a card refresh (a stale or handled card was clicked). Must not block. */
  refresh?: (id: string) => void
  appUrl?: string
}

type Refuse = (headline: string, body?: string) => InteractionResponse

export const CALL_BUTTON_ID = /^cr:(approve|confirm):([A-Za-z0-9_-]{8,40}):([0-9a-z]{1,12})$/
export const CALL_HOLD_ID = /^cr:hold:([A-Za-z0-9_-]{8,40})$/
export const CALL_CANCEL_ID = /^cr:cancel:([A-Za-z0-9_-]{8,40})$/

export const callApproveId = (id: string, v: string) => `cr:approve:${id}:${v}`
export const callConfirmId = (id: string, v: string) => `cr:confirm:${id}:${v}`
export const callCancelId = (id: string) => `cr:cancel:${id}`
export const callHoldId = (id: string) => `cr:hold:${id}`

export const isCallReviewInteraction = (i: Interaction): boolean => (i.data?.custom_id ?? '').startsWith('cr:')

const link = (deps: CallReviewDeps, id: string) => {
  if (!deps.appUrl) return undefined
  const url = `${deps.appUrl}/admin/calls/${id}`
  return `Review it at [${deps.appUrl.replace(/^https?:\/\//, '')}/admin/calls](<${url}>).`
}
const withLink = (deps: CallReviewDeps, id: string, body?: string) => [body, link(deps, id)].filter(Boolean).join(' ') || undefined

const ephemeralDefer = (): InteractionResponse => ({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL, allowed_mentions: { parse: [] } } })

type Checked = { ok: true; target: CallReviewTarget; role: CallReviewRole } | { ok: false; res: InteractionResponse }

async function check(i: Interaction, id: string, version: string | null, action: CallReviewAction, deps: CallReviewDeps, refuse: Refuse): Promise<Checked> {
  if (!(await deps.enabled())) return { ok: false, res: refuse('Discord call review is turned off.', withLink(deps, id)) }
  const role = await deps.roleFor(i.member?.roles ?? [])
  if (!role) return { ok: false, res: refuse("You can't review calls.", 'Call reviewers are Pizza Capos and Dread Pizza Roberts.') }
  const target = await deps.target(id)
  if (!target || target.source !== 'DISCORD') return { ok: false, res: refuse('That call no longer exists.') }
  if (target.status !== 'IN_REVIEW') {
    deps.refresh?.(id)
    return { ok: false, res: refuse('Already handled.', withLink(deps, id, target.status === 'PUBLISHED' ? 'It has been published.' : undefined)) }
  }
  if (action === 'hold') {
    if (target.held) deps.refresh?.(id)
    return { ok: true, target, role }
  }
  if (version !== null && version !== target.version) {
    deps.refresh?.(id)
    return { ok: false, res: refuse('The summary changed since this card was posted.', 'The card is being updated. Check it again, then approve.') }
  }
  if (role === 'capo') {
    if (target.held) return { ok: false, res: refuse('This call is held for the owner.', withLink(deps, id)) }
    if (!target.hasSummary) return { ok: false, res: refuse('This call has no summary yet.', withLink(deps, id)) }
    if (target.staleRedactions) {
      return { ok: false, res: refuse('Needs the website.', withLink(deps, id, 'Lines were hidden after the summary was written. Regenerate or edit the summary first.')) }
    }
  }
  return { ok: true, target, role }
}

function job(i: Interaction, userId: string, id: string, action: CallReviewAction, role: CallReviewRole): CallReviewJob | null {
  if (!i.application_id || !i.token) return null
  return { action, recordingId: id, userId, role, applicationId: i.application_id, token: i.token }
}

/** A click on a call review card or on its preview. */
export async function handleCallReviewButton(i: Interaction, userId: string, deps: CallReviewDeps, refuse: Refuse): Promise<InteractionResponse> {
  if (i.type !== InteractionType.MESSAGE_COMPONENT) return refuse('Unsupported interaction.')
  const customId = i.data?.custom_id ?? ''

  const cancel = CALL_CANCEL_ID.exec(customId)
  if (cancel) {
    return { type: ResponseType.UPDATE_MESSAGE, data: { embeds: [], content: 'Cancelled. Nothing was published.', components: [], allowed_mentions: { parse: [] } } }
  }

  const hold = CALL_HOLD_ID.exec(customId)
  if (hold) {
    const c = await check(i, hold[1], null, 'hold', deps, refuse)
    if (!c.ok) return c.res
    const j = job(i, userId, hold[1], 'hold', c.role)
    if (!j) return refuse('Could not record that. Please try again.')
    deps.run(j)
    return ephemeralDefer()
  }

  const m = CALL_BUTTON_ID.exec(customId)
  if (!m) return refuse('Unknown button.')
  const action = m[1] as 'approve' | 'confirm'
  const c = await check(i, m[2], m[3], action, deps, refuse)
  if (!c.ok) return c.res
  const j = job(i, userId, m[2], action, c.role)
  if (!j) return refuse('Could not record that. Please try again.')
  deps.run(j)
  // Approve opens a new private preview; Confirm edits the preview it was clicked on.
  return action === 'approve' ? ephemeralDefer() : { type: ResponseType.DEFERRED_UPDATE_MESSAGE }
}
