// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@vercel/blob', () => ({ del: vi.fn(), put: vi.fn() }))
vi.mock('@/app/lib/private-blob-upload', () => ({
  PRIVATE_UPLOAD_MAX_BYTES: 8 * 1024 * 1024,
  PrivateUploadError: class extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  },
  uploadPrivate: vi.fn(),
  readPrivate: vi.fn(),
}))
vi.mock('@/app/lib/member-names', () => ({ memberNamesByDiscordId: vi.fn(async () => new Map()) }))

const SETTINGS: Record<string, unknown> = {
  'memes.maxUploadBytes': 4 * 1024 * 1024,
  'memes.maxGifFrames': 300,
  'memes.requireApproval': true,
  'memes.maxUploadsPerDay': 10,
  'memes.maxPending': 20,
  'memes.autoHideReports': 3,
}
vi.mock('@/app/lib/settings', () => ({ loadSettings: vi.fn(async () => ({ get: (k: string) => SETTINGS[k] })) }))

import { del, put } from '@vercel/blob'
import { prisma } from '@/app/lib/db'
import { readPrivate, uploadPrivate } from '@/app/lib/private-blob-upload'
import { createMeme, deleteOwnMeme, listMemes, reportMeme, reviewMeme } from './service'

const m = vi.mocked(prisma.meme)
const r = vi.mocked(prisma.memeReport)

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(64), ...be32(64), 1, 2, 3])
const STORE = 'https://abc123.public.blob.vercel-storage.com'

function streamOf(bytes: Uint8Array) {
  return new Response(Buffer.from(bytes)).body as ReadableStream<Uint8Array>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  Object.assign(SETTINGS, { 'memes.requireApproval': true, 'memes.maxUploadsPerDay': 10, 'memes.maxPending': 20, 'memes.autoHideReports': 3 })
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_abc123_secret')
  m.count.mockResolvedValue(0)
  m.findFirst.mockResolvedValue(null)
  vi.mocked(uploadPrivate).mockResolvedValue({ pathname: 'memes/pending/u1/x.png', sha256: 'h', sizeBytes: 1, mime: 'image/png' })
  m.create.mockResolvedValue({ id: 'm1' } as never)
  m.updateMany.mockResolvedValue({ count: 1 } as never)
  r.deleteMany.mockResolvedValue({ count: 0 } as never)
})

describe('createMeme', () => {
  const input = { uploaderId: 'u1', bytes: PNG, category: 'benny' as const, caption: ' hi ', tags: 'a,b' }

  it('stores the file privately and creates a PENDING row', async () => {
    const res = await createMeme(input)
    expect(res).toEqual({ ok: true, value: { id: 'm1', status: 'PENDING' } })
    expect(uploadPrivate).toHaveBeenCalledWith(PNG, 'memes/pending/u1', undefined)
    expect(m.create.mock.calls[0][0].data).toMatchObject({ uploaderId: 'u1', status: 'PENDING', category: 'benny', caption: 'hi', tags: ['a', 'b'], mime: 'image/png', width: 64, height: 64, privatePath: 'memes/pending/u1/x.png' })
    expect(put).not.toHaveBeenCalled()
  })

  it('refuses a non-image, an oversized file and an oversized image before storing anything', async () => {
    expect(await createMeme({ ...input, bytes: new TextEncoder().encode('<svg/>') })).toMatchObject({ ok: false, status: 400 })
    SETTINGS['memes.maxUploadBytes'] = 10
    expect(await createMeme(input)).toMatchObject({ ok: false, status: 413 })
    SETTINGS['memes.maxUploadBytes'] = 5 * 1024 * 1024
    const huge = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(9000), ...be32(10), 0])
    expect(await createMeme({ ...input, bytes: huge })).toMatchObject({ ok: false, status: 400 })
    expect(uploadPrivate).not.toHaveBeenCalled()
    expect(m.create).not.toHaveBeenCalled()
  })

  it('enforces the daily cap and the waiting cap from the database', async () => {
    m.count.mockResolvedValueOnce(10).mockResolvedValueOnce(0)
    expect(await createMeme(input)).toMatchObject({ ok: false, status: 429 })
    m.count.mockResolvedValueOnce(0).mockResolvedValueOnce(20)
    expect(await createMeme(input)).toMatchObject({ ok: false, status: 429 })
    expect(uploadPrivate).not.toHaveBeenCalled()
  })

  it('refuses an exact duplicate', async () => {
    m.findFirst.mockResolvedValue({ id: 'old' } as never)
    expect(await createMeme(input)).toMatchObject({ ok: false, status: 409, error: 'Already in the folder.' })
    expect(m.findFirst.mock.calls[0][0]?.where?.status).toEqual({ in: ['PENDING', 'APPROVED', 'HIDDEN'] })
  })

  it('publishes straight away when approval is switched off', async () => {
    SETTINGS['memes.requireApproval'] = false
    m.findUnique.mockResolvedValue({ id: 'm1', uploaderId: 'u1', status: 'PENDING', privatePath: 'memes/pending/u1/x.png', publicUrl: null, mime: 'image/png' } as never)
    vi.mocked(readPrivate).mockResolvedValue({ stream: streamOf(PNG), contentType: 'image/png', size: PNG.length })
    vi.mocked(put).mockResolvedValue({ url: `${STORE}/memes/m1.png` } as never)
    expect(await createMeme(input)).toEqual({ ok: true, value: { id: 'm1', status: 'APPROVED' } })
  })
})

