// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from '@/app/lib/settings'
import { loadOwnerContext } from '@/app/lib/followups/store'
import { completeConfirmation, declineMatch, discordPreferLine, getCard, lookupConfirmation, maybeInvite, startConfirmation, RESEND_COOLDOWN_MS } from './host-match-consent'
import { signConfirmToken } from './host-match-token'
import type { DmResult } from './rsv-client'

const ENV = { VERCEL_ENV: 'production', RSV_PIZZA_TELEGRAM_KEY: 'k', FOLLOWUP_LINK_SECRET: 's'.repeat(32), NEXT_PUBLIC_APP_URL: 'https://app.example.test' }
const NOW = new Date('2026-11-10T12:00:00Z')
const D = '11111'
const TG = '5551'

function settings(o: Record<string, unknown>) {
  vi.mocked(prisma.appSetting.findMany).mockResolvedValue(Object.entries(o).map(([key, value]) => ({ key, value })) as never)
  clearSettingsCache({ all: true })
}
const row = (over: Record<string, unknown> = {}) => ({ discordId: D, memberId: 'm1', telegramId: TG, handleHint: 'al…', consent: 'PENDING', invitedAt: null, memberConfirmedAt: null, ...over })
const found = (over: Record<string, unknown> = {}) => vi.mocked(prisma.telegramHostMatch.findUnique).mockResolvedValue(row(over) as never)
type SendArg = { telegramUserId: string; text: string; buttons: Array<Array<{ text: string; url: string }>>; idempotencyKey: string }
const okSend = () => vi.fn(async (_a: SendArg): Promise<DmResult> => ({ ok: true, messageId: 1 }))

beforeEach(() => {
  vi.resetAllMocks()
  settings({ 'telegram.hostMatchEnabled': true })
  vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.telegramAccount.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.telegramHostMatch.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.telegramReach.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.telegramReach.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.memberProfileExtras.findUnique).mockResolvedValue({ locale: 'fr' } as never)
})

describe('getCard', () => {
  it('shows the right state and never the Telegram id', async () => {
    found()
    expect(await getCard(D, ENV)).toEqual({ state: 'pending', handleHint: 'al…', canSend: true })
    found({ memberConfirmedAt: NOW })
    expect((await getCard(D, ENV)).state).toBe('awaiting')
    found({ consent: 'CONFIRMED', memberConfirmedAt: NOW })
    expect((await getCard(D, ENV)).state).toBe('confirmed')
    found()
    expect(JSON.stringify(await getCard(D, ENV))).not.toContain(TG)
  })

  it('shows nothing when off, declined, or when the member has a Telegram login', async () => {
    found({ consent: 'DECLINED' })
    expect((await getCard(D, ENV)).state).toBe('none')
    found()
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue({ discordId: D } as never)
    expect((await getCard(D, ENV)).state).toBe('none')
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
    settings({})
    expect((await getCard(D, ENV)).state).toBe('none')
  })

  it('on a preview the card reads but cannot send', async () => {
    found()
    const env = { ...ENV, VERCEL_ENV: 'preview', TELEGRAM_HOST_MATCH_ENABLED: 'on' }
    expect(await getCard(D, env)).toMatchObject({ state: 'pending', canSend: false })
  })
})

