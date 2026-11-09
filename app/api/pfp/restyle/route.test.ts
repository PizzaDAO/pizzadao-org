// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn() }))
vi.mock('@/app/lib/pfp-assets/restyle', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/pfp-assets/restyle')>()),
  restyleForMember: vi.fn(),
}))
vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn() }))

import { getSession } from '@/app/lib/session'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { restyleForMember } from '@/app/lib/pfp-assets/restyle'
import { ApiError } from '@/app/lib/errors/api-errors'
import { POST } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/pfp/restyle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue({ discordId: '400000000000000009' })
  m(fetchMemberIdByDiscordId).mockResolvedValue('42')
  m(restyleForMember).mockResolvedValue({ url: 'https://x/restyle.png', outfitRemaining: 1, dailyRemaining: 2 })
})

describe('POST /api/pfp/restyle', () => {
  it('401 without a session, 403 for non-members, 415/403 for unsafe writes; never generates', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await POST(post({ outfitId: 1, base: { kind: 'static' } }))).status).toBe(401)
    m(getSession).mockResolvedValue({ discordId: '400000000000000009' })
    m(fetchMemberIdByDiscordId).mockResolvedValue(null)
    expect((await POST(post({ outfitId: 1, base: { kind: 'static' } }))).status).toBe(403)
    m(fetchMemberIdByDiscordId).mockResolvedValue('42')
    expect((await POST(post({ outfitId: 1, base: { kind: 'static' } }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(post({ outfitId: 1, base: { kind: 'static' } }, { origin: 'https://evil.test' }))).status).toBe(403)
    expect(restyleForMember).not.toHaveBeenCalled()
  })

  it('uses the session member, validates input, and maps service errors', async () => {
    expect((await POST(post({ outfitId: 'x', base: { kind: 'static' } }))).status).toBe(400)
    expect((await POST(post({ outfitId: 1, base: { kind: 'nope' } }))).status).toBe(400)
    const ok = await POST(post({ memberId: '999', outfitId: 3, base: { kind: 'static' } }))
    expect(ok.status).toBe(200)
    expect(restyleForMember).toHaveBeenCalledWith({ memberId: '42', discordId: '400000000000000009', outfitId: 3, base: { kind: 'static', url: undefined } })
    m(restyleForMember).mockRejectedValue(new ApiError('Not unlocked', 403, 'FORBIDDEN'))
    expect((await POST(post({ outfitId: 3, base: { kind: 'static' } }))).status).toBe(403)
    m(restyleForMember).mockRejectedValue(new ApiError('friendly', 422, 'REFUSED'))
    const r = await POST(post({ outfitId: 3, base: { kind: 'static' } }))
    expect(r.status).toBe(422)
    expect((await r.json()).error).toBe('friendly')
  })
})