describe('reviewMeme', () => {
  const pending = { id: 'm1', uploaderId: 'u1', status: 'PENDING', privatePath: 'memes/pending/u1/x.png', publicUrl: null, mime: 'image/png' }

  it('approve moves the private file to a public URL and removes the private copy', async () => {
    m.findUnique.mockResolvedValue(pending as never)
    vi.mocked(readPrivate).mockResolvedValue({ stream: streamOf(PNG), contentType: 'image/png', size: PNG.length })
    vi.mocked(put).mockResolvedValue({ url: `${STORE}/memes/m1.png` } as never)
    const res = await reviewMeme({ id: 'm1', action: 'approve', reviewerId: 'capo' })
    expect(res).toEqual({ ok: true, value: { status: 'APPROVED' } })
    expect(vi.mocked(put).mock.calls[0][0]).toBe('memes/m1.png')
    expect(vi.mocked(put).mock.calls[0][2]).toMatchObject({ access: 'public', contentType: 'image/png' })
    expect(m.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'm1', status: 'PENDING' }, data: { status: 'APPROVED', publicUrl: `${STORE}/memes/m1.png`, privatePath: null, reviewedBy: 'capo' } })
    expect(del).toHaveBeenCalledWith('memes/pending/u1/x.png', undefined)
  })

  it('approve fails (and changes nothing) when the file cannot be read', async () => {
    m.findUnique.mockResolvedValue(pending as never)
    vi.mocked(readPrivate).mockResolvedValue(null)
    expect(await reviewMeme({ id: 'm1', action: 'approve', reviewerId: 'capo' })).toMatchObject({ ok: false, status: 502 })
    expect(m.updateMany).not.toHaveBeenCalled()
  })

  it('approve only works on a waiting meme', async () => {
    m.findUnique.mockResolvedValue({ ...pending, status: 'APPROVED' } as never)
    expect(await reviewMeme({ id: 'm1', action: 'approve', reviewerId: 'capo' })).toMatchObject({ ok: false, status: 409 })
    m.findUnique.mockResolvedValue({ ...pending, status: 'REJECTED' } as never)
    expect(await reviewMeme({ id: 'm1', action: 'approve', reviewerId: 'capo' })).toMatchObject({ ok: false, status: 409 })
  })

  it('reject deletes the file, keeps the row and stores the note', async () => {
    m.findUnique.mockResolvedValue(pending as never)
    const res = await reviewMeme({ id: 'm1', action: 'reject', reviewerId: 'capo', note: ' not on topic ' })
    expect(res).toEqual({ ok: true, value: { status: 'REJECTED' } })
    expect(m.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', privatePath: null, publicUrl: null, reviewNote: 'not on topic' })
    expect(del).toHaveBeenCalledWith('memes/pending/u1/x.png', undefined)
    expect(m.delete).not.toHaveBeenCalled()
  })

  it('hide makes the private copy first, then updates the row, then deletes the public file', async () => {
    const live = { ...pending, status: 'APPROVED', privatePath: null, publicUrl: `${STORE}/memes/m1.png` }
    m.findUnique.mockResolvedValue(live as never)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from(PNG))))
    vi.mocked(uploadPrivate).mockResolvedValue({ pathname: 'memes/pending/u1/back.png', sha256: 'h', sizeBytes: 1, mime: 'image/png' })
    const order: string[] = []
    vi.mocked(uploadPrivate).mockImplementation(async () => (order.push('private'), { pathname: 'memes/pending/u1/back.png', sha256: 'h', sizeBytes: 1, mime: 'image/png' }))
    m.updateMany.mockImplementation((async () => (order.push('row'), { count: 1 })) as never)
    vi.mocked(del).mockImplementation((async () => void order.push('delete')) as never)
    const res = await reviewMeme({ id: 'm1', action: 'hide', reviewerId: 'capo' })
    expect(res).toEqual({ ok: true, value: { status: 'HIDDEN' } })
    expect(order).toEqual(['private', 'row', 'delete'])
    expect(m.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'HIDDEN', publicUrl: null, privatePath: 'memes/pending/u1/back.png' })
    expect(del).toHaveBeenCalledWith(`${STORE}/memes/m1.png`, undefined)
    vi.unstubAllGlobals()
  })

  it('hide leaves the meme live when the private copy cannot be made (never HIDDEN with no file)', async () => {
    const live = { ...pending, status: 'APPROVED', privatePath: null, publicUrl: `${STORE}/memes/m1.png` }
    m.findUnique.mockResolvedValue(live as never)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await reviewMeme({ id: 'm1', action: 'hide', reviewerId: 'capo' })).toMatchObject({ ok: false, status: 502 })
    expect(m.updateMany).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('approve refuses to publish a JPEG whose metadata cannot be stripped', async () => {
    m.findUnique.mockResolvedValue({ ...pending, mime: 'image/jpeg' } as never)
    vi.mocked(readPrivate).mockResolvedValue({ stream: streamOf(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01])), contentType: 'image/jpeg', size: 5 })
    expect(await reviewMeme({ id: 'm1', action: 'approve', reviewerId: 'capo' })).toMatchObject({ ok: false, status: 502 })
    expect(put).not.toHaveBeenCalled()
  })

  it('uses the dedicated public and private store tokens when set', async () => {
    vi.stubEnv('MEMES_PUBLIC_BLOB_TOKEN', 'vercel_blob_rw_pubstore_x')
    vi.stubEnv('MEMES_PRIVATE_BLOB_TOKEN', 'vercel_blob_rw_privstore_x')
    m.findUnique.mockResolvedValue(pending as never)
    vi.mocked(readPrivate).mockResolvedValue({ stream: streamOf(PNG), contentType: 'image/png', size: PNG.length })
    vi.mocked(put).mockResolvedValue({ url: 'https://pubstore.public.blob.vercel-storage.com/memes/m1.png' } as never)
    const res = await reviewMeme({ id: 'm1', action: 'approve', reviewerId: 'capo' })
    expect(res.ok).toBe(true)
    expect(readPrivate).toHaveBeenCalledWith('memes/pending/u1/x.png', 'vercel_blob_rw_privstore_x')
    expect(vi.mocked(put).mock.calls[0][2]).toMatchObject({ token: 'vercel_blob_rw_pubstore_x' })
    expect(del).toHaveBeenCalledWith('memes/pending/u1/x.png', { token: 'vercel_blob_rw_privstore_x' })
  })

  it('restore only works on a hidden meme', async () => {
    m.findUnique.mockResolvedValue(pending as never)
    expect(await reviewMeme({ id: 'm1', action: 'restore', reviewerId: 'capo' })).toMatchObject({ ok: false, status: 409 })
  })

  it('answers 404 for an unknown meme', async () => {
    m.findUnique.mockResolvedValue(null)
    expect(await reviewMeme({ id: 'nope', action: 'approve', reviewerId: 'capo' })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('reportMeme', () => {
  const live = { id: 'm1', uploaderId: 'u1', status: 'APPROVED' }

  beforeEach(() => {
    r.count.mockResolvedValue(0)
    r.create.mockResolvedValue({} as never)
  })

  it('only approved memes can be reported, and not your own', async () => {
    m.findUnique.mockResolvedValue({ ...live, status: 'PENDING' } as never)
    expect(await reportMeme({ id: 'm1', reporterId: 'u2' })).toMatchObject({ ok: false, status: 404 })
    m.findUnique.mockResolvedValue(live as never)
    expect(await reportMeme({ id: 'm1', reporterId: 'u1' })).toMatchObject({ ok: false, status: 400 })
  })

  it('one report per member per meme', async () => {
    m.findUnique.mockResolvedValue(live as never)
    r.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect(await reportMeme({ id: 'm1', reporterId: 'u2' })).toMatchObject({ ok: false, status: 409 })
  })

  it('limits a member to 20 reports a day', async () => {
    m.findUnique.mockResolvedValue(live as never)
    r.count.mockResolvedValueOnce(20)
    expect(await reportMeme({ id: 'm1', reporterId: 'u2' })).toMatchObject({ ok: false, status: 429 })
    expect(r.create).not.toHaveBeenCalled()
  })

  it('counts distinct reporters and does not hide below the threshold', async () => {
    m.findUnique.mockResolvedValue(live as never)
    r.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2)
    expect(await reportMeme({ id: 'm1', reporterId: 'u2' })).toEqual({ ok: true, value: { hidden: false } })
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { reportCount: 2 } })
  })

  it('hides an approved meme once enough different members have reported it', async () => {
    m.findUnique.mockResolvedValue({ ...live, privatePath: null, publicUrl: `${STORE}/memes/m1.png`, mime: 'image/png' } as never)
    r.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG)))
    const res = await reportMeme({ id: 'm1', reporterId: 'u4' })
    expect(res).toEqual({ ok: true, value: { hidden: true } })
    expect(m.updateMany.mock.calls.some((c) => (c[0] as { data: { status?: string } }).data.status === 'HIDDEN')).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('deleteOwnMeme and listing', () => {
  it('only the uploader can delete, and the files go too', async () => {
    m.findUnique.mockResolvedValue({ id: 'm1', uploaderId: 'u1', status: 'PENDING', privatePath: 'p', publicUrl: null } as never)
    expect(await deleteOwnMeme('m1', 'someone-else')).toMatchObject({ ok: false, status: 404 })
    expect(await deleteOwnMeme('m1', 'u1')).toEqual({ ok: true, value: null })
    expect(del).toHaveBeenCalledWith('p', undefined)
  })

  it('lists approved memes only, selecting columns and never exposing the uploader id', async () => {
    m.findMany.mockResolvedValue([
      { id: 'a', uploaderId: 'u9', category: 'benny', caption: 'c', tags: [], status: 'APPROVED', publicUrl: `${STORE}/memes/a.png`, width: 1, height: 1, reviewNote: null, reportCount: 5, createdAt: new Date('2026-01-01') },
    ] as never)
    const page = await listMemes({ tab: 'benny', viewerId: 'u1', limit: 1 })
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'APPROVED', category: 'benny' }, take: 2 })
    expect(m.findMany.mock.calls[0][0]?.select).not.toHaveProperty('privatePath')
    expect(JSON.stringify(page)).not.toContain('u9')
    expect(page.items[0]).toMatchObject({ url: `${STORE}/memes/a.png`, downloadUrl: `${STORE}/memes/a.png?download=1`, mine: false })
    expect(page.items[0]).not.toHaveProperty('reportCount')
  })

  it('"mine" lists the viewer\'s own and serves waiting files through the authenticated route', async () => {
    m.findMany.mockResolvedValue([
      { id: 'p', uploaderId: 'u1', category: 'benny', caption: null, tags: [], status: 'PENDING', publicUrl: null, width: 1, height: 1, reviewNote: null, reportCount: 0, createdAt: new Date() },
    ] as never)
    const page = await listMemes({ tab: 'mine', viewerId: 'u1' })
    expect(m.findMany.mock.calls[0][0]?.where).toEqual({ uploaderId: 'u1', status: { not: 'DELETED' } })
    expect(page.items[0]).toMatchObject({ url: '/api/memes/p/file', downloadUrl: null, mine: true })
  })

  it('ignores a public URL that is not on our own store', async () => {
    m.findMany.mockResolvedValue([
      { id: 'a', uploaderId: 'u9', category: 'benny', caption: null, tags: [], status: 'APPROVED', publicUrl: 'https://evil.example.com/memes/a.png', width: 1, height: 1, reviewNote: null, reportCount: 0, createdAt: new Date() },
    ] as never)
    expect((await listMemes({ tab: 'all', viewerId: 'u1' })).items[0].url).toBeNull()
  })
})
