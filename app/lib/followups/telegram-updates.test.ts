import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { alreadySeen, handleTelegramUpdate, isStopText, resetSeenUpdates, type TgUpdate, type UpdateDeps } from './telegram-updates'

const FU = 'c'.repeat(25)
const account = { discordId: 'd1', telegramId: '777' }

const deps = (): UpdateDeps & { sent: string[]; answers: Array<string | undefined>; notified: string[] } => {
  const sent: string[] = []
  const answers: Array<string | undefined> = []
  const notified: string[] = []
  return {
    sent,
    answers,
    notified,
    send: vi.fn(async (_c: string, t: string) => void sent.push(t)),
    answer: vi.fn(async (_id: string, t?: string) => void answers.push(t)),
    notify: (t: string) => void notified.push(t),
  }
}

const row = (over: Record<string, unknown> = {}) => ({ id: FU, ownerDiscordId: 'd1', ownerName: 'Member A', ask: 'the plan', status: 'SENT', ...over })

beforeEach(() => {
  vi.resetAllMocks()
  resetSeenUpdates()
  vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) => cb(prisma)) as never)
  vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
  vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
})

const msg = (text: string, extra: Record<string, unknown> = {}): TgUpdate => ({ message: { message_id: 9, from: { id: 777 }, chat: { id: 777, type: 'private' }, text, ...extra } })
const press = (data: string): TgUpdate => ({ callback_query: { id: 'cb1', from: { id: 777 }, data, message: { message_id: 3, chat: { id: 777 } } } })

describe('/start', () => {
  it('turns DMs on for a linked account', async () => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(account as never)
    const d = deps()
    await handleTelegramUpdate(msg('/start fu'), d)
    expect(prisma.telegramAccount.updateMany).toHaveBeenCalledWith({ where: { telegramId: '777' }, data: { dmAllowed: true } })
    expect(d.sent[0]).toMatch(/set/i)
  })
  it('asks an unlinked person to link first and changes nothing', async () => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
    const d = deps()
    await handleTelegramUpdate(msg('/start'), d)
    expect(prisma.telegramAccount.updateMany).not.toHaveBeenCalled()
    expect(d.sent[0]).toMatch(/link/i)
  })
  it('ignores group chats', async () => {
    const d = deps()
    await handleTelegramUpdate({ message: { message_id: 1, from: { id: 777 }, chat: { id: -5, type: 'group' }, text: '/start' } }, d)
    expect(d.sent).toEqual([])
    expect(prisma.telegramAccount.findUnique).not.toHaveBeenCalled()
  })
})

describe('/stop and STOP', () => {
  it.each(['/stop', 'STOP', ' stop '])('opts out on %j', async (text) => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(account as never)
    const d = deps()
    await handleTelegramUpdate(msg(text), d)
    expect(prisma.messagingOptOut.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { discordId: 'd1' } }))
    expect(d.sent[0]).toMatch(/will not get/i)
  })
})

describe('button taps', () => {
  beforeEach(() => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(account as never)
  })
  it('Done moves SENT to DONE and logs a button event', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    const d = deps()
    await handleTelegramUpdate(press(`fu:done:${FU}`), d)
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: FU, status: { in: ['SENT'] } }, data: expect.objectContaining({ status: 'DONE' }) }))
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'button', actorId: 'telegram:777' }) })
    expect(d.answers[0]).toMatch(/done/i)
  })
  it('Need help moves to NEEDS_HELP and alerts the approvers', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    const d = deps()
    await handleTelegramUpdate(press(`fu:help:${FU}`), d)
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'NEEDS_HELP' }) }))
    expect(d.notified[0]).toContain('needs help')
  })
  it('someone else cannot press a button on another person\'s follow-up', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ ownerDiscordId: 'other' }) as never)
    const d = deps()
    await handleTelegramUpdate(press(`fu:done:${FU}`), d)
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
    expect(d.answers[0]).toMatch(/not yours/i)
  })
  it('a closed follow-up cannot be changed', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'DISMISSED' }) as never)
    const d = deps()
    await handleTelegramUpdate(press(`fu:wip:${FU}`), d)
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
    expect(d.answers[0]).toMatch(/closed/i)
  })
  it('Stop opts the person out', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    await handleTelegramUpdate(press(`fu:stop:${FU}`), deps())
    expect(prisma.messagingOptOut.upsert).toHaveBeenCalled()
  })
  it('Reply asks for a message (force reply) without changing status', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    const d = deps()
    await handleTelegramUpdate(press(`fu:reply:${FU}`), d)
    expect(d.send).toHaveBeenCalledWith('777', expect.any(String), { forceReply: true })
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
  })
  it('ignores callback data that is not ours', async () => {
    const d = deps()
    await handleTelegramUpdate(press('something-else'), d)
    expect(prisma.followUp.findUnique).not.toHaveBeenCalled()
  })
  it('an unlinked account gets a hint, not an action', async () => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
    const d = deps()
    await handleTelegramUpdate(press(`fu:done:${FU}`), d)
    expect(d.answers[0]).toMatch(/link/i)
    expect(prisma.followUp.findUnique).not.toHaveBeenCalled()
  })
})

