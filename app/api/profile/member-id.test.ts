// @vitest-environment node
// POST /api/profile: an account that already owns a member row can only save to that row.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const DISCORD = '500000000000000078'

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
  fetchMemberByDiscordId: vi.fn(async () => null),
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
vi.mock('@/app/lib/lanes', () => ({ lanesEnabled: async () => false, pinLane: vi.fn() }))
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
import { fetchWithRedirect } from '@/app/lib/sheet-utils'

process.env.GOOGLE_SHEETS_WEBAPP_URL = 'https://sheets.example/exec'
process.env.GOOGLE_SHEETS_SHARED_SECRET = 'test-secret'

const req = (memberId: string) =>
  new Request('https://app.pizzadao.org/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mafiaName: 'Tony', city: 'Lisbon', turtles: ['Leonardo'], crews: [], memberId }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(getSession).mockResolvedValue({ discordId: DISCORD } as never)
})

describe('POST /api/profile member id', () => {
  it('rejects a body member id that differs from the one the account already owns', async () => {
    vi.mocked(fetchMemberIdByDiscordId).mockResolvedValue('42')
    const res = await PROFILE(req('9001'))
    expect(res.status).toBe(409)
    expect(fetchWithRedirect).not.toHaveBeenCalled()
  })

  it('lets a new account sign up with a fresh id', async () => {
    vi.mocked(fetchMemberIdByDiscordId).mockResolvedValue(null)
    const res = await PROFILE(req('9001'))
    expect(res.status).toBe(200)
  })
})
