// @vitest-environment node
// Lane cards: POST /api/profile pins the picked lane on a member's FIRST onboarding (body slug, else the
// pd_lane cookie), only for a published lane while the setting is on, and never fails the save.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  fetchMemberById: vi.fn(async () => null),
  fetchMemberIdByDiscordId: vi.fn(async () => null),
  invalidateMembersCache: vi.fn(),
}))
vi.mock('@/app/lib/sheet-utils', () => ({ fetchWithRedirect: vi.fn(async () => ({ status: 200, text: '{"ok":true}' })) }))
vi.mock('@/app/lib/city-timezone', () => ({ saveMemberTimezone: vi.fn(async () => true) }))
vi.mock('@/app/lib/discord-webhook', () => ({ sendWelcomeMessage: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/lib/services/discord-api', () => ({ syncDiscordMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ crews: [], cached: true })) }))
vi.mock('@/app/lib/mission-verify/events', () => ({ emitMissionEvent: vi.fn(async () => null) }))
vi.mock('@/app/lib/referrals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/referrals')>()),
  recordReferral: vi.fn(async () => ({ outcome: 'recorded' })),
}))
const lanesEnabled = vi.fn()
const pinLane = vi.fn()
vi.mock('@/app/lib/lanes', () => ({
  lanesEnabled: () => lanesEnabled(),
  pinLane: (...a: unknown[]) => pinLane(...a),
}))
vi.mock('@/app/lib/db', () => ({
  prisma: {
    memberWallet: { findMany: vi.fn(async () => []) },
    xAccount: { findMany: vi.fn(async () => []) },
    telegramAccount: { findMany: vi.fn(async () => []) },
    accountSignal: { findMany: vi.fn(async () => []) },
    magicLoginToken: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}))

import { POST as PROFILE } from './route'
import { getSession } from '@/app/lib/session'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'

process.env.GOOGLE_SHEETS_WEBAPP_URL = 'https://sheets.example/exec'
process.env.GOOGLE_SHEETS_SHARED_SECRET = 'test-secret'

function profileRequest(body: Record<string, unknown>, cookie?: string) {
  return new Request('https://app.pizzadao.org/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ mafiaName: 'Tony Pepperoni', city: 'Lisbon', turtles: ['Leonardo'], crews: [], memberId: '9001', ...body }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(getSession).mockResolvedValue({ discordId: INVITEE } as never)
  lanesEnabled.mockResolvedValue(true)
  pinLane.mockResolvedValue(true)
})

describe('POST /api/profile lane pin', () => {
  it('pins the lane from the body on a first onboarding, answers with the guide href and clears pd_lane', async () => {
    const res = await PROFILE(profileRequest({ lane: 'host' }, 'pd_lane=host'))
    expect(res.status).toBe(200)
    expect((await res.json()).lane).toEqual({ slug: 'host', href: '/lanes/host' })
    expect(pinLane).toHaveBeenCalledWith(INVITEE, 'host', 'signup')
    expect(res.headers.get('set-cookie')).toMatch(/pd_lane=;.*Max-Age=0/i)
  })

  it('falls back to the pd_lane cookie when the body has no lane', async () => {
    const res = await PROFILE(profileRequest({}, 'pd_lane=build'))
    expect((await res.json()).lane).toEqual({ slug: 'build', href: '/lanes/build' })
    expect(pinLane).toHaveBeenCalledWith(INVITEE, 'build', 'signup')
  })

  it('the body wins over the cookie', async () => {
    await PROFILE(profileRequest({ lane: 'host' }, 'pd_lane=build'))
    expect(pinLane).toHaveBeenCalledWith(INVITEE, 'host', 'signup')
  })

  it('does nothing while the setting is off', async () => {
    lanesEnabled.mockResolvedValue(false)
    const res = await PROFILE(profileRequest({ lane: 'host' }))
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('lane')
    expect(pinLane).not.toHaveBeenCalled()
  })

  it('ignores invalid slugs and lanes that are not published', async () => {
    for (const lane of ['../x', 'Host', 7, 'a'.repeat(40)]) {
      const res = await PROFILE(profileRequest({ lane }))
      expect(await res.json()).not.toHaveProperty('lane')
    }
    expect(pinLane).not.toHaveBeenCalled()
    pinLane.mockResolvedValue(false)
    const res = await PROFILE(profileRequest({ lane: 'draft' }))
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('lane')
  })

  it('never pins on a profile edit (a Discord account that already has a member row)', async () => {
    vi.mocked(fetchMemberIdByDiscordId).mockResolvedValueOnce('123')
    const res = await PROFILE(profileRequest({ lane: 'host' }))
    expect(await res.json()).not.toHaveProperty('lane')
    expect(pinLane).not.toHaveBeenCalled()
  })

  it('never fails the signup when pinning throws', async () => {
    pinLane.mockRejectedValue(new Error('db down'))
    const res = await PROFILE(profileRequest({ lane: 'host' }))
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('lane')
  })

  it('never fails the signup when the setting cannot be read', async () => {
    lanesEnabled.mockRejectedValue(new Error('db down'))
    expect((await PROFILE(profileRequest({ lane: 'host' }))).status).toBe(200)
  })
})
