import { describe, it, expect, vi } from 'vitest'
vi.mock('@/app/lib/db')
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => []) }))
vi.mock('./notify', async (orig) => ({ ...(await orig<typeof import('./notify')>()), deliverToContacts: vi.fn(async () => 0) }))

import { DiscordPostError } from '@/app/lib/discord-rest'
import { TelegramApiError } from './telegram'
import { prisma } from '@/app/lib/db'
import { composeText, decideSend, deliverOverChannels, escalationText, flagStuck, footerFor, isStale, sendFollowUp, type DecideInput, type Senders } from './send'
import type { FollowUpConfig } from './config'
import { deliverToContacts } from './notify'

const now = new Date('2026-11-02T12:00:00Z') // 12:00 UTC: outside 21-09
const base = (over: Partial<DecideInput> = {}): DecideInput => ({
  row: { escalateOnly: false, ownerDiscordId: '111', channel: null },
  cfg: { sendEnabled: true, maxPerDay: 3, quietStartHour: 21, quietEndHour: 9 },
  now,
  optedOut: false,
  timezone: 'UTC',
  sentAt: [],
  telegramDmAllowed: false,
  ...over,
})

describe('decideSend', () => {
  it('holds everything while sending is off', () => {
    expect(decideSend(base({ cfg: { sendEnabled: false, maxPerDay: 3, quietStartHour: 21, quietEndHour: 9 } }))).toEqual({ action: 'hold' })
    // Even a row that would otherwise escalate does not move.
    expect(decideSend(base({ cfg: { sendEnabled: false, maxPerDay: 3, quietStartHour: 21, quietEndHour: 9 }, optedOut: true })).action).toBe('hold')
  })
  it('sends over Discord by default and Telegram first when the person allowed DMs', () => {
    expect(decideSend(base())).toEqual({ action: 'send', channels: ['DISCORD'] })
    expect(decideSend(base({ telegramDmAllowed: true }))).toEqual({ action: 'send', channels: ['TELEGRAM', 'DISCORD'] })
  })
  it('honours the reviewer channel, but never Telegram without DM permission', () => {
    expect(decideSend(base({ row: { escalateOnly: false, ownerDiscordId: '111', channel: 'DISCORD' }, telegramDmAllowed: true }))).toEqual({ action: 'send', channels: ['DISCORD', 'TELEGRAM'] })
    expect(decideSend(base({ row: { escalateOnly: false, ownerDiscordId: '111', channel: 'TELEGRAM' }, telegramDmAllowed: false }))).toEqual({ action: 'send', channels: ['DISCORD'] })
  })
  it('defers during the recipient quiet hours, to the end of them', () => {
    const late = new Date('2026-11-03T03:00:00Z') // 22:00 in New York
    const d = decideSend(base({ now: late, timezone: 'America/New_York' }))
    expect(d.action).toBe('defer')
    if (d.action === 'defer') {
      expect(d.why).toBe('quiet')
      expect(d.until.getTime()).toBeGreaterThan(late.getTime())
    }
  })
  it('uses UTC quiet hours when the timezone is unknown', () => {
    expect(decideSend(base({ now: new Date('2026-11-02T22:00:00Z'), timezone: null })).action).toBe('defer')
  })
  it('defers past the daily cap until the oldest send leaves the window', () => {
    const sentAt = [1, 2, 3].map((h) => new Date(now.getTime() - h * 3600_000))
    const d = decideSend(base({ sentAt }))
    expect(d.action).toBe('defer')
    if (d.action === 'defer') {
      expect(d.why).toBe('cap')
      expect(d.until.getTime()).toBe(sentAt[2].getTime() + 24 * 3600_000)
    }
  })
  it('escalates when opted out, unresolved, or approved straight to the approvers', () => {
    expect(decideSend(base({ optedOut: true }))).toEqual({ action: 'escalate', reason: 'opted-out' })
    expect(decideSend(base({ row: { escalateOnly: false, ownerDiscordId: null, channel: null } }))).toEqual({ action: 'escalate', reason: 'no-owner' })
    expect(decideSend(base({ row: { escalateOnly: true, ownerDiscordId: '111', channel: null } }))).toEqual({ action: 'escalate', reason: 'requested' })
  })
  it('opt-out wins over quiet hours and the cap (nothing is queued for later)', () => {
    expect(decideSend(base({ optedOut: true, now: new Date('2026-11-02T22:00:00Z') })).action).toBe('escalate')
  })
})

