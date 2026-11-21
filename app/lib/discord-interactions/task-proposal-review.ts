/**
 * Task proposal card buttons (app/lib/call-tasks/cards.ts). Pure apart from the injected deps, like
 * ./call-review.ts. Custom ids (a cuid, well under 100 characters):
 *
 *   tp:apply:<id>     check, then a deferred EPHEMERAL reply; applyProposal runs in after()
 *   tp:confirm:<id>   (on the "Apply this?" reply of a change that closes or hides a task) the same checks,
 *                     then a deferred update; applyProposal runs confirmed
 *   tp:cancel:<id>    (on that reply) dismiss it
 *   tp:dismiss:<id>   a deferred ephemeral reply; dismissProposal runs in after()
 *
 * Who may press is the call review rule (callReviewRole: Dread Pizza Roberts, or a Pizza Capo while
 * calls.capoReviewEnabled is on), read from the interaction's member.roles. Every path checks, in order:
 * calls.taskProposalCardsEnabled, the role, that the proposal exists and is still PENDING, and (apply /
 * confirm) that it needs nothing from the website (an ambiguous lead, a missing name) and that its task has
 * not changed since it was proposed (the website's stale check; the full check runs again in applyProposal).
 * Applying and dismissing go through the website's own code (call-tasks/apply.ts), so the history, the
 * claim and the conflict check are the same. Refusals are ephemeral and carry a website link.
 */
import { EPHEMERAL, InteractionType, ResponseType } from './commands'
import { makeEmbed, type Embed } from './embeds'
import type { Interaction, InteractionResponse } from './handle'
import type { ApplyOutcome, DismissOutcome } from '@/app/lib/call-tasks/apply'

export type ProposalReviewAction = 'apply' | 'confirm' | 'dismiss'

/** The facts the checks need about the proposal (from the card view). */
export interface ProposalReviewTarget {
  id: string
  kind: string
  status: string
  /** proposalCardState() of the proposal now. */
  state: string
  /** Its review page on the website. */
  url: string
}

export interface ProposalReviewJob {
  action: ProposalReviewAction
  proposalId: string
  kind: string
  userId: string
  url: string
  applicationId: string
  token: string
}

export interface ProposalReviewDeps {
  /** calls.taskProposalCardsEnabled. */
  enabled: () => boolean | Promise<boolean>
  /** callReviewRole(member.roles): from the payload, no Discord call. */
  roleFor: (roles: string[]) => Promise<'owner' | 'capo' | null>
  target: (id: string) => Promise<ProposalReviewTarget | null>
  /** Schedule the apply / dismiss after the response (route: after()). Must not block. */
  run: (job: ProposalReviewJob) => void
  /** Schedule a card refresh (a stale or decided card was clicked). Must not block. */
  refresh?: (id: string) => void
}

type Refuse = (headline: string, body?: string) => InteractionResponse

export const PROPOSAL_BUTTON_ID = /^tp:(apply|confirm|dismiss):([A-Za-z0-9_-]{8,40})$/
export const PROPOSAL_CANCEL_ID = /^tp:cancel:([A-Za-z0-9_-]{8,40})$/

export const proposalApplyId = (id: string) => `tp:apply:${id}`
export const proposalConfirmId = (id: string) => `tp:confirm:${id}`
export const proposalCancelId = (id: string) => `tp:cancel:${id}`
export const proposalDismissId = (id: string) => `tp:dismiss:${id}`

export const isTaskProposalInteraction = (i: Interaction): boolean => (i.data?.custom_id ?? '').startsWith('tp:')

const site = (url: string) => `[Open it on the website](<${url}>).`

/** A click on a task proposal card or on its "Apply this?" reply. */
export async function handleTaskProposalButton(i: Interaction, userId: string, deps: ProposalReviewDeps, refuse: Refuse): Promise<InteractionResponse> {
  if (i.type !== InteractionType.MESSAGE_COMPONENT) return refuse('Unsupported interaction.')
  const customId = i.data?.custom_id ?? ''
  if (PROPOSAL_CANCEL_ID.test(customId)) {
    return { type: ResponseType.UPDATE_MESSAGE, data: { embeds: [], content: 'Cancelled. Nothing was changed.', components: [], allowed_mentions: { parse: [] } } }
  }
  const m = PROPOSAL_BUTTON_ID.exec(customId)
  if (!m) return refuse('Unknown button.')
  const action = m[1] as ProposalReviewAction
  const id = m[2]

  if (!(await deps.enabled())) return refuse('Task proposal cards are turned off.', 'Decide on it on the website.')
  if (!(await deps.roleFor(i.member?.roles ?? []))) return refuse("You can't decide on task proposals here.", 'Pizza Capos and Dread Pizza Roberts can. Crew leads can on the website.')
  const t = await deps.target(id)
  if (!t) return refuse('That proposal no longer exists.')
  if (t.status !== 'PENDING') {
    deps.refresh?.(id)
    return refuse('Already decided.', site(t.url))
  }
  if (t.state === 'hidden') return refuse('This one is reviewed on the website only.', site(t.url))
  if (action !== 'dismiss') {
    if (t.state === 'changed') {
      deps.refresh?.(id)
      return refuse('The task changed since this was proposed.', `Nothing was changed. ${site(t.url)}`)
    }
    if (t.state === 'needs-website') return refuse('This needs the website first.', `Choose who leads it, or give it a name, there. ${site(t.url)}`)
  }
  if (!i.application_id || !i.token) return refuse('Could not record that. Please try again.')
  deps.run({ action, proposalId: id, kind: t.kind, userId, url: t.url, applicationId: i.application_id, token: i.token })
  // Apply and Dismiss open a new private reply; Confirm edits the reply it was clicked on.
  return action === 'confirm' ? { type: ResponseType.DEFERRED_UPDATE_MESSAGE } : { type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL, allowed_mentions: { parse: [] } } }
}

