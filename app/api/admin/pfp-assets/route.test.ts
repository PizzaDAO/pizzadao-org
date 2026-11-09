// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/pfp-assets/catalog', () => ({
  listAssets: vi.fn(async () => []),
  listGrants: vi.fn(async () => []),
  loadRuleOptions: vi.fn(async () => ({ levels: [], missions: [], items: [], roles: [] })),
  recentEvents: vi.fn(async () => []),
  createAsset: vi.fn(async () => ({ id: 1 })),
  updateAsset: vi.fn(async () => ({ id: 1 })),
  deleteAsset: vi.fn(),
  grantAsset: vi.fn(),
  revokeAsset: vi.fn(),
}))
vi.mock('@/app/lib/pfp-assets/upload', () => ({ uploadAssetArt: vi.fn(async () => ({ url: 'u' })) }))

import { getSession } from '@/app/lib/session'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { createAsset, deleteAsset, grantAsset } from '@/app/lib/pfp-assets/catalog'
import { GET, POST } from './route'
import { PATCH, DELETE } from './[id]/route'
import { POST as UPLOAD } from './upload/route'
import { POST as GRANT } from './grants/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/admin/pfp-assets', {
    method,
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const ctx = { params: Promise.resolve({ id: '3' }) }

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue({ discordId: '400000000000000001' })
  m(isDreadPizzaRoberts).mockResolvedValue(true)
})

describe('/api/admin/pfp-assets auth', () => {
  it('401 without a session on every route', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await GET(req('GET'))).status).toBe(401)
    expect((await POST(req('POST', { name: 'x' }))).status).toBe(401)
    expect((await PATCH(req('PATCH', {}), ctx)).status).toBe(401)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)
    expect((await UPLOAD(req('POST'))).status).toBe(401)
    expect((await GRANT(req('POST', {}))).status).toBe(401)
    expect(createAsset).not.toHaveBeenCalled()
  })

  it('403 for non-DPR, with no-store, never touching the catalog', async () => {
    m(isDreadPizzaRoberts).mockResolvedValue(false)
    const r = await POST(req('POST', { name: 'x' }))
    expect(r.status).toBe(403)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect((await GET(req('GET'))).status).toBe(403)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(403)
    expect((await GRANT(req('POST', { assetId: 1, discordId: '123456' }))).status).toBe(403)
    expect(createAsset).not.toHaveBeenCalled()
    expect(deleteAsset).not.toHaveBeenCalled()
    expect(grantAsset).not.toHaveBeenCalled()
  })

  it('rejects non-JSON and cross-origin writes (CSRF)', async () => {
    expect((await POST(req('POST', {}, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(req('POST', {}, { origin: 'https://evil.test' }))).status).toBe(403)
    expect((await UPLOAD(req('POST', undefined, { origin: 'https://evil.test', 'content-type': 'multipart/form-data' }))).status).toBe(403)
    expect(createAsset).not.toHaveBeenCalled()
  })
})

describe('/api/admin/pfp-assets as an admin', () => {
  it('lists, creates with the actor, and rejects a bad id', async () => {
    const list = await (await GET(req('GET'))).json()
    expect(list).toHaveProperty('assets')
    await POST(req('POST', { name: 'Flag' }))
    expect(createAsset).toHaveBeenCalledWith({ name: 'Flag' }, '400000000000000001')
    expect((await PATCH(req('PATCH', {}), { params: Promise.resolve({ id: 'x' }) })).status).toBe(400)
  })
})
