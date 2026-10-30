import { describe, it, expect, vi } from 'vitest'
vi.mock('@/app/lib/db')
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => []) }))
vi.mock('./notify', async (orig) => ({ ...(await orig<typeof import('./notify')>()), deliverToContacts: vi.fn(async () => 0) }))

import { DiscordPostError } from '@/app/lib/discord-rest'
import { prisma } from '@/app/lib/db'
import { composeText, decideSend, deliverOverChannels, escalationText, flagStuck, footerFor, isStale, sendFollowUp, UNCONFIRMED_TWICE_TEXT, type DecideInput, type Senders } from './send'
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
  telegramEligible: false,
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
    expect(decideSend(base({ telegramEligible: true }))).toEqual({ action: 'send', channels: ['TELEGRAM', 'DISCORD'] })
  })
  it('honours the reviewer channel, but never Telegram without DM permission', () => {
    expect(decideSend(base({ row: { escalateOnly: false, ownerDiscordId: '111', channel: 'DISCORD' }, telegramEligible: true }))).toEqual({ action: 'send', channels: ['DISCORD', 'TELEGRAM'] })
    expect(decideSend(base({ row: { escalateOnly: false, ownerDiscordId: '111', channel: 'TELEGRAM' }, telegramEligible: false }))).toEqual({ action: 'send', channels: ['DISCORD'] })
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
  const recheck = { dmRecheckDays: 7, dmRecheckMaxDays: 60 }
  const buttons = [[{ text: 'Done', url: 'https://app.example.test/fu/x' }]]
  const msg = {
    id: 'a'.repeat(25), message: 'hi', footers: { TELEGRAM: 'Use the buttons to stop.', DISCORD: 'Tap Stop to stop.' }, ownerDiscordId: '111',
    telegramChatId: '555', telegramButtons: buttons, attemptKey: 'fu:aaa:1', recheck, locale: 'en',
  }
  const senders = (over: Partial<Senders> = {}): Senders => ({
    telegram: vi.fn(async () => ({ ok: true as const, messageId: 42 })),
    discord: vi.fn(async () => ({ channelId: 'c1', messageId: 'm1' })),
    recordReach: vi.fn(async () => {}),
    ...over,
  })
  const tgFail = (code: string, retryAfter?: number) => vi.fn(async () => ({ ok: false as const, code: code as never, retryAfter }))

  it('sends over Telegram when it works, with URL buttons and the idempotency key', async () => {
    const s = senders()
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toEqual({ ok: true, channel: 'TELEGRAM', telegramChatId: '555', telegramMessageId: 42 })
    expect(s.discord).not.toHaveBeenCalled()
    expect(s.telegram).toHaveBeenCalledWith({ telegramUserId: '555', text: 'hi\n\nUse the buttons to stop.', buttons, idempotencyKey: 'fu:aaa:1' })
    expect(s.recordReach).toHaveBeenCalledWith('555', 'ok', recheck)
  })
  it('not_started records the reach and falls through to Discord', async () => {
    const s = senders({ telegram: tgFail('not_started') })
    const r = await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)
    expect(r).toMatchObject({ ok: true, channel: 'DISCORD', discordChannelId: 'c1', discordMessageId: 'm1', telegramSkip: 'not-started' })
    expect(s.recordReach).toHaveBeenCalledWith('555', 'not_started', recheck)
  })
  it('blocked records the reach and falls through to Discord', async () => {
    const s = senders({ telegram: tgFail('blocked') })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toMatchObject({ ok: true, channel: 'DISCORD', telegramSkip: 'blocked' })
    expect(s.recordReach).toHaveBeenCalledWith('555', 'blocked', recheck)
  })
  it('uncertain never also goes out on Discord (it may already have been delivered)', async () => {
    const s = senders({ telegram: tgFail('uncertain') })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toEqual({ ok: false, errors: ['telegram: send failed'], uncertain: true })
    expect(s.discord).not.toHaveBeenCalled()
    expect(s.recordReach).not.toHaveBeenCalled()
  })
  it('a replayed not_started leaves the stored reach alone but still falls through', async () => {
    const s = senders({ telegram: vi.fn(async () => ({ ok: false as const, code: 'not_started' as const, replay: true })) })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toMatchObject({ ok: true, channel: 'DISCORD', keyDone: true })
    expect(s.recordReach).not.toHaveBeenCalled()
  })
  it('a replayed sent result counts as sent without touching the reach', async () => {
    const s = senders({ telegram: vi.fn(async () => ({ ok: true as const, messageId: 9, replay: true })) })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toMatchObject({ ok: true, channel: 'TELEGRAM', telegramMessageId: 9 })
    expect(s.recordReach).not.toHaveBeenCalled()
  })
  it('definite non-sends mark the key done; uncertain does not', async () => {
    for (const code of ['not_started', 'blocked', 'bad_request', 'not_configured']) {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, senders({ telegram: tgFail(code) }))).toMatchObject({ keyDone: true })
    }
    for (const code of ['rate_limited', 'unavailable']) expect(await deliverOverChannels(['TELEGRAM'], msg, senders({ telegram: tgFail(code) }))).toMatchObject({ keyDone: true })
    expect(await deliverOverChannels(['TELEGRAM'], msg, senders({ telegram: tgFail('uncertain') }))).not.toHaveProperty('keyDone')
  })
  it('uncertain is flagged so the row ends FAILED, not escalated', async () => {
    const s = senders({ telegram: tgFail('uncertain') })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toMatchObject({ ok: false, uncertain: true })
  })
  it('rate_limited asks for a retry later and sends nothing on Discord', async () => {
    const s = senders({ telegram: tgFail('rate_limited', 30) })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toMatchObject({ ok: false, retryAfterSec: 30 })
    expect(s.discord).not.toHaveBeenCalled()
  })
  it('a briefly unavailable proxy also retries later (nothing was sent)', async () => {
    const s = senders({ telegram: tgFail('unavailable') })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)).toMatchObject({ ok: false, retryAfterSec: 300 })
    expect(s.discord).not.toHaveBeenCalled()
  })
  it('bad_request and not_configured fall through to Discord', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, senders({ telegram: tgFail('bad_request') }))).toMatchObject({ ok: true, channel: 'DISCORD', telegramSkip: 'bad-request' })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, senders({ telegram: tgFail('not_configured') }))).toMatchObject({ ok: true, channel: 'DISCORD', telegramSkip: 'off' })
  })
  it('a closed Discord DM (403) is a failed channel, reported without detail', async () => {
    const s = senders({ discord: vi.fn(async () => { throw new DiscordPostError('Cannot send messages to this user (code 50007)', 403) }) })
    const r = await deliverOverChannels(['DISCORD'], msg, s)
    expect(r).toEqual({ ok: false, errors: ['discord: DMs closed'] })
  })
  it('each channel gets its own footer', async () => {
    const s = senders()
    await deliverOverChannels(['TELEGRAM'], msg, s)
    expect(vi.mocked(s.telegram).mock.calls[0][0].text).toBe('hi\n\nUse the buttons to stop.')
    const s2 = senders()
    await deliverOverChannels(['DISCORD'], msg, s2)
    expect(vi.mocked(s2.discord).mock.calls[0][1]).toBe('hi\n\nTap Stop to stop.')
  })
  it('Discord gets an "Open in app" link button when a link is given', async () => {
    const s = senders()
    await deliverOverChannels(['DISCORD'], { ...msg, discordOpenUrl: 'https://app.example.test/fu/x' }, s)
    const components = JSON.stringify(vi.mocked(s.discord).mock.calls[0][2])
    expect(components).toContain('"style":5')
    expect(components).toContain('https://app.example.test/fu/x')
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
    const s = senders({ telegram: tgFail('blocked'), discord: vi.fn(async () => { throw new DiscordPostError('boom', 500) }) })
    const r = await deliverOverChannels(['TELEGRAM', 'DISCORD'], msg, s)
    expect(r.ok).toBe(false)
  })
  it('skips Telegram when there is no chat id or no buttons', async () => {
    const s = senders()
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], { ...msg, telegramChatId: null }, s)).toMatchObject({ ok: true, channel: 'DISCORD' })
    expect(await deliverOverChannels(['TELEGRAM', 'DISCORD'], { ...msg, telegramButtons: null }, s)).toMatchObject({ ok: true, channel: 'DISCORD' })
    expect(s.telegram).not.toHaveBeenCalled()
  })
})

