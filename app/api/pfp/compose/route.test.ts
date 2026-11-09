// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ prisma: { memberPfp: { findUnique: vi.fn(), deleteMany: vi.fn() } } }))
vi.mock('@vercel/blob', () => ({ del: vi.fn(async () => undefined), put: vi.fn(), list: vi.fn() }))
vi.mock('@/app/lib/pfp-assets/compose', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/pfp-assets/compose')>()),
  composeMemberPfp: vi.fn(),
  availableBases: vi.fn(async () => ({ static: null, discord: null, mafia: null })),
}))
vi.mock('@/app/lib/pfp-assets/catalog', () => ({
  listAssets: vi.fn(async () => []),
  hintLookups: vi.fn(async () => ({})),
}))
vi.mock('@/app/lib/pfp-assets/context', () => ({
  loadUnlockContext: vi.fn(async () => ({ level: 1, roleIds: new Set(), approvedMissionIds: new Set(), itemIds: new Set(), grantIds: new Set() })),
}))

import { getSession } from '@/app/lib/session'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { composeMemberPfp } from '@/app/lib/pfp-assets/compose'
import { ForbiddenError } from '@/app/lib/errors/api-errors'
import { prisma } from '@/app/lib/db'
import { del } from '@vercel/blob'
import { GET, POST, DELETE } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/pfp/compose', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue({ discordId: '400000000000000001' })
  m(fetchMemberIdByDiscordId).mockResolvedValue('42')
  m(composeMemberPfp).mockResolvedValue({ composedUrl: 'https://s.public.blob.vercel-storage.com/pfp-composed/42-ab.webp', layers: [] })
})

describe('/api/pfp/compose auth', () => {
  it('401 without a session, for every method, composing nothing', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await GET(new Request('https://app.test/api/pfp/compose'))).status).toBe(401)
    expect((await POST(post({ base: { kind: 'static' }, layers: [] }))).status).toBe(401)
    expect((await DELETE(new Request('https://app.test/api/pfp/compose', { method: 'DELETE' }))).status).toBe(401)
    expect(composeMemberPfp).not.toHaveBeenCalled()
  })

  it('403 for a signed-in non-member (members only)', async () => {
    m(fetchMemberIdByDiscordId).mockResolvedValue(null)
    const r = await POST(post({ base: { kind: 'static' }, layers: [] }))
    expect(r.status).toBe(403)
    expect(composeMemberPfp).not.toHaveBeenCalled()
  })

  it('rejects cross-origin and non-JSON writes', async () => {
    expect((await POST(post({ base: { kind: 'static' } }, { origin: 'https://evil.test' }))).status).toBe(403)
    expect((await POST(post({ base: { kind: 'static' } }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect(composeMemberPfp).not.toHaveBeenCalled()
  })
})

describe('POST /api/pfp/compose', () => {
  it('always composes for the session member; a member id in the body is ignored', async () => {
    const r = await POST(post({ memberId: '999', base: { kind: 'static' }, layers: [{ assetId: 1 }] }))
    expect(r.status).toBe(200)
    expect(composeMemberPfp).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: '42', discordId: '400000000000000001', base: { kind: 'static', url: undefined }, layers: [{ assetId: 1 }] }),
    )
  })

  it('a locked asset surfaces as 403 from the server-side re-check', async () => {
    m(composeMemberPfp).mockRejectedValue(new ForbiddenError('One of the items is not unlocked for you'))
    const r = await POST(post({ base: { kind: 'static' }, layers: [{ assetId: 5 }] }))
    expect(r.status).toBe(403)
    expect(r.headers.get('cache-control')).toContain('no-store')
  })

  it('400 for a missing or unknown base kind', async () => {
    expect((await POST(post({ layers: [] }))).status).toBe(400)
    expect((await POST(post({ base: { kind: 'https://evil.test/x.png' }, layers: [] }))).status).toBe(400)
    expect(composeMemberPfp).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/pfp/compose (reset)', () => {
  const del_ = (headers: Record<string, string> = {}) =>
    new Request('https://app.test/api/pfp/compose', { method: 'DELETE', headers: { 'content-type': 'application/json', host: 'app.test', ...headers }, body: '{}' })

  it('succeeds with a JSON body, drops the row and deletes the composed blob', async () => {
    m(prisma.memberPfp.findUnique).mockResolvedValue({ composedUrl: 'https://s.public.blob.vercel-storage.com/pfp-composed/42-ab.webp' })
    const r = await DELETE(del_())
    expect(r.status).toBe(200)
    expect(prisma.memberPfp.deleteMany).toHaveBeenCalledWith({ where: { memberId: '42' } })
    expect(del).toHaveBeenCalledWith('https://s.public.blob.vercel-storage.com/pfp-composed/42-ab.webp')
  })

  it('still 415 without a JSON content type (server check kept)', async () => {
    expect((await DELETE(del_({ 'content-type': 'text/plain' }))).status).toBe(415)
  })
})
