/**
 * Telegram webhook updates (phase 3): follow-up buttons, replies, /start and /stop. Only private
 * chats are handled, and only for people whose Telegram is linked to a PizzaDAO account. Message
 * text is stored (replies) but never logged.
 */
import { prisma } from '@/app/lib/db'
import { applyMemberAction, findFollowUpForChat, type ActionResult } from './actions'
import { BUTTON_ID, type FollowUpAction } from './buttons'
import { optOut, setDmAllowed } from './store'
import { sendTelegramMessage } from './telegram'

export interface TgUpdate {
  update_id?: number
  message?: {
    message_id: number
    from?: { id: number; is_bot?: boolean }
    chat: { id: number; type: string }
    text?: string
    reply_to_message?: { message_id: number }
  }
  callback_query?: {
    id: string
    from: { id: number }
    data?: string
    message?: { message_id: number; chat: { id: number; type?: string } }
  }
  my_chat_member?: { chat: { id: number; type: string }; new_chat_member?: { status?: string } }
}

export interface UpdateDeps {
  send: (chatId: string, text: string, opts?: { forceReply?: boolean }) => Promise<unknown>
  answer: (callbackId: string, text?: string) => Promise<void>
  /** Tell the approvers (runs after the response in the route). */
  notify: (text: string) => void
}

export const realUpdateDeps = (notify: UpdateDeps['notify'], answer: UpdateDeps['answer']): UpdateDeps => ({
  send: (chatId, text, opts) => sendTelegramMessage(chatId, text, opts),
  answer,
  notify,
})

/** Opt-out words, matched on the whole message after case, accents and punctuation are ignored. */
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'parar', 'arreter'])
export function isStopText(text: string): boolean {
  const words = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
  // A stop word first, then at most two more words ("stop", "stop please", "stop it now").
  return words.length >= 1 && words.length <= 3 && STOP_WORDS.has(words[0])
}

const SEEN_TTL_MS = 10 * 60_000
const seenUpdates = new Map<number, number>()
/** True when this update_id was already handled in the last ~10 minutes (Telegram retries). Per instance. */
export function alreadySeen(updateId: number | undefined, now = Date.now()): boolean {
  if (typeof updateId !== 'number') return false
  for (const [id, at] of seenUpdates) if (now - at > SEEN_TTL_MS) seenUpdates.delete(id)
  if (seenUpdates.has(updateId)) return true
  seenUpdates.set(updateId, now)
  return false
}
export const resetSeenUpdates = () => seenUpdates.clear()

const NOT_LINKED = 'Link your Telegram on your PizzaDAO profile first, then try again.'

async function accountFor(telegramId: number) {
  return prisma.telegramAccount.findUnique({ where: { telegramId: String(telegramId) }, select: { discordId: true, telegramId: true } })
}

function ackFor(r: ActionResult, action: FollowUpAction): string {
  if (!r.ok) return r.reason === 'closed' ? 'This one is already closed.' : r.reason === 'empty' ? 'Send your answer as text.' : 'That message is not yours.'
  if (r.kind === 'stopped') return 'Done. You will not get these messages anymore.'
  if (r.kind === 'reply') return 'Thanks, passed it on.'
  return action === 'done' ? 'Marked as done. Thanks!' : action === 'wip' ? 'Noted: you are on it.' : 'Noted: someone will reach out to help.'
}

export async function handleTelegramUpdate(u: TgUpdate, deps: UpdateDeps): Promise<void> {
  if (alreadySeen(u.update_id)) return
  if (u.callback_query) return handleCallback(u.callback_query, deps)
  if (u.my_chat_member) {
    const m = u.my_chat_member
    if (m.chat.type !== 'private') return
    const status = m.new_chat_member?.status
    if (status === 'kicked' || status === 'left') await setDmAllowed(String(m.chat.id), false)
    else if (status === 'member') await setDmAllowed(String(m.chat.id), true)
    return
  }
  if (u.message) return handleMessage(u.message, deps)
}

async function handleCallback(q: NonNullable<TgUpdate['callback_query']>, deps: UpdateDeps): Promise<void> {
  const m = BUTTON_ID.exec(q.data ?? '')
  if (!m) return deps.answer(q.id)
  const action = m[1] as FollowUpAction
  const followUpId = m[2]
  const account = await accountFor(q.from.id)
  if (!account) return deps.answer(q.id, NOT_LINKED)
  const chatId = String(q.message?.chat.id ?? q.from.id)
  if (action === 'reply') {
    // Ownership is checked by looking the row up; the reply itself arrives as a normal message.
    const row = await prisma.followUp.findUnique({ where: { id: followUpId }, select: { ownerDiscordId: true } })
    if (!row || row.ownerDiscordId !== account.discordId) return deps.answer(q.id, 'That message is not yours.')
    await deps.answer(q.id)
    await deps.send(chatId, 'Send your reply as a message here.', { forceReply: true })
    return
  }
  const r = await applyMemberAction({ followUpId, discordId: account.discordId, actorId: `telegram:${q.from.id}`, action })
  await deps.answer(q.id, ackFor(r, action))
  if (r.ok && r.notify) deps.notify(r.notify)
}

async function handleMessage(msg: NonNullable<TgUpdate['message']>, deps: UpdateDeps): Promise<void> {
  if (msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return
  const text = (msg.text ?? '').trim()
  if (!text) return
  const chatId = String(msg.chat.id)
  const account = await accountFor(msg.from.id)
  const command = text.split(/[\s@]/)[0].toLowerCase()

  if (command === '/start') {
    if (!account) return void (await deps.send(chatId, NOT_LINKED))
    await setDmAllowed(account.telegramId, true)
    return void (await deps.send(chatId, 'You are set: PizzaDAO can now message you here. Send /stop any time to stop follow-ups.'))
  }
  if (!account) return
  if (command === '/stop' || isStopText(text)) {
    await optOut(account.discordId, `telegram:${msg.from.id}`)
    return void (await deps.send(chatId, 'Done. You will not get follow-up messages anymore.'))
  }
  if (text.startsWith('/')) return
  const target = await findFollowUpForChat(chatId, msg.reply_to_message?.message_id)
  if (!target || target.ownerDiscordId !== account.discordId) return
  const r = await applyMemberAction({ followUpId: target.id, discordId: account.discordId, actorId: `telegram:${msg.from.id}`, action: 'reply', text })
  await deps.send(chatId, ackFor(r, 'reply'))
  if (r.ok && r.notify) deps.notify(r.notify)
}
