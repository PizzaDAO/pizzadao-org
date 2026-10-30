/**
 * Buttons and labels for the follow-up messages. Discord uses component buttons with ids
 * `fu:<action>:<followUpId>`. Telegram uses URL buttons only (the shared sender bot never receives
 * taps): each opens a signed `/fu/<token>` page (links.ts) that asks for confirmation.
 */
import type { TelegramButton } from '@/app/lib/telegram/rsv-client'
import { linkUrl, signLink } from './links'

export type FollowUpAction = 'done' | 'wip' | 'help' | 'reply' | 'stop' | 'snooze'

export const ACTIONS: readonly FollowUpAction[] = ['done', 'wip', 'help', 'reply', 'stop', 'snooze']

/** Button id for the Discord reply modal. */
export const REPLY_MODAL_PREFIX = 'fu:replymodal:'
export const REPLY_INPUT_ID = 'fu:reply-input'
export const BUTTON_ID = /^fu:(done|wip|help|reply|stop):([A-Za-z0-9]{20,40})$/
export const MODAL_ID = /^fu:replymodal:([A-Za-z0-9]{20,40})$/

export const buttonId = (action: FollowUpAction, id: string) => `fu:${action}:${id}`

type Loc = 'en' | 'es' | 'fr'
type Label = FollowUpAction | 'open' | 'openReply'

const LABELS: Record<Loc, Record<Label, string>> = {
  en: { done: 'Done', wip: 'On it', help: 'Need help', reply: 'Reply', stop: 'Stop these messages', snooze: 'Snooze', open: 'Open in app', openReply: 'Open / reply' },
  es: { done: 'Hecho', wip: 'En ello', help: 'Necesito ayuda', reply: 'Responder', stop: 'Dejar de recibir estos mensajes', snooze: 'Posponer', open: 'Abrir en la app', openReply: 'Abrir / responder' },
  fr: { done: 'Fait', wip: 'Je m\'en occupe', help: 'Besoin d\'aide', reply: 'Répondre', stop: 'Arrêter ces messages', snooze: 'Reporter', open: 'Ouvrir dans l\'app', openReply: 'Ouvrir / répondre' },
}

export function labelsFor(locale: string | null | undefined): Record<Label, string> {
  const l = (locale ?? 'en').slice(0, 2).toLowerCase()
  return LABELS[(l === 'es' || l === 'fr' ? l : 'en') as Loc]
}

/**
 * The Telegram keyboard: [[Done, On it], [Snooze, Need help], [Open / reply, Stop]], every button a URL
 * to its own signed action page. Null when FOLLOWUP_LINK_SECRET is unset (no links can be signed).
 */
export function telegramUrlKeyboard(id: string, locale: string | null | undefined, ttlDays: number, now = new Date()): TelegramButton[][] | null {
  const t = labelsFor(locale)
  const b = (a: FollowUpAction, label: string): TelegramButton | null => {
    const token = signLink(id, a, ttlDays, now)
    return token ? { text: label, url: linkUrl(token) } : null
  }
  const rows = [
    [b('done', t.done), b('wip', t.wip)],
    [b('snooze', t.snooze), b('help', t.help)],
    [b('reply', t.openReply), b('stop', t.stop)],
  ]
  if (rows.some((r) => r.some((x) => !x))) return null
  return rows as TelegramButton[][]
}

/** `openUrl`: a signed link to the same action page, shown as an "Open in app" link button. */
export function discordComponents(id: string, locale?: string | null, openUrl?: string | null): unknown[] {
  const t = labelsFor(locale)
  const btn = (a: FollowUpAction, style: number) => ({ type: 2, style, label: t[a], custom_id: buttonId(a, id) })
  return [
    { type: 1, components: [btn('done', 3), btn('wip', 1), btn('help', 4), btn('reply', 2)] },
    { type: 1, components: [btn('stop', 2), ...(openUrl ? [{ type: 2, style: 5, label: t.open, url: openUrl }] : [])] },
  ]
}