describe('message text', () => {
  it('always ends with the footer', () => {
    expect(composeText('  Hello  ', ' Reply STOP to stop. ')).toBe('Hello\n\nReply STOP to stop.')
  })
  it('escalation text names the person, the reason and a link', () => {
    const t = escalationText({ ownerName: 'Member A', ask: 'the plan', recordingId: 'rec1' }, 'opted-out', 'https://example.test')
    expect(t).toContain('Member A')
    expect(t).toContain('opted out')
    expect(t).toContain('https://example.test/admin/calls/rec1')
  })
})

describe('deliverOverChannels fallbacks', () => {
  const msg = { id: 'a'.repeat(25), message: 'hi', footers: { TELEGRAM: 'Reply STOP to stop.', DISCORD: 'Tap Stop to stop.' }, ownerDiscordId: '111', telegramChatId: '555', locale: 'en' }
  const senders = (over: Partial<Senders> = {}): Senders => ({
    telegram: vi.fn(async () => ({ messageId: 42 })),
    discord: vi.fn(async () => ({ channelId: 'c1', messageId: 'm1' })),
    markNoTelegramDm: vi.fn(async () => {}),
    ...over,
  })

  it('sends over Telegram when it works', async () => {
    const s = senders()
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toEqual({ ok: true, channel: 'TELEGRAM', telegramChatId: '555', telegramMessageId: 42 })
    expect(s.discord).not.toHaveBeenCalled()
  })
  it('a Telegram 403 clears the DM permission and falls through to Discord', async () => {
    const s = senders({ telegram: vi.fn(async () => { throw new TelegramApiError('x', 403, 'Forbidden: bot was blocked by the user') }) })
    const r = await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)
    expect(r).toMatchObject({ ok: true, channel: 'DISCORD', discordChannelId: 'c1', discordMessageId: 'm1' })
    expect(s.markNoTelegramDm).toHaveBeenCalledWith('555')
  })
  it('a closed Discord DM (403) is a failed channel, reported without detail', async () => {
    const s = senders({ discord: vi.fn(async () => { throw new DiscordPostError('Cannot send messages to this user (code 50007)', 403) }) })
    const r = await deliverOverChannels(['DISCORD'], msg, s)
    expect(r).toEqual({ ok: false, errors: ['discord: DMs closed'] })
  })
  it('a Telegram error that is NOT a refusal never also goes out on Discord (it may already have posted)', async () => {
    const s = senders({ telegram: vi.fn(async () => { throw new TelegramApiError('x', 500, 'oops') }) })
    const r = await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)
    expect(r).toEqual({ ok: false, errors: ['telegram: send failed'] })
    expect(s.discord).not.toHaveBeenCalled()
    expect(s.markNoTelegramDm).not.toHaveBeenCalled()
  })
  it('each channel gets its own footer', async () => {
    const s = senders()
    await deliverOverChannels(['TELEGRAM'], msg, s)
    expect(vi.mocked(s.telegram).mock.calls[0][1]).toBe('hi\n\nReply STOP to stop.')
    const s2 = senders()
    await deliverOverChannels(['DISCORD'], msg, s2)
    expect(vi.mocked(s2.discord).mock.calls[0][1]).toBe('hi\n\nTap Stop to stop.')
    expect(vi.mocked(s2.discord).mock.calls[0][1]).not.toMatch(/Reply/)
  })
  it('Discord first: a 5xx does not fall back to Telegram, only a closed DM does', async () => {
    const s = senders({ discord: vi.fn(async () => { throw new DiscordPostError('boom', 500) }) })
    const r = await deliverOverChannels(['DISCORD', 'TELEGRAM'], msg, s)
    expect(r.ok).toBe(false)
    expect(s.telegram).not.toHaveBeenCalled()
    const s2 = senders({ discord: vi.fn(async () => { throw new DiscordPostError('Cannot send messages to this user (code 50007)', 403) }) })
    expect(await deliverOverChannels(['DISCORD', 'TELEGRAM'], msg, s2)).toMatchObject({ ok: true, channel: 'TELEGRAM' })
  })
  it('a Telegram refusal then a Discord failure reports failure', async () => {
    const s = senders({
      telegram: vi.fn(async () => { throw new TelegramApiError('x', 403, 'Forbidden') }),
      discord: vi.fn(async () => { throw new DiscordPostError('boom', 500) }),
    })
    const r = await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)
    expect(r.ok).toBe(false)
  })
  it('skips Telegram when there is no chat id', async () => {
    const s = senders()
    const r = await deliverOverChannels(['TELEGRAM', 'DISCORD'], { ...msg, telegramChatId: null }, s)
    expect(r).toMatchObject({ ok: true, channel: 'DISCORD' })
    expect(s.telegram).not.toHaveBeenCalled()
  })
})

