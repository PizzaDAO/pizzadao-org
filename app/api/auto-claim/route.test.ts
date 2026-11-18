// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/app/lib/session',() => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/rate-limit', () => ({
  checkKeyedRateLimit: vi.fn(async () => ({ success: true, limit: 10, remaining: 9, reset: 0 })),
  rateLimitResponse: vi.fn(() => new Response('{}', { status: 429 })),
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  MEMBER_COLUMNS: { name: 'name', discordId: 'discordId' },
  cellText: (c: { v?: unknown } | undefined) => String(c?.v ?? ''),
  getMembersTable: vi.fn(),
  membersColumn: vi.fn((_s: unknown, k: string) => (k === 'name' ? 0 : k === 'discordId' ? 1 : null)),
  findMemberRow: vi.fn(),
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
  new Request('https://app.test/api/auto-claim', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  m(getSession).mockResolvedValue({ discordId: '111', nick: 'Pepe Roni', username: 'pepper' })
  m(getMembersTable).mockResolvedValue({ headerRowIndex: 0 })
  m(findMemberRow).mockReturnValue({ c: [{ v: 'Pepe Roni' }, { v: '' }] })
  m(fetchMemberIdByDiscordId).mockResolvedValue(null)
  m(checkKeyedRateLimit).mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 })
})

describe('POST /api/auto-claim', () => {
  it('ignores a body-supplied name', async () => {
    m(getSession).mockResolvedValue({ discordId: '111', nick: 'Someone Else', username: 'other' })
    const res = await POST(req({ memberId: '7', expectedName: 'Pepe Roni' }))
    expect(res.status).toBe(403)
    expect(postMemberWrite).not.toHaveBeenCalled()
  })

  it('claims when the session nick matches', async () => {
    const res = await POST(req({ memberId: '7' }))
    expect(res.status).toBe(200)
    expect(postMemberWrite).toHaveBeenCalledOnce()
  })

  it('claims when only the session username matches', async () => {
    m(getSession).mockResolvedValue({ discordId: '111', nick: 'x', username: ' PEPE roni ' })
    const res = await POST(req({ memberId: '7' }))
    expect(res.status).toBe(200)
  })

  it('refuses a caller already linked to a different member', async () => {
    m(fetchMemberIdByDiscordId).mockResolvedValue('99')
    const res = await POST(req({ memberId: '7' }))
    expect(res.status).toBe(409)
    expect(postMemberWrite).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    m(checkKeyedRateLimit).mockResolvedValue({ success: false, limit: 10, remaining: 0, reset: 0 })
    const res = await POST(req({ memberId: '7' }))
    expect(res.status).toBe(429)
    expect(getMembersTable).not.toHaveBeenCalled()
  })

  it('requires a session', async () => {
    m(getSession).mockResolvedValue(null)
    const res = await POST(req({ memberId: '7' }))
    expect(res.status).toBe(401)
  })
})
