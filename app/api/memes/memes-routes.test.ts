// @vitest-environment node
// Gates on the meme routes: session, feature switch, level gate, same-origin, reviewer-only moderation,
// and who may read a private file. The service is mocked; its own rules are tested in app/lib/memes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const session = vi.hoisted(() => ({ current: { discordId: 'u1' } as { discordId: string } | null }))
vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: vi.fn(async () =>
    session.current ? { ok: true, session: session.current } : { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) },
  ),
}))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn(async () => true) }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => 1) }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn(async () => 2) }))
vi.mock('@/app/lib/level-display', () => ({ completedLevel: (n: number) => n - 1 }))
vi.mock('@/app/lib/disavow/access', () => ({ isDisavowSubject: vi.fn(async () => false) }))
vi.mock('@/app/lib/mission-review-access', () => ({
  isDreadPizzaRoberts: vi.fn(async () => false),
  resolveRoles: vi.fn(async () => []),
  holdsAny: vi.fn(async () => false),
}))
vi.mock('@/app/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => null) }))
vi.mock('@/app/lib/private-blob-upload', () => ({ PRIVATE_UPLOAD_MAX_BYTES: 8 * 1024 * 1024, readPrivate: vi.fn() }))
vi.mock('@/app/lib/memes/service', () => ({
  MEME_TABS: ['all', 'benny', 'pizzadao', 'mine'],
  listMemes: vi.fn(async () => ({ items: [], nextCursor: null })),
  pendingCount: vi.fn(async () => 3),
  createMeme: vi.fn(async () => ({ ok: true, value: { id: 'm1', status: 'PENDING' } })),
  reviewMeme: vi.fn(async () => ({ ok: true, value: { status: 'APPROVED' } })),
  reviewQueue: vi.fn(async () => ({ items: [] })),
  reportMeme: vi.fn(async () => ({ ok: true, value: { hidden: false } })),
  deleteOwnMeme: vi.fn(async () => ({ ok: true, value: null })),
  updateOwnMeme: vi.fn(async () => ({ ok: true, value: null })),
  privateFileFor: vi.fn(),
}))

import { toggleEnabled } from '@/app/lib/settings/toggles'
import { getSetting } from '@/app/lib/settings'
import { getCurrentLevel } from '@/app/lib/missions'
import { isDisavowSubject } from '@/app/lib/disavow/access'
import { holdsAny, isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { readPrivate } from '@/app/lib/private-blob-upload'
import { createMeme, privateFileFor, reviewMeme } from '@/app/lib/memes/service'
import { GET as list } from './route'
import { POST as upload } from './upload/route'
import { GET as reviewGet, POST as reviewPost } from './review/route'
import { GET as fileGet } from './[id]/file/route'
import { POST as report } from './[id]/report/route'

const ctx = (id = 'm1') => ({ params: Promise.resolve({ id }) })
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function uploadReq(fields: Record<string, string | Blob> = {}, headers: Record<string, string> = {}) {
  const form = new FormData()
  form.set('file', new File([PNG_BYTES], 'a.png', { type: 'image/png' }))
  form.set('category', 'benny')
  form.set('rights', 'true')
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request('http://localhost/api/memes/upload', { method: 'POST', body: form, headers }) as never
}
const jsonReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/memes/review', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  session.current = { discordId: 'u1' }
  vi.mocked(toggleEnabled).mockResolvedValue(true)
  vi.mocked(getSetting).mockResolvedValue(1 as never)
  vi.mocked(getCurrentLevel).mockResolvedValue(2 as never)
  vi.mocked(isDisavowSubject).mockResolvedValue(false)
  vi.mocked(isDreadPizzaRoberts).mockResolvedValue(false)
  vi.mocked(holdsAny).mockResolvedValue(false)
  vi.mocked(enforceRateLimit).mockResolvedValue(null)
})

