// @vitest-environment node
// L3.1 referral capture end to end (D4), with the sheet, Discord and the DB
// mocked:
//   /join?ref=<memberId>  -> POST /api/referrals/ref sets the httpOnly pd_ref cookie
//   Discord login         -> (the cookie rides along on the same site)
//   onboarding completes  -> POST /api/profile reads the cookie (or the
//                            "Who invited you?" choice) and writes the Referral
//                            row, qualified, then re-runs the inviter's verifier
// Self-referrals write nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const INVITER = { memberId: '42', discordId: '400000000000000042', name: 'Don Pepperoni' }
const INVITEE = '500000000000000077'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/rate-limit')>()),
  enforceRateLimit: vi.fn(async () => null),
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberById: vi.fn(async (id: string) => {
    if (id === INVITER.memberId) return { discordId: INVITER.discordId, Name: INVITER.name }
    if (id === '7') return { discordId: '', Name: 'Unclaimed' }
    return null
  }),
  fetchMemberIdByDiscordId: vi.fn(async () => null),
  invalidateMembersCache: vi.fn(),
}))
vi.mock('@/app/lib/sheet-utils', () => ({ fetchWithRedirect: vi.fn(async () => ({ status: 200, text: '{"ok":true}' })) }))
vi.mock('@/app/lib/city-timezone', () => ({ saveMemberTimezone: vi.fn(async () => true) }))
vi.mock('@/app/lib/discord-webhook', () => ({ sendWelcomeMessage: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/lib/services/discord-api', () => ({ syncDiscordMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ crews: [], cached: true })) }))
vi.mock('@/app/lib/mission-verify/events', () => ({ emitMissionEvent: vi.fn(async () => null) }))
vi.mock('@/app/lib/db', () => ({
  prisma: {
    referral: { create: vi.fn() },
    memberWallet: { findMany: vi.fn(async () => []) },
    xAccount: { findMany: vi.fn(async () => []) },
    telegramAccount: { findMany: vi.fn(async () => []) },
    accountSignal: { findMany: vi.fn(async () => []) },
  },
}))

import { POST as SET_REF, DELETE as CLEAR_REF } from './ref/route'
import { POST as PROFILE } from '../profile/route'
import { getSession } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'
import { emitMissionEvent } from '@/app/lib/mission-verify/events'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { chooseInviter, recordReferral } from '@/app/lib/referrals'

process.env.GOOGLE_SHEETS_WEBAPP_URL = 'https://sheets.example/exec'
process.env.GOOGLE_SHEETS_SHARED_SECRET = 'test-secret'

const create = vi.mocked(prisma.referral.create)

function profileRequest(body: Record<string, unknown>, cookie?: string) {
  return new Request('https://app.pizzadao.org/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ mafiaName: 'Tony Pepperoni', city: 'Lisbon', turtles: ['Leonardo'], crews: [], memberId: '9001', ...body }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({} as never)
  vi.mocked(getSession).mockResolvedValue({ discordId: INVITEE } as never)
})

describe('invite link -> cookie -> onboarding -> Referral row', () => {
  it('POST /api/referrals/ref remembers an onboarded inviter in an httpOnly cookie (30 days, whole site)', async () => {
    const res = await SET_REF(new Request('https://app.pizzadao.org/api/referrals/ref', { method: 'POST', body: JSON.stringify({ ref: '42' }) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, inviter: { memberId: '42', name: 'Don Pepperoni' } })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^pd_ref=42;/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/Max-Age=2592000/)
    expect(cookie).toMatch(/SameSite=lax/i)
  })

  it('refuses refs that are not onboarded members (no cookie)', async () => {
    for (const ref of ['7', '999', 'abc', '']) {
      const res = await SET_REF(new Request('https://app.pizzadao.org/api/referrals/ref', { method: 'POST', body: JSON.stringify({ ref }) }))
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.headers.get('set-cookie')).toBeNull()
    }
    const cleared = await CLEAR_REF(new Request('https://app.pizzadao.org/api/referrals/ref', { method: 'DELETE' }))
    expect(cleared.headers.get('set-cookie')).toMatch(/pd_ref=;.*Max-Age=0/i)
  })

  it('onboarding completion with the cookie writes a qualified invite_link Referral, re-runs the inviter, clears the cookie', async () => {
    const res = await PROFILE(profileRequest({}, 'pd_ref=42; other=1'))
    expect(res.status).toBe(200)
    expect((await res.json()).referral).toEqual({ outcome: 'recorded' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toEqual({
      data: {
        inviteeDiscordId: INVITEE,
        inviteeMemberId: '9001',
        inviterDiscordId: INVITER.discordId,
        inviterMemberId: '42',
        via: 'invite_link',
        inviteCode: '42',
        qualifiedAt: expect.any(Date),
        flags: [],
      },
    })
    expect(emitMissionEvent).toHaveBeenCalledWith(INVITER.discordId, 'referral_created')
    expect(res.headers.get('set-cookie')).toMatch(/pd_ref=;.*Max-Age=0/i)
  })

  it('the "Who invited you?" choice works without a link (via onboarding) and wins over the cookie; "no one" records nothing', async () => {
    await PROFILE(profileRequest({ invitedBy: '42' }))
    expect(create.mock.calls[0][0]).toMatchObject({ data: { via: 'onboarding', inviteCode: null, inviterMemberId: '42' } })

    create.mockClear()
    await PROFILE(profileRequest({ invitedBy: '' }, 'pd_ref=42'))
    expect(create).not.toHaveBeenCalled()
  })

  it('blocks self-referral: your own invite link, or picking yourself, writes nothing', async () => {
    vi.mocked(getSession).mockResolvedValue({ discordId: INVITER.discordId } as never)
    const res = await PROFILE(profileRequest({ memberId: '9002' }, 'pd_ref=42'))
    expect((await res.json()).referral).toEqual({ outcome: 'self_referral' })
    expect(await recordReferral({ inviteeDiscordId: INVITEE, inviteeMemberId: '42', inviterMemberId: '42', via: 'onboarding' })).toEqual({ outcome: 'self_referral' })
    expect(create).not.toHaveBeenCalled()
    expect(emitMissionEvent).not.toHaveBeenCalled()
  })

  it('only a first onboarding counts: a Discord account that already has a members row records nothing', async () => {
    vi.mocked(fetchMemberIdByDiscordId).mockResolvedValueOnce('123')
    await PROFILE(profileRequest({}, 'pd_ref=42'))
    expect(create).not.toHaveBeenCalled()
  })

  it('a second referral for the same invitee keeps the first (unique invitee)', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    const res = await PROFILE(profileRequest({}, 'pd_ref=42'))
    expect((await res.json()).referral).toEqual({ outcome: 'already_referred' })
    expect(emitMissionEvent).not.toHaveBeenCalled()
  })

  it('a wallet the invitee shares with the inviter is stored as a flag (recorded, not blocked)', async () => {
    vi.mocked(prisma.memberWallet.findMany).mockResolvedValueOnce([
      { discordId: INVITER.discordId, memberId: '42', walletAddress: '0xAbC' },
      { discordId: INVITEE, memberId: '9001', walletAddress: '0xabc' },
    ] as never)
    const res = await PROFILE(profileRequest({}, 'pd_ref=42'))
    expect((await res.json()).referral).toEqual({ outcome: 'recorded_flagged' })
    expect(create.mock.calls[0][0]).toMatchObject({ data: { flags: ['shared_wallet'] } })
  })
})

describe('chooseInviter', () => {
  it('explicit choice > cookie; empty choice = no one', () => {
    expect(chooseInviter(undefined, '42')).toEqual({ memberId: '42', via: 'invite_link', inviteCode: '42' })
    expect(chooseInviter('42', '42')).toEqual({ memberId: '42', via: 'invite_link', inviteCode: '42' })
    expect(chooseInviter('43', '42')).toEqual({ memberId: '43', via: 'onboarding', inviteCode: null })
    expect(chooseInviter('', '42')).toEqual({ memberId: null, via: 'onboarding', inviteCode: null })
    expect(chooseInviter(undefined, null)).toEqual({ memberId: null, via: 'onboarding', inviteCode: null })
    expect(chooseInviter(undefined, 'garbage')).toEqual({ memberId: null, via: 'onboarding', inviteCode: null })
  })
})