describe('replies', () => {
  beforeEach(() => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(account as never)
  })
  it('a reply to the message matches by chat and message id, stores the text, notifies', async () => {
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: FU, ownerDiscordId: 'd1' } as never)
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    const d = deps()
    await handleTelegramUpdate(msg('Working on it, done Friday', { reply_to_message: { message_id: 55 } }), d)
    expect(prisma.followUp.findFirst).toHaveBeenCalledWith({ where: { telegramChatId: '777', telegramMessageId: 55 }, select: { id: true, ownerDiscordId: true } })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastReply: 'Working on it, done Friday', status: 'REPLIED' }) }))
    expect(d.notified[0]).toContain('Working on it')
    expect(d.sent[0]).toMatch(/passed it on/i)
  })
  it('a plain message attaches to the chat\'s latest open follow-up from the last 7 days', async () => {
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: FU, ownerDiscordId: 'd1' } as never)
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    await handleTelegramUpdate(msg('hello'), deps())
    const arg = vi.mocked(prisma.followUp.findFirst).mock.calls[0][0] as { where: { status: { in: string[] }; sentAt: { gte: Date } } }
    expect(arg.where.status.in).toContain('SENT')
    expect(arg.where.sentAt.gte.getTime()).toBeGreaterThan(Date.now() - 8 * 86400_000)
  })
  it('does nothing when there is no open follow-up', async () => {
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue(null)
    const d = deps()
    await handleTelegramUpdate(msg('hello'), d)
    expect(d.sent).toEqual([])
  })
  it('never attaches a reply to someone else\'s follow-up', async () => {
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: FU, ownerDiscordId: 'someone-else' } as never)
    const d = deps()
    await handleTelegramUpdate(msg('hello'), d)
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
    expect(d.sent).toEqual([])
  })
})

describe('my_chat_member', () => {
  it('blocking the bot clears DM permission; unblocking restores it', async () => {
    await handleTelegramUpdate({ my_chat_member: { chat: { id: 777, type: 'private' }, new_chat_member: { status: 'kicked' } } }, deps())
    expect(prisma.telegramAccount.updateMany).toHaveBeenLastCalledWith({ where: { telegramId: '777' }, data: { dmAllowed: false } })
    await handleTelegramUpdate({ my_chat_member: { chat: { id: 777, type: 'private' }, new_chat_member: { status: 'member' } } }, deps())
    expect(prisma.telegramAccount.updateMany).toHaveBeenLastCalledWith({ where: { telegramId: '777' }, data: { dmAllowed: true } })
  })
})

describe('STOP variants', () => {
  it.each(['stop', 'STOP', 'Stop!', ' stop. ', 'unsubscribe', 'Parar', 'ARRÊTER', 'arreter', '¡Parar!'])('%j is an opt-out', (t) => {
    expect(isStopText(t)).toBe(true)
  })
  it.each(['stop please', 'Stop it now!', 'parar por favor'])('%j (a stop word then up to two words) is an opt-out', (t) => {
    expect(isStopText(t)).toBe(true)
  })
  it.each(['please stop by tomorrow', 'stopped', 'non-stop', 'ok', 'stop that is not what I meant at all'])('%j is not', (t) => {
    expect(isStopText(t)).toBe(false)
  })
  it('opts out through the handler for a punctuated word', async () => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(account as never)
    await handleTelegramUpdate(msg('Arrêter.'), deps())
    expect(prisma.messagingOptOut.upsert).toHaveBeenCalled()
  })
})

describe('update_id dedupe', () => {
  it('handles a repeated update_id once', async () => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(account as never)
    const u = { ...msg('/start'), update_id: 4242 }
    const d = deps()
    await handleTelegramUpdate(u, d)
    await handleTelegramUpdate(u, d)
    expect(d.sent).toHaveLength(1)
  })
  it('forgets an id after about ten minutes', () => {
    expect(alreadySeen(1, 1_000)).toBe(false)
    expect(alreadySeen(1, 2_000)).toBe(true)
    expect(alreadySeen(1, 1_000 + 11 * 60_000)).toBe(false)
  })
})

describe('approver alerts are bounded', () => {
  beforeEach(() => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(account as never)
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: FU, ownerDiscordId: 'd1' } as never)
    vi.mocked(prisma.followUpEvent.count).mockResolvedValue(0 as never)
  })
  it('help alerts only on a change into NEEDS_HELP', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'NEEDS_HELP' }) as never)
    const d = deps()
    await handleTelegramUpdate(press(`fu:help:${FU}`), d)
    expect(d.notified).toEqual([])
  })
  it('a second reply within 10 minutes is merged into the note with no new alert', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'REPLIED', lastReply: 'first', lastReplyAt: new Date(Date.now() - 60_000) }) as never)
    const d = deps()
    await handleTelegramUpdate(msg('second'), d)
    expect(d.notified).toEqual([])
    expect(prisma.followUp.update).toHaveBeenCalledWith({ where: { id: FU }, data: expect.objectContaining({ lastReply: 'first\nsecond' }) })
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'reply' }) })
  })
  it('a reply after the gap alerts again, and records the alert', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'REPLIED', lastReply: 'first', lastReplyAt: new Date(Date.now() - 20 * 60_000) }) as never)
    const d = deps()
    await handleTelegramUpdate(msg('later'), d)
    expect(d.notified).toHaveLength(1)
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'alert' }) })
    // Count + insert happen inside one transaction under a per-member advisory lock.
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalled()
  })
  it('stops alerting once the member hit the daily alert cap (the reply is still saved)', async () => {
    vi.mocked(prisma.followUpEvent.count).mockResolvedValue(5 as never)
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    const d = deps()
    await handleTelegramUpdate(msg('hello'), d)
    expect(d.notified).toEqual([])
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastReply: 'hello' }) }))
  })
})