describe('footerFor', () => {
  it('picks the channel footer', () => {
    const cfg = { footerTelegram: 'T', footerDiscord: 'D' }
    expect(footerFor(cfg, 'TELEGRAM')).toBe('T')
    expect(footerFor(cfg, 'DISCORD')).toBe('D')
  })
})

describe('unknown timezone sending window', () => {
  const cfg = { sendEnabled: true, maxPerDay: 3, quietStartHour: 21, quietEndHour: 9, unknownTzStartHour: 14, unknownTzEndHour: 22 }
  it('only sends 14:00-22:00 UTC', () => {
    expect(decideSend(base({ cfg, timezone: null, now: new Date('2026-11-02T12:00:00Z') })).action).toBe('defer')
    expect(decideSend(base({ cfg, timezone: null, now: new Date('2026-11-02T15:00:00Z') })).action).toBe('send')
    expect(decideSend(base({ cfg, timezone: null, now: new Date('2026-11-02T22:30:00Z') })).action).toBe('defer')
    const d = decideSend(base({ cfg, timezone: 'Not/AZone', now: new Date('2026-11-02T03:00:00Z') }))
    expect(d.action === 'defer' && d.until.getUTCHours()).toBe(14)
  })
  it('a known timezone keeps the normal quiet hours', () => {
    expect(decideSend(base({ cfg, timezone: 'UTC', now: new Date('2026-11-02T12:00:00Z') })).action).toBe('send')
  })
})

describe('stale approvals', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  it('isStale compares against the setting', () => {
    expect(isStale(new Date('2026-11-02T12:00:00Z'), now, 7)).toBe(true)
    expect(isStale(new Date('2026-11-05T12:00:00Z'), now, 7)).toBe(false)
    expect(isStale(null, now, 7)).toBe(false)
  })
  const cfg = {
    sendEnabled: true, maxPerDay: 3, quietStartHour: 21, quietEndHour: 9, approvalMaxDays: 7, footerTelegram: 'T', footerDiscord: 'D',
    unknownTzStartHour: 14, unknownTzEndHour: 22,
  } as unknown as FollowUpConfig
  it('an approval older than the limit is not sent: back to draft with an event', async () => {
    vi.resetAllMocks()
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ id: 'f1', status: 'APPROVED', approvedAt: new Date('2026-11-01T00:00:00Z'), ownerDiscordId: '111' } as never)
    const senders = { telegram: vi.fn(), discord: vi.fn(), markNoTelegramDm: vi.fn() }
    expect(await sendFollowUp('f1', { now, cfg, senders: senders as never })).toBe('stale')
    expect(senders.telegram).not.toHaveBeenCalled()
    expect(senders.discord).not.toHaveBeenCalled()
    expect(prisma.followUp.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', approvedAt: null }) }))
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'stale' }) })
  })
})

describe('delivery-attempt marker', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  const cfg = { sendEnabled: true } as unknown as FollowUpConfig
  it('the claim never matches a row that already has an attempt marker, so it is never auto-resent', async () => {
    vi.resetAllMocks()
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await sendFollowUp('f1', { now, cfg })).toBe('busy')
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'f1', status: 'APPROVED', sendAttemptAt: null }) }))
    expect(prisma.followUp.findUnique).not.toHaveBeenCalled()
  })
  it('an expired lease on a marked row is flagged for a human, not sent', async () => {
    vi.resetAllMocks()
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([{ id: 'f1' }] as never)
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
    expect(await flagStuck(now)).toBe(1)
    expect(prisma.followUp.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'APPROVED', sendAttemptAt: { not: null } }) }))
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }))
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'needs-check' }) })
  })
})

describe('real clock and escalation bound', () => {
  it('the claim lease uses the real clock when no test clock is given', async () => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 0 } as never)
    await sendFollowUp('f1', { cfg: { sendEnabled: true } as unknown as FollowUpConfig })
    expect(vi.mocked(prisma.followUp.updateMany).mock.calls[0][0]).toMatchObject({ data: { sendAfter: new Date('2026-12-01T10:05:00Z') } })
    vi.useRealTimers()
  })
  it('escalation goes to at most 5 contacts', async () => {
    const { escalate } = await import('./send')
    vi.resetAllMocks()
    vi.mocked(prisma.telegramAccount.findMany).mockResolvedValue([] as never)
    const ids = Array.from({ length: 8 }, (_, i) => String(100000 + i))
    const cfg = { escalationDiscordIds: ids } as unknown as FollowUpConfig
    await escalate({ id: 'f1', status: 'UNREACHABLE', ownerName: 'A', ask: 'x', recordingId: null } as never, 'unreachable', cfg, new Date())
    expect(vi.mocked(deliverToContacts).mock.calls[0][0]).toHaveLength(5)
  })
})