describe('upload gates', () => {
  it('401 with no session', async () => {
    session.current = null
    expect((await upload(uploadReq())).status).toBe(401)
    expect(createMeme).not.toHaveBeenCalled()
  })

  it('404 while the feature is off', async () => {
    vi.mocked(toggleEnabled).mockResolvedValue(false)
    expect((await upload(uploadReq())).status).toBe(404)
    expect(createMeme).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin upload', async () => {
    expect((await upload(uploadReq({}, { origin: 'https://evil.example', host: 'localhost' }))).status).toBe(403)
    expect(createMeme).not.toHaveBeenCalled()
  })

  it('passes the IP rate limit response through', async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue(NextResponse.json({ error: 'slow down' }, { status: 429 }))
    expect((await upload(uploadReq())).status).toBe(429)
    expect(createMeme).not.toHaveBeenCalled()
  })

  it('403 below the level gate (completed level 0, needs 1)', async () => {
    vi.mocked(getCurrentLevel).mockResolvedValue(1 as never)
    const res = await upload(uploadReq())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'level', minLevel: 1 })
    expect(createMeme).not.toHaveBeenCalled()
  })

  it('fails closed when the level cannot be read', async () => {
    vi.mocked(getCurrentLevel).mockRejectedValue(new Error('db down'))
    expect((await upload(uploadReq())).status).toBe(403)
  })

  it('403 for a disavowed member, and when the disavow lookup fails', async () => {
    vi.mocked(isDisavowSubject).mockResolvedValue(true)
    expect((await upload(uploadReq())).status).toBe(403)
    vi.mocked(isDisavowSubject).mockRejectedValue(new Error('db down'))
    expect((await upload(uploadReq())).status).toBe(403)
    expect(createMeme).not.toHaveBeenCalled()
  })

  it('needs a file, a valid category and the rights checkbox', async () => {
    expect((await upload(uploadReq({ category: 'memes' }))).status).toBe(400)
    expect((await upload(uploadReq({ rights: 'false' }))).status).toBe(400)
    const noFile = new FormData()
    noFile.set('category', 'benny')
    noFile.set('rights', 'true')
    expect((await upload(new Request('http://localhost/api/memes/upload', { method: 'POST', body: noFile }) as never)).status).toBe(400)
    expect(createMeme).not.toHaveBeenCalled()
  })

  it('refuses an oversized body by its declared length', async () => {
    expect((await upload(uploadReq({}, { 'content-length': String(50 * 1024 * 1024) }))).status).toBe(413)
  })

  it('creates the meme for an eligible member, using the session id and never a client id', async () => {
    const res = await upload(uploadReq({ caption: 'hello', uploaderId: 'someone-else' }))
    expect(res.status).toBe(201)
    expect(vi.mocked(createMeme).mock.calls[0][0]).toMatchObject({ uploaderId: 'u1', category: 'benny', caption: 'hello' })
  })

  it('passes the service refusal status through (cap reached, duplicate, bad file)', async () => {
    vi.mocked(createMeme).mockResolvedValueOnce({ ok: false, status: 429, error: 'Daily upload limit reached.' })
    const res = await upload(uploadReq())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Daily upload limit reached.' })
  })
})

