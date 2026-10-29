/**
 * Button ids and labels shared by the Telegram and Discord follow-up messages.
 * Ids are `fu:<action>:<followUpId>` (Telegram callback_data allows 64 bytes; a cuid is 25).
 */
import type { InlineButton } from './telegram'

export type FollowUpAction = 'done' | 'wip' | 'help' | 'reply' | 'stop'

export const ACTIONS: readonly FollowUpAction[] = ['done', 'wip', 'help', 'reply', 'stop']

/** Button id for the Discord reply modal. */
export const REPLY_MODAL_PREFIX = 'fu:replymodal:'
export const REPLY_INPUT_ID = 'fu:reply-input'
export const BUTTON_ID = /^fu:(done|wip|help|reply|stop):([A-Za-z0-9]{20,40})$/
export const MODAL_ID = /^fu:replymodal:([A-Za-z0-9]{20,40})$/

export const buttonId = (action: FollowUpAction, id: string) => `fu:${action}:${id}`

type Loc = 'en' | 'es' | 'fr'

const LABELS: Record<Loc, Record<FollowUpAction, string>> = {
  en: { done: 'Done', wip: 'On it', help: 'Need help', reply: 'Reply', stop: 'Stop these messages' },
  es: { done: 'Hecho', wip: 'En ello', help: 'Necesito ayuda', reply: 'Responder', stop: 'Dejar de recibir estos mensajes' },
  fr: { done: 'Fait', wip: 'Je m\'en occupe', help: 'Besoin d\'aide', reply: 'Répondre', stop: 'Arrêter ces messages' },
}

export function labelsFor(locale: string | null | undefined): Record<FollowUpAction, string> {
  const l = (locale ?? 'en').slice(0, 2).toLowerCase()
  return LABELS[(l === 'es' || l === 'fr' ? l : 'en') as Loc]
}

export function telegramKeyboard(id: string, locale?: string | null): InlineButton[][] {
  const t = labelsFor(locale)
  const b = (a: FollowUpAction): InlineButton => ({ text: t[a], callback_data: buttonId(a, id) })
  return [[b('done'), b('wip')], [b('help'), b('reply')], [b('stop')]]
}

export function discordComponents(id: string, locale?: string | null): unknown[] {
  const t = labelsFor(locale)
  const btn = (a: FollowUpAction, style: number) => ({ type: 2, style, label: t[a], custom_id: buttonId(a, id) })
  return [
    { type: 1, components: [btn('done', 3), btn('wip', 1), btn('help', 4), btn('reply', 2)] },
    { type: 1, components: [btn('stop', 2)] },
  ]
}
