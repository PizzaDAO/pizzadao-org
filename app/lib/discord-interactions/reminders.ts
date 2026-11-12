/**
 * The Stop button on reminder DMs. Custom ids are `rm:<action>:<kind>` (`rm:stop:calls`, `rm:stop:proposals`).
 * These arrive from a direct message, so they carry no guild id: handle.ts routes them here before the
 * guild check. The actor is the invoking user (member.user.id, or user.id in a DM) and nothing in the
 * custom id can name another member. The route has already verified Discord's signature.
 */
import { InteractionType, EPHEMERAL, ResponseType } from './commands'
import type { Interaction, InteractionResponse } from './handle'

export interface ReminderInteractionDeps {
  /** Turn this kind of reminder off for the member. */
  stop: (discordId: string, kind: 'calls' | 'proposals') => Promise<void>
  /** Where the member manages reminders (the profile edit page), when it can be worked out. */
  settingsUrl: (discordId: string) => Promise<string | null>
}

const say = (content: string): InteractionResponse => ({
  type: ResponseType.CHANNEL_MESSAGE,
  data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
})

export const isReminderInteraction = (i: Interaction): boolean => (i.data?.custom_id ?? '').startsWith('rm:')

const STOP_ID = /^rm:stop:(calls|proposals)$/

export async function handleReminderInteraction(i: Interaction, userId: string, deps: ReminderInteractionDeps): Promise<InteractionResponse> {
  if (i.type !== InteractionType.MESSAGE_COMPONENT) return say('Unsupported interaction.')
  const m = STOP_ID.exec(i.data?.custom_id ?? '')
  if (!m) return say('Unknown button.')
  const kind = m[1] as 'calls' | 'proposals'
  await deps.stop(userId, kind)
  const url = await deps.settingsUrl(userId).catch(() => null)
  return say(`Done. You will not get ${kind === 'calls' ? 'call' : 'proposal'} reminders anymore.${url ? ` Turn them back on any time: ${url}` : ''}`)
}