describe('startConfirmation (side a: the member says yes)', () => {
  it('records the click and DMs a signed link to the suggested account, in the member language', async () => {
    found()
    const send = okSend()
    expect(await startConfirmation(D, false, { env: ENV, now: NOW, send })).toBe('sent')
    const a = send.mock.calls[0][0]
    expect(a.telegramUserId).toBe(TG)
    expect(a.text).toMatch(/Confirmez/)
    expect(a.buttons[0][0].url).toMatch(/^https:\/\/app\.example\.test\/telegram\/confirm\//)
    expect(a.text + JSON.stringify(a.buttons)).not.toContain(TG + '"')
    const writes = vi.mocked(prisma.telegramHostMatch.updateMany).mock.calls.map((c) => c[0].data)
    expect(writes).toContainEqual({ memberConfirmedAt: NOW })
    expect(writes).toContainEqual({ invitedAt: NOW })
    // The click alone never confirms anything.
    expect(writes.some((w) => (w as { consent?: string }).consent === 'CONFIRMED')).toBe(false)
  })

  it('does nothing on a preview, with no link secret, with the toggle off, or for a member with a login', async () => {
    found()
    const send = okSend()
    for (const env of [{ ...ENV, VERCEL_ENV: 'preview' }, { ...ENV, FOLLOWUP_LINK_SECRET: undefined }, { ...ENV, RSV_PIZZA_TELEGRAM_KEY: undefined }]) {
      expect(await startConfirmation(D, false, { env, now: NOW, send })).toBe('unavailable')
    }
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue({ discordId: D } as never)
    expect(await startConfirmation(D, false, { env: ENV, now: NOW, send })).toBe('has-login')
    expect(send).not.toHaveBeenCalled()
  })

  it('is not-found for no match, a declined match, and a resend before any click', async () => {
    const send = okSend()
    vi.mocked(prisma.telegramHostMatch.findUnique).mockResolvedValue(null)
    expect(await startConfirmation(D, false, { env: ENV, now: NOW, send })).toBe('not-found')
    found({ consent: 'DECLINED' })
    expect(await startConfirmation(D, false, { env: ENV, now: NOW, send })).toBe('not-found')
    found()
    expect(await startConfirmation(D, true, { env: ENV, now: NOW, send })).toBe('not-found')
    expect(send).not.toHaveBeenCalled()
  })

  it('a second ask inside the cooldown waits', async () => {
    found({ memberConfirmedAt: NOW, invitedAt: new Date(NOW.getTime() - RESEND_COOLDOWN_MS + 1000) })
    const send = okSend()
    expect(await startConfirmation(D, true, { env: ENV, now: NOW, send })).toBe('wait')
    found({ memberConfirmedAt: NOW, invitedAt: new Date(NOW.getTime() - RESEND_COOLDOWN_MS - 1000) })
    expect(await startConfirmation(D, true, { env: ENV, now: NOW, send })).toBe('sent')
  })

  it.each([
    ['not_started', 'not-started'],
    ['blocked', 'blocked'],
    ['rate_limited', 'try-later'],
    ['unavailable', 'try-later'],
    ['bad_request', 'unavailable'],
  ] as const)('maps %s to %s', async (code, out) => {
    found()
    const send = vi.fn(async (): Promise<DmResult> => ({ ok: false, code }))
    expect(await startConfirmation(D, false, { env: ENV, now: NOW, send })).toBe(out)
  })
})

describe('declineMatch', () => {
  it('is final and clears the member click', async () => {
    expect(await declineMatch(D, NOW)).toBe(true)
    expect(vi.mocked(prisma.telegramHostMatch.updateMany).mock.calls[0][0]).toEqual({
      where: { discordId: D, consent: { not: 'DECLINED' } },
      data: { consent: 'DECLINED', decidedAt: NOW, memberConfirmedAt: null },
    })
    vi.mocked(prisma.telegramHostMatch.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await declineMatch(D, NOW)).toBe(false)
  })
})

describe('the confirm link (side b) needs the same Discord session', () => {
  const token = (d = D, tg = TG, at = NOW) => signConfirmToken(d, tg, at, ENV)!

  it('confirms only with the matching session, the right account fingerprint and an open match', async () => {
    found()
    expect(await lookupConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: true, state: 'ready', handleHint: 'al…' })
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: true })
    expect(vi.mocked(prisma.telegramHostMatch.updateMany).mock.calls[0][0]).toEqual({
      where: { discordId: D, telegramId: TG, consent: { in: ['PENDING', 'INVITED'] } },
      data: { consent: 'CONFIRMED', memberConfirmedAt: NOW, decidedAt: NOW },
    })
    // The reach is recorded as OK.
    expect(prisma.telegramReach.upsert).toHaveBeenCalled()
  })

  it('a different logged-in member cannot use the link', async () => {
    found()
    expect(await lookupConfirmation(token(), '22222', { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'wrong-account' })
    expect(await completeConfirmation(token(), '22222', { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'wrong-account' })
    expect(prisma.telegramHostMatch.updateMany).not.toHaveBeenCalled()
  })

  it('rejects forged, expired and stale links', async () => {
    found()
    expect(await completeConfirmation('nope', D, { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'invalid' })
    expect(await completeConfirmation(token(), D, { env: ENV, now: new Date(NOW.getTime() + 49 * 3600_000) })).toEqual({ ok: false, reason: 'expired' })
    // The match changed to another Telegram account after the link was made.
    found({ telegramId: '9999' })
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'closed' })
    expect(prisma.telegramHostMatch.updateMany).not.toHaveBeenCalled()
  })

  it('a declined match, a missing match and a login all refuse', async () => {
    found({ consent: 'DECLINED' })
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'closed' })
    vi.mocked(prisma.telegramHostMatch.findUnique).mockResolvedValue(null)
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'closed' })
    found()
    vi.mocked(prisma.telegramAccount.findFirst).mockResolvedValue({ discordId: '77777' } as never)
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'has-login' })
    expect(prisma.telegramHostMatch.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing while matching is off, and an already confirmed match stays confirmed', async () => {
    found({ consent: 'CONFIRMED' })
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: true })
    expect(prisma.telegramHostMatch.updateMany).not.toHaveBeenCalled()
    settings({})
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('a race that already closed the row does not confirm', async () => {
    found()
    vi.mocked(prisma.telegramHostMatch.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await completeConfirmation(token(), D, { env: ENV, now: NOW })).toEqual({ ok: false, reason: 'closed' })
  })
})

