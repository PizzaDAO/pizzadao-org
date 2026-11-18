// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/rate-limit', () => ({
  checkKeyedRateLimit: vi.fn(async () => ({ success: true, limit: 5, remaining: 4, reset: 0 })),
  rateLimitResponse: vi.fn(() => new Response('{}', { status: 429 })),
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  MEMBER_COLUMNS: { discordId: 'discordId' },
  cellText: (c: { v?: unknown } | undefined) => String(c?.v ?? ''),
  getMembersTable: vi.fn(),
  membersColumn: vi.fn(() => 1),
  findMemberRow: vi.fn(),
  rowToRecord: vi.fn(() => ({ Name: 'Pepe Roni' })),
  fetchMemberIdByDiscordId: vi.fn(async () => null),
  invalidateMembersCache: vi.fn(),
}))
vi.mock('@/app/lib/members/writer', () => ({
  memberWritesConfigured: vi.fn(async () => true),
  postMemberWrite: vi.fn(async () => ({ status: 200, text: '{"ok":true}' })),
}))
vi.mock('@/app/lib/discord-roles', () => ({
  getDiscordTurtleRoles: vi.fn(async () => []),
  mergeTurtles: vi.fn(() => []),
  parseTurtlesFromSheet: vi.fn(() => []),
}))
vi.mock('@/app/lib/services/discord-api', () => ({ syncDiscordMember: vi.fn(async () => ({})) }))
vi.mock('@/app/ui/constants', () => ({ TURTLE_ROLE_IDS: {} }))

import { getSession } from '@/app/lib/session'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { fetchMemberIdByDiscordId, findMemberRow, getMembersTable } from '@/app/lib/sheets/member-repository'
import { postMemberWrite } from '@/app/lib/members/writer'
import { POST } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const req = (body: unknown) =>
  new Request('https://app.test/api/claim-member', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CLAIM_PASSWORD = 'right-pass'
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  m(getSession).mockResolvedValue({ discordId: '111', username: 'pepper' })
  m(getMembersTable).mockResolvedValue({ headerRowIndex: 0 })
  m(findMemberRow).mockReturnValue({ c: [{ v: 'Pepe Roni' }, { v: '' }] })
  m(fetchMemberIdByDiscordId).mockResolvedValue(null)
  m(checkKeyedRateLimit).mockResolvedValue({ success: true, limit: 5, remaining: 4, reset: 0 })
})

describe('POST /api/claim-member', () => {
  it('claims with the right password', async () => {
    const res = await POST(req({ memberId: '7', password: 'right-pass' }))
    expect(res.status).toBe(200)
    expect(postMemberWrite).toHaveBeenCalledOnce()
  })

  it('rejects a wrong password with 403', async () => {
    const res = await POST(req({ memberId: '7', password: 'nope' }))
    expect(res.status).toBe(403)
    expect(postMemberWrite).not.toHaveBeenCalled()
  })

  it('rejects a non-string password with 403', async () => {
    const res = await POST(req({ memberId: '7', password: 123 }))
    expect(res.status).toBe(403)
  })

  it('returns 429 before checking the password when rate limited', async () => {
    m(checkKeyedRateLimit).mockResolvedValue({ success: false, limit: 5, remaining: 0, reset: 0 })
    const res = await POST(req({ memberId: '7', password: 'right-pass' }))
    expect(res.status).toBe(429)
    expect(getMembersTable).not.toHaveBeenCalled()
  })

  it('refuses a caller already linked to a different member', async () => {
    m(fetchMemberIdByDiscordId).mockResolvedValue('99')
    const res = await POST(req({ memberId: '7', password: 'right-pass' }))
    expect(res.status).toBe(409)
    expect(postMemberWrite).not.toHaveBeenCalled()
  })
})
