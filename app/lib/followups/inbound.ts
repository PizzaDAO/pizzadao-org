/**
 * Typed replies to follow-up messages, forwarded by trusted services (plans/followup-replies-inbox.md).
 * The app decides whether a message is a reply ("claims" it): only a sender who was sent a follow-up
 * within the window is claimed, and only claimed text is stored. Everything else gets { claimed: false }
 * and is dropped, so unrelated direct messages are never kept.
 */
import { Prisma, type FollowUpStatus } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { applyMemberAction } from './actions'
import { loadFollowUpConfig } from './config'
import type { InboundSource } from './inbound-auth'
import { DAY_MS } from './quiet-hours'
import { OPEN_AFTER_SEND } from './state'
import { isOptedOut } from './store'

export interface InboundMessage {
  source: InboundSource
  /** Telegram user id, or Discord user id. */
  senderId: string
  text: string
  kind: 'text' | 'photo'
  externalKey?: string
}

export interface InboundResult {
  claimed: boolean
  duplicate?: boolean
  /** Text to send back to the sender. Empty = none (Discord: react instead). Absent = send nothing. */
  ack?: string
  /** Text for the approvers, when an alert is due. */
  notify?: string
}

const NOT_CLAIMED: InboundResult = { claimed: false }
const REPLYABLE: FollowUpStatus[] = [...OPEN_AFTER_SEND, 'DONE']

export async function handleInbound(m: InboundMessage, now = new Date()): Promise<InboundResult> {
  const cfg = await loadFollowUpConfig().catch(() => null)
  if (!cfg) return NOT_CLAIMED
  if (!(m.source === 'telegram' ? cfg.inboundTelegramEnabled : cfg.inboundDiscordEnabled)) return NOT_CLAIMED

  const text = m.kind === 'photo' ? '(sent a photo)' : m.text.replace(/\u0000/g, '').trim()
  if (!text) return NOT_CLAIMED

  let discordId: string | null = m.source === 'discord' ? m.senderId : null
  if (m.source === 'telegram') {
    const acct = await prisma.telegramAccount.findUnique({ where: { telegramId: m.senderId }, select: { discordId: true } })
    discordId = acct?.discordId ?? null
  }
  if (!discordId) return NOT_CLAIMED

  const since = new Date(now.getTime() - cfg.inboundWindowDays * DAY_MS)
  const row = await prisma.followUp.findFirst({
    where: { ownerDiscordId: discordId, status: { in: REPLYABLE }, sentAt: { gte: since } },
    orderBy: { sentAt: 'desc' },
    select: { id: true },
  })
  if (!row) return NOT_CLAIMED

  const via = m.source === 'telegram' ? 'telegram-dm' : 'discord-dm'
  const actorId = m.source === 'telegram' ? `telegram:${m.senderId}` : discordId

  // Idempotency: the first writer of an external key wins; a replay changes nothing.
  if (m.externalKey) {
    try {
      await prisma.followUpEvent.create({ data: { followUpId: row.id, type: 'inbound', actorId, externalKey: m.externalKey.slice(0, 120), data: { via } } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { claimed: true, duplicate: true }
      throw e
    }
  }

  const r = await applyMemberAction({ followUpId: row.id, discordId, actorId, action: 'reply', text, via })
  if (!r.ok) return NOT_CLAIMED

  // Opted-out members wrote to us, so the reply is kept, but they get no acknowledgement.
  const optedOut = await isOptedOut(discordId).catch(() => false)
  const ack = optedOut ? undefined : m.source === 'telegram' ? cfg.inboundAckTelegram : cfg.inboundAckDiscord
  return { claimed: true, ...(ack !== undefined ? { ack } : {}), ...(r.kind === 'reply' && r.notify ? { notify: r.notify } : {}) }
}