describe('decideSend: Telegram eligibility', () => {
  it('records why Telegram was left out', () => {
    expect(decideSend(base({ telegramEligible: false, telegramWhy: 'not-started' }))).toEqual({ action: 'send', channels: ['DISCORD'], telegramSkip: 'not-started' })
    expect(decideSend(base({ telegramEligible: true }))).toEqual({ action: 'send', channels: ['TELEGRAM', 'DISCORD'] })
  })
})

describe('composeText limit', () => {
  it('cuts the body so the footer always survives', () => {
    const t = composeText('x'.repeat(5000), 'Use the buttons.', 3500)
    expect(t.length).toBeLessThanOrEqual(3500)
    expect(t.endsWith('\n\nUse the buttons.')).toBe(true)
    expect(t).toContain('…')
    expect(composeText('short', 'F', 3500)).toBe('short\n\nF')
  })
})

describe('sendFollowUp: an uncertain Telegram send', () => {
  const now = new Date('2026-11-10T15:00:00Z') // inside the unknown-timezone window
  const cfg = {
    sendEnabled: true, maxPerDay: 3, quietStartHour: 21, quietEndHour: 9, approvalMaxDays: 7, footerTelegram: 'T', footerDiscord: 'D', unknownTzStartHour: 14, unknownTzEndHour: 22,
    telegramDmEnabled: true, dmRecheckDays: 7, dmRecheckMaxDays: 60, linkTtlDays: 30, snoozeDays: 3, escalationDiscordIds: [],
  } as unknown as FollowUpConfig
  const setup = (telegramAttemptKey: string | null) => {
    vi.resetAllMocks()
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('RSV_PIZZA_TELEGRAM_KEY', 'k')
    vi.stubEnv('FOLLOWUP_LINK_SECRET', 'a'.repeat(32))
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
    vi.mocked(prisma.followUpEvent.count).mockResolvedValue(0 as never)
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.messagingOptOut.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue({ telegramId: '555', memberId: null } as never)
    vi.mocked(prisma.telegramReach.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.memberProfileExtras.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never)
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ id: 'f1', status: 'APPROVED', approvedAt: now, ownerDiscordId: '111', ownerMemberId: null, message: 'hi', escalateOnly: false, channel: null, telegramAttemptKey } as never)
  }
  const senders = () => ({ telegram: vi.fn(async (_a: { idempotencyKey: string }) => ({ ok: false as const, code: 'uncertain' as const })), discord: vi.fn(), recordReach: vi.fn() })
  it('ends FAILED with the check-first text, no Discord copy and no escalation', async () => {
    setup(null)
    const s = senders()
    await sendFollowUp('f1', { now, cfg, senders: s as never })
    expect(s.discord).not.toHaveBeenCalled()
    expect(deliverToContacts).not.toHaveBeenCalled()
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', error: 'A send was started but never confirmed. Check the recipient before approving again.' }) }))
    expect(prisma.followUp.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'UNREACHABLE' }) }))
  })
  const withTelegram = (fn: (a: { idempotencyKey: string }) => Promise<unknown>) => ({ telegram: vi.fn(fn), discord: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })), recordReach: vi.fn() })
  it('a second uncertain answer that is a replay ends FAILED with its own message and clears the key', async () => {
    setup('fu:f1:123456')
    const s = withTelegram(async () => ({ ok: false, code: 'uncertain', replay: true }))
    await sendFollowUp('f1', { now, cfg, senders: s as never })
    expect(s.telegram.mock.calls[0][0].idempotencyKey).toBe('fu:f1:123456')
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', error: UNCONFIRMED_TWICE_TEXT, telegramAttemptKey: null }) }))
    expect(s.discord).not.toHaveBeenCalled()
  })
  it('a first uncertain answer keeps the key for the one replay', async () => {
    setup(null)
    await sendFollowUp('f1', { now, cfg, senders: withTelegram(async () => ({ ok: false, code: 'uncertain' })) as never })
    const failed = vi.mocked(prisma.followUp.updateMany).mock.calls.find((c) => (c[0].data as { status?: string }).status === 'FAILED')!
    expect((failed[0].data as Record<string, unknown>).telegramAttemptKey).toBeUndefined()
  })
  it('a replayed sent result moves the row to SENT', async () => {
    setup('fu:f1:123456')
    const s = withTelegram(async () => ({ ok: true, messageId: 5, replay: true }))
    expect(await sendFollowUp('f1', { now, cfg, senders: s as never })).toBe('sent')
    expect(s.recordReach).not.toHaveBeenCalled()
  })
  it('after bad_request the key is cleared, so the next attempt starts fresh', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup('fu:f1:123456')
    const s = withTelegram(async () => ({ ok: false, code: 'bad_request' }))
    await sendFollowUp('f1', { now, cfg, senders: s as never })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', telegramAttemptKey: null }) }))
    // The next attempt, with the cleared key, builds a new one.
    setup(null)
    const s2 = withTelegram(async () => ({ ok: false, code: 'uncertain' }))
    await sendFollowUp('f1', { now, cfg, senders: s2 as never })
    expect(s2.telegram.mock.calls[0][0].idempotencyKey).toBe(`fu:f1:${now.getTime()}`)
  })
  it('a deferral (rate limit) clears the key', async () => {
    setup('fu:f1:123456')
    await sendFollowUp('f1', { now, cfg, senders: withTelegram(async () => ({ ok: false, code: 'rate_limited', retryAfter: 30 })) as never })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sendAttemptAt: null, telegramAttemptKey: null }) }))
  })
  it('stores the attempt key, and reuses a stored one on the next attempt', async () => {
    setup(null)
    const s1 = senders()
    await sendFollowUp('f1', { now, cfg, senders: s1 as never })
    const key = vi.mocked(s1.telegram).mock.calls[0][0].idempotencyKey
    expect(key).toBe(`fu:f1:${now.getTime()}`)
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith({ where: { id: 'f1', telegramAttemptKey: null }, data: { telegramAttemptKey: key } })
    setup('fu:f1:123456')
    const s2 = senders()
    await sendFollowUp('f1', { now, cfg, senders: s2 as never })
    expect(vi.mocked(s2.telegram).mock.calls[0][0].idempotencyKey).toBe('fu:f1:123456')
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
    const senders = { telegram: vi.fn(), discord: vi.fn(), recordReach: vi.fn() }
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