describe('maybeInvite (mode 2)', () => {
  const MODE2 = { 'telegram.hostMatchEnabled': true, 'telegram.hostMatchMode': 2 }

  it('sends at most one invitation: the row is claimed before the send', async () => {
    settings(MODE2)
    found()
    const send = okSend()
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('invited')
    expect(vi.mocked(prisma.telegramHostMatch.updateMany).mock.calls[0][0]).toEqual({ where: { discordId: D, consent: 'PENDING' }, data: { consent: 'INVITED', invitedAt: NOW } })
    expect(send).toHaveBeenCalledTimes(1)
    // The second follow-up finds the row INVITED and sends nothing.
    found({ consent: 'INVITED', invitedAt: NOW })
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('skipped')
    // A parallel run that lost the claim sends nothing either.
    found()
    vi.mocked(prisma.telegramHostMatch.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('skipped')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does nothing in mode 1 (the default), on a preview, or for a confirmed, declined or logged-in member', async () => {
    const send = okSend()
    settings({ 'telegram.hostMatchEnabled': true })
    found()
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('skipped')
    settings(MODE2)
    expect(await maybeInvite(D, { env: { ...ENV, VERCEL_ENV: 'preview', TELEGRAM_HOST_MATCH_ENABLED: 'on' }, now: NOW, send })).toBe('skipped')
    for (const consent of ['CONFIRMED', 'DECLINED', 'INVITED']) {
      found({ consent })
      expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('skipped')
    }
    found()
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue({ discordId: D } as never)
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('puts the row back when nothing was sent, so the invitation can be made later', async () => {
    settings(MODE2)
    found()
    const send = vi.fn(async (): Promise<DmResult> => ({ ok: false, code: 'not_started' }))
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('skipped')
    expect(vi.mocked(prisma.telegramHostMatch.updateMany).mock.calls.at(-1)![0]).toEqual({ where: { discordId: D, consent: 'INVITED' }, data: { consent: 'PENDING', invitedAt: null } })
  })

  it('an uncertain send stays invited (no second invitation)', async () => {
    settings(MODE2)
    found()
    const send = vi.fn(async (): Promise<DmResult> => ({ ok: false, code: 'uncertain' }))
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('invited')
    expect(vi.mocked(prisma.telegramHostMatch.updateMany)).toHaveBeenCalledTimes(1)
  })

  it('does not try an account the bot cannot reach right now', async () => {
    settings(MODE2)
    found()
    vi.mocked(prisma.telegramReach.findUnique).mockResolvedValue({ state: 'BLOCKED', failures: 0, recheckAt: null } as never)
    const send = okSend()
    expect(await maybeInvite(D, { env: ENV, now: NOW, send })).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('discordPreferLine', () => {
  it('adds the line only for an unanswered (PENDING) match', async () => {
    found()
    expect(await discordPreferLine(D, 'm1', ENV)).toBe('Prefer Telegram? Confirm here: https://app.example.test/profile/m1/edit')
    for (const consent of ['INVITED', 'CONFIRMED', 'DECLINED']) {
      found({ consent })
      expect(await discordPreferLine(D, 'm1', ENV)).toBeNull()
    }
    vi.mocked(prisma.telegramHostMatch.findUnique).mockResolvedValue(null)
    expect(await discordPreferLine(D, 'm1', ENV)).toBeNull()
    expect(await discordPreferLine(D, null, ENV)).toBeNull()
  })

  it('is empty when matching is off or the line is blank', async () => {
    found()
    settings({})
    expect(await discordPreferLine(D, 'm1', ENV)).toBeNull()
    settings({ 'telegram.hostMatchEnabled': true, 'telegram.hostMatchDiscordLine': '' })
    expect(await discordPreferLine(D, 'm1', ENV)).toBeNull()
  })
})

describe('a send never uses a match before both sides confirmed it', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.mocked(prisma.memberProfileExtras.findUnique).mockResolvedValue(null)
  })

  it('loadOwnerContext ignores PENDING, INVITED and DECLINED matches (the query asks for CONFIRMED only)', async () => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.telegramHostMatch.findFirst).mockImplementation((async (a: { where: { consent: string } }) => (a.where.consent === 'CONFIRMED' ? null : row({ consent: 'PENDING' }))) as never)
    const ctx = await loadOwnerContext(D, 'm1')
    expect(ctx.telegram).toBeNull()
    expect(vi.mocked(prisma.telegramHostMatch.findFirst).mock.calls[0][0]!.where).toEqual({ discordId: D, consent: 'CONFIRMED' })
  })

  it('uses a CONFIRMED match when there is no login, and a login always wins', async () => {
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.telegramHostMatch.findFirst).mockResolvedValue({ telegramId: TG, memberId: 'm1' } as never)
    expect((await loadOwnerContext(D, 'm1')).telegram?.telegramId).toBe(TG)
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue({ telegramId: '777', memberId: 'm1' } as never)
    expect((await loadOwnerContext(D, 'm1')).telegram?.telegramId).toBe('777')
  })

  it('a confirmed match stops counting when matching is switched off', async () => {
    settings({ 'telegram.hostMatchEnabled': false })
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.telegramHostMatch.findFirst).mockResolvedValue({ telegramId: TG, memberId: 'm1' } as never)
    expect((await loadOwnerContext(D, 'm1')).telegram).toBeNull()
  })
})
