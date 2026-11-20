// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

vi.mock('@/app/lib/db', () => ({ prisma: { memberPfp: { findUnique: vi.fn() } } }))
vi.mock('@/app/lib/pfp-assets/compose', () => ({ fetchImageBytes: vi.fn() }))
vi.mock('@/app/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => null) }))

import { prisma } from '@/app/lib/db'
import { fetchImageBytes } from '@/app/lib/pfp-assets/compose'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { GET, HEAD } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ctx = (memberId: string) => ({ params: Promise.resolve({ memberId }) })
const req = (method = 'GET') => new Request('https://app.test/api/pfp/42/download', { method })
const BLOB = 'https://abc123.public.blob.vercel-storage.com/pfp-composed/42-hash.webp'

beforeEach(() => {
  vi.clearAllMocks()
  m(enforceRateLimit).mockResolvedValue(null)
  m(prisma.memberPfp.findUnique).mockResolvedValue({ composedUrl: BLOB })
})

describe('GET /api/pfp/[memberId]/download', () => {
  it('streams the saved PFP as a square PNG attachment, without a session', async () => {
    const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c00' } }).webp().toBuffer()
    m(fetchImageBytes).mockResolvedValue(webp)
    const res = await GET(req(), ctx('42'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="pizzadao-pfp.png"')
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1024, 1024])
    expect(m(fetchImageBytes)).toHaveBeenCalledWith(BLOB)
  })

  it('404s when the member has no saved PFP (never serves the default)', async () => {
    m(prisma.memberPfp.findUnique).mockResolvedValue(null)
    const res = await GET(req(), ctx('42'))
    expect(res.status).toBe(404)
    expect(fetchImageBytes).not.toHaveBeenCalled()
  })

  it('never fetches a stored URL outside the allowed hosts', async () => {
    m(prisma.memberPfp.findUnique).mockResolvedValue({ composedUrl: 'https://evil.example/x.png' })
    const res = await GET(req(), ctx('42'))
    expect(res.status).toBe(404)
    expect(fetchImageBytes).not.toHaveBeenCalled()
  })

  it('rejects ids that are not plain member ids', async () => {
    const res = await GET(req(), ctx('../etc'))
    expect(res.status).toBe(404)
    expect(prisma.memberPfp.findUnique).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    m(enforceRateLimit).mockResolvedValue(new Response('{}', { status: 429 }))
    const res = await GET(req(), ctx('42'))
    expect(res.status).toBe(429)
    expect(prisma.memberPfp.findUnique).not.toHaveBeenCalled()
  })

  it('502s when the image cannot be loaded', async () => {
    m(fetchImageBytes).mockRejectedValue(new Error('boom'))
    expect((await GET(req(), ctx('42'))).status).toBe(502)
  })
})

describe('HEAD /api/pfp/[memberId]/download', () => {
  it('answers 200 or 404 without fetching the image', async () => {
    expect((await HEAD(req('HEAD'), ctx('42'))).status).toBe(200)
    m(prisma.memberPfp.findUnique).mockResolvedValue(null)
    expect((await HEAD(req('HEAD'), ctx('42'))).status).toBe(404)
    expect(fetchImageBytes).not.toHaveBeenCalled()
  })
})