describe('list', () => {
  it('401 signed out, { enabled: false } when off', async () => {
    session.current = null
    expect((await list({ nextUrl: new URL('http://localhost/api/memes') } as never)).status).toBe(401)
    session.current = { discordId: 'u1' }
    vi.mocked(toggleEnabled).mockResolvedValue(false)
    const res = await list({ nextUrl: new URL('http://localhost/api/memes') } as never)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('only reviewers see the waiting count', async () => {
    const url = { nextUrl: new URL('http://localhost/api/memes?meta=1') } as never
    expect((await (await list(url)).json()).meta).toMatchObject({ canUpload: true, reviewer: false, pending: null })
    vi.mocked(holdsAny).mockResolvedValue(true)
    expect((await (await list(url)).json()).meta).toMatchObject({ reviewer: true, pending: 3 })
  })
})

describe('approval queue permissions', () => {
  it('refuses members who are not capos or DPR', async () => {
    expect((await reviewGet()).status).toBe(403)
    expect((await reviewPost(jsonReq({ id: 'm1', action: 'approve' }))).status).toBe(403)
    expect(reviewMeme).not.toHaveBeenCalled()
  })

  it('401 signed out, 404 while off (even for a capo)', async () => {
    vi.mocked(holdsAny).mockResolvedValue(true)
    vi.mocked(toggleEnabled).mockResolvedValue(false)
    expect((await reviewGet()).status).toBe(404)
    vi.mocked(toggleEnabled).mockResolvedValue(true)
    session.current = null
    expect((await reviewGet()).status).toBe(401)
  })

  it('a Pizza Capo can act, and the reviewer id comes from the session', async () => {
    vi.mocked(holdsAny).mockResolvedValue(true)
    const res = await reviewPost(jsonReq({ id: 'm1', action: 'reject', note: 'no' }))
    expect(res.status).toBe(200)
    expect(reviewMeme).toHaveBeenCalledWith({ id: 'm1', action: 'reject', reviewerId: 'u1', note: 'no' })
  })

  it('Dread Pizza Roberts can act too', async () => {
    vi.mocked(isDreadPizzaRoberts).mockResolvedValue(true)
    expect((await reviewGet()).status).toBe(200)
  })

  it('fails closed when the role lookup throws', async () => {
    vi.mocked(holdsAny).mockRejectedValue(new Error('discord down'))
    expect((await reviewGet()).status).toBe(403)
  })

  it('rejects unknown actions and cross-origin or non-JSON writes', async () => {
    vi.mocked(holdsAny).mockResolvedValue(true)
    expect((await reviewPost(jsonReq({ id: 'm1', action: 'delete-everything' }))).status).toBe(400)
    expect((await reviewPost(jsonReq({ id: 'm1', action: 'approve' }, { origin: 'https://evil.example', host: 'localhost' }))).status).toBe(403)
    const form = new Request('http://localhost/api/memes/review', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }) as never
    expect((await reviewPost(form)).status).toBe(415)
    expect(reviewMeme).not.toHaveBeenCalled()
  })
})

describe('private file route', () => {
  const stream = () => new Response(PNG_BYTES).body as ReadableStream<Uint8Array>
  beforeEach(() => {
    vi.mocked(privateFileFor).mockResolvedValue({ uploaderId: 'owner', privatePath: 'memes/pending/owner/a.png', status: 'PENDING' })
    vi.mocked(readPrivate).mockResolvedValue({ stream: stream(), contentType: 'image/png', size: 4 })
  })

  it("refuses another member (404, so the meme's existence is not revealed)", async () => {
    const res = await fileGet({} as never, ctx())
    expect(res.status).toBe(404)
    expect(readPrivate).not.toHaveBeenCalled()
  })

  it('serves the uploader with no-store and nosniff', async () => {
    session.current = { discordId: 'owner' }
    const res = await fileGet({} as never, ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('serves a capo', async () => {
    vi.mocked(holdsAny).mockResolvedValue(true)
    expect((await fileGet({} as never, ctx())).status).toBe(200)
  })

  it('never serves a live or removed meme, or a non-image content type', async () => {
    session.current = { discordId: 'owner' }
    vi.mocked(privateFileFor).mockResolvedValue({ uploaderId: 'owner', privatePath: 'x', status: 'APPROVED' })
    expect((await fileGet({} as never, ctx())).status).toBe(404)
    vi.mocked(privateFileFor).mockResolvedValue({ uploaderId: 'owner', privatePath: 'x', status: 'PENDING' })
    vi.mocked(readPrivate).mockResolvedValue({ stream: stream(), contentType: 'image/svg+xml', size: 4 })
    expect((await fileGet({} as never, ctx())).status).toBe(404)
    vi.mocked(privateFileFor).mockResolvedValue(null)
    expect((await fileGet({} as never, ctx())).status).toBe(404)
  })
})

describe('report route', () => {
  it('needs a session and the feature on; same-origin JSON only', async () => {
    const req = (headers: Record<string, string> = { 'content-type': 'application/json' }) => new Request('http://localhost/api/memes/m1/report', { method: 'POST', headers, body: '{"reason":"spam"}' }) as never
    expect((await report(req(), ctx())).status).toBe(200)
    expect((await report(req({ 'content-type': 'text/plain' }), ctx())).status).toBe(415)
    vi.mocked(toggleEnabled).mockResolvedValue(false)
    expect((await report(req(), ctx())).status).toBe(404)
    vi.mocked(toggleEnabled).mockResolvedValue(true)
    session.current = null
    expect((await report(req(), ctx())).status).toBe(401)
  })
})
