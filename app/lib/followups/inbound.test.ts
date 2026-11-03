import { beforeEach, describe, expect, it, vi } from 'vitest'

const cfg = {
  inboundTelegramEnabled: true,
  inboundDiscordEnabled: true,
  inboundWindowDays: 14,
  inboundAckTelegram: 'Got it',
  inboundAckDiscord: '',
}
vi.mock('./config', () => ({ loadFollowUpConfig: vi.fn(async () => cfg) }))
const apply = vi.fn()
vi.mock('./actions', () => ({ applyMemberAction: (...a: unknown[]) => apply(...a) }))
const optedOut = vi.fn()
vi.mock('./store', () => ({ isOptedOut: (...a: unknown[]) => optedOut(...a) }))
vi.mock('@/app/lib/db', () => ({
  prisma: {
    telegramAccount: { findUnique: vi.fn() },
    followUp: { findFirst: vi.fn() },
    followUpEvent: { create: vi.fn() },
  },
}))

import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { handleInbound } from './inbound'

const NOW = new Date('2026-11-10T12:00:00Z')
const msg = (o: Record<string, unknown> = {}) => ({ source: 'discord' as const, senderId: '111', text: 'on it', kind: 'text' as const, ...o })

beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(cfg, { inboundTelegramEnabled: true, inboundDiscordEnabled: true, inboundWindowDays: 14, inboundAckTelegram: 'Got it', inboundAckDiscord: '' })
  vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: 'fu1' } as never)
  vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
  vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue({ discordId: '111' } as never)
  apply.mockResolvedValue({ ok: true, kind: 'reply', status: 'REPLIED', notify: 'Reply from X' })
  optedOut.mockResolvedValue(false)
})

describe('handleInbound', () => {
  it('claims a Discord reply, stores it through the reply action and returns the ack and alert', async () => {
    const r = await handleInbound(msg({ externalKey: 'discord:1' }), NOW)
    expect(r).toEqual({ claimed: true, ack: '', notify: 'Reply from X' })
    expect(apply).toHaveBeenCalledWith({ followUpId: 'fu1', discordId: '111', actorId: '111', action: 'reply', text: 'on it', via: 'discord-dm' })
  })
  it('resolves a Telegram id to the linked member; an unlinked id is not claimed', async () => {
    const r = await handleInbound(msg({ source: 'telegram', senderId: '999' }), NOW)
    expect(r).toMatchObject({ claimed: true, ack: 'Got it' })
    expect(prisma.telegramAccount.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { telegramId: '999' } }))
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'telegram:999', via: 'telegram-dm' }))
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
    expect(await handleInbound(msg({ source: 'telegram', senderId: '5' }), NOW)).toEqual({ claimed: false })
  })
  it('no recent follow-up: not claimed, nothing stored', async () => {
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue(null)
    expect(await handleInbound(msg(), NOW)).toEqual({ claimed: false })
    expect(apply).not.toHaveBeenCalled()
    expect(prisma.followUpEvent.create).not.toHaveBeenCalled()
  })
  it('looks back exactly the window, newest follow-up first, only replyable statuses', async () => {
    await handleInbound(msg(), NOW)
    const arg = vi.mocked(prisma.followUp.findFirst).mock.calls[0][0] as { where: { sentAt: { gte: Date }; status: { in: string[] }; ownerDiscordId: string }; orderBy: unknown }
    expect(arg.where.sentAt.gte.toISOString()).toBe('2026-10-27T12:00:00.000Z')
    expect(arg.orderBy).toEqual({ sentAt: 'desc' })
    expect(arg.where.status.in).toEqual(expect.arrayContaining(['SENT', 'REPLIED', 'IN_PROGRESS', 'NEEDS_HELP', 'DONE']))
    expect(arg.where.status.in).not.toContain('DRAFT')
  })
  it('disabled per source: not claimed', async () => {
    cfg.inboundDiscordEnabled = false
    expect(await handleInbound(msg(), NOW)).toEqual({ claimed: false })
    cfg.inboundTelegramEnabled = false
    expect(await handleInbound(msg({ source: 'telegram' }), NOW)).toEqual({ claimed: false })
    expect(prisma.followUp.findFirst).not.toHaveBeenCalled()
  })
  it('a duplicate external key does not append a second reply', async () => {
    vi.mocked(prisma.followUpEvent.create).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await handleInbound(msg({ externalKey: 'discord:1' }), NOW)).toEqual({ claimed: true, duplicate: true })
    expect(apply).not.toHaveBeenCalled()
  })
  it('opted-out members are claimed but get no ack', async () => {
    optedOut.mockResolvedValue(true)
    const r = await handleInbound(msg({ source: 'telegram' }), NOW)
    expect(r.claimed).toBe(true)
    expect(r.ack).toBeUndefined()
  })
  it('a photo is recorded as a placeholder; empty text is not claimed', async () => {
    await handleInbound(msg({ kind: 'photo', text: '' }), NOW)
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ text: '(sent a photo)' }))
    expect(await handleInbound(msg({ text: '   ' }), NOW)).toEqual({ claimed: false })
  })
  it('a refused reply (closed row) is not claimed', async () => {
    apply.mockResolvedValue({ ok: false, reason: 'closed' })
    expect(await handleInbound(msg(), NOW)).toEqual({ claimed: false })
  })
})
