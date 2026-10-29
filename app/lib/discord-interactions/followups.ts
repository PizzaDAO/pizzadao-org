/**
 * Follow-up DM buttons and the Reply modal (phase 3). Custom ids are `fu:<action>:<id>`.
 * These arrive from a direct message, so they carry no guild id: handle.ts routes them here before
 * the guild check. Only the person the follow-up is addressed to can act on it (checked in
 * respond()). Replies are ephemeral to that person.
 */
import { InteractionType, EPHEMERAL, ResponseType } from './commands'
import type { Interaction, InteractionResponse } from './handle'
import { BUTTON_ID, MODAL_ID, REPLY_INPUT_ID, REPLY_MODAL_PREFIX, type FollowUpAction } from '../followups/buttons'
import type { ActionResult } from '../followups/actions'

export interface FollowUpInteractionDeps {
  respond: (a: { followUpId: string; discordId: string; action: FollowUpAction; text?: string }) => Promise<ActionResult>
  /** Tell the approvers (route: after()). Must not block. */
  notify: (text: string) => void
  /** Whether the row exists and belongs to this person (checked before opening the modal). */
  owns: (followUpId: string, discordId: string) => Promise<boolean>
}

const say = (content: string): InteractionResponse => ({
  type: ResponseType.CHANNEL_MESSAGE,
  data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
})

function ack(r: ActionResult, action: FollowUpAction): string {
  if (!r.ok) return r.reason === 'closed' ? 'This one is already closed.' : r.reason === 'empty' ? 'Write a reply first.' : r.reason === 'not-found' ? 'That message no longer exists.' : 'That message is not yours.'
  if (r.kind === 'stopped') return 'Done. You will not get these messages anymore.'
  if (r.kind === 'reply') return 'Thanks, passed it on.'
  return action === 'done' ? 'Marked as done. Thanks!' : action === 'wip' ? 'Noted: you are on it.' : 'Noted: someone will reach out to help.'
}

export const isFollowUpInteraction = (i: Interaction): boolean => (i.data?.custom_id ?? '').startsWith('fu:')

function modalText(i: Interaction): string {
  for (const row of i.data?.components ?? []) for (const c of row.components ?? []) if (c.custom_id === REPLY_INPUT_ID && typeof c.value === 'string') return c.value
  return ''
}

export async function handleFollowUpInteraction(i: Interaction, userId: string, deps: FollowUpInteractionDeps): Promise<InteractionResponse> {
  const customId = i.data?.custom_id ?? ''

  if (i.type === InteractionType.MODAL_SUBMIT) {
    const m = MODAL_ID.exec(customId)
    if (!m) return say('Unknown form.')
    const r = await deps.respond({ followUpId: m[1], discordId: userId, action: 'reply', text: modalText(i) })
    if (r.ok && r.notify) deps.notify(r.notify)
    return say(ack(r, 'reply'))
  }
  if (i.type !== InteractionType.MESSAGE_COMPONENT) return say('Unsupported interaction.')

  const m = BUTTON_ID.exec(customId)
  if (!m) return say('Unknown button.')
  const action = m[1] as FollowUpAction
  const followUpId = m[2]

  if (action === 'reply') {
    if (!(await deps.owns(followUpId, userId))) return say('That message is not yours.')
    return {
      type: ResponseType.MODAL,
      data: {
        custom_id: `${REPLY_MODAL_PREFIX}${followUpId}`,
        title: 'Your reply',
        components: [
          {
            type: 1,
            components: [{ type: 4, custom_id: REPLY_INPUT_ID, style: 2, label: 'Reply', min_length: 1, max_length: 1000, required: true }],
          },
        ],
      },
    }
  }
  const r = await deps.respond({ followUpId, discordId: userId, action })
  if (r.ok && r.notify) deps.notify(r.notify)
  return say(ack(r, action))
}