// -------------------------------------------------------------- deferred ---

export interface ProposalReviewRunDeps {
  /** applyProposal with the card's permission check (no edits, never forced). */
  apply: (id: string, actor: string, confirmed: boolean) => Promise<ApplyOutcome>
  /** dismissProposal with the card's permission check. */
  dismiss: (id: string, actor: string) => Promise<DismissOutcome>
  syncCard: (id: string) => Promise<unknown>
  /** Edit the deferred / ephemeral reply (PATCH /webhooks/{app}/{token}/messages/@original). */
  edit: (applicationId: string, token: string, body: { embeds: Embed[]; components: unknown[]; content?: string }) => Promise<void>
}

/** What a change that closes or hides a task does, for the "Apply this?" reply. */
export function confirmCopy(kind: string): string {
  if (kind === 'RETIRE') return 'This archives the task (it is hidden from the crew page; it can be undone on the website).'
  if (kind === 'DONE') return 'This marks the task done.'
  return 'This closes the task.'
}

/** Refusal copy for an apply outcome (the website's route says the same). */
export function applyRefusal(r: ApplyOutcome): [string, string] {
  switch (r.result) {
    case 'conflict':
      return ['The task changed since this was proposed.', 'Nothing was changed. Check it on the website.']
    case 'not-pending':
      return ['Already decided.', '']
    case 'needs-lead':
      return ['Choose who leads it first.', 'That is done on the website.']
    case 'missing-task':
      return ['The task no longer exists.', '']
    case 'expired':
      return ['This proposal is too old to apply.', '']
    case 'disabled':
      return ['Task proposals are switched off for this crew.', '']
    case 'not-db-crew':
      return ["This crew's tasks are still edited in its Google Sheet.", '']
    case 'forbidden':
      return ["You can't decide on this.", '']
    case 'not-found':
      return ['That proposal no longer exists.', '']
    case 'bad-edits':
    case 'bad-crew':
      return ['This needs the website.', 'Nothing was changed.']
    default:
      return ['Could not apply.', 'Nothing was changed. Please try again, or decide on the website.']
  }
}

export async function runTaskProposalReview(job: ProposalReviewJob, deps: ProposalReviewRunDeps): Promise<string> {
  const reply = (embed: Embed, components: unknown[] = []) =>
    deps.edit(job.applicationId, job.token, { embeds: [embed], components }).catch((err) => console.error('[task proposal card] reply failed:', err instanceof Error ? err.message : err))
  const link = ` ${site(job.url)}`
  try {
    if (job.action === 'dismiss') {
      const r = await deps.dismiss(job.proposalId, job.userId)
      await deps.syncCard(job.proposalId).catch(() => undefined)
      if (r === 'dismissed') await reply(makeEmbed('success', 'Dismissed.', 'Nothing was changed on the task.'))
      else await reply(makeEmbed('error', r === 'not-pending' ? 'Already decided.' : r === 'forbidden' ? "You can't decide on this." : 'That proposal no longer exists.', link.trim()))
      return r
    }

    const r = await deps.apply(job.proposalId, job.userId, job.action === 'confirm')
    if (r.result === 'needs-confirm') {
      // Closing or hiding a task is confirmed separately, like on the website.
      await reply(makeEmbed('cooldown', 'Apply this?', confirmCopy(job.kind)), [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Confirm', custom_id: proposalConfirmId(job.proposalId) },
            { type: 2, style: 2, label: 'Cancel', custom_id: proposalCancelId(job.proposalId) },
          ],
        },
      ])
      return 'needs-confirm'
    }
    await deps.syncCard(job.proposalId).catch(() => undefined)
    if (r.result === 'applied') {
      await reply(makeEmbed('success', 'Applied.', job.kind === 'CREATE' ? 'The task was added to the crew.' : 'The task was updated.'))
      return 'applied'
    }
    const [headline, body] = applyRefusal(r)
    await reply(makeEmbed('error', headline, `${body}${link}`.trim()))
    return r.result
  } catch (err) {
    console.error(`[task proposal card] ${job.action} of ${job.proposalId} failed:`, err instanceof Error ? err.message : err)
    await reply(makeEmbed('error', 'Something went wrong.', `Nothing was changed. Please try again, or decide on the website.${link}`))
    return 'error'
  }
}
