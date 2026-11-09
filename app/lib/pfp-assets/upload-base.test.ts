// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

vi.mock('@/app/lib/db', () => ({ prisma: { memberPfp: { findUnique: vi.fn(async () => ({ baseUrl: 'https://s.public.blob.vercel-storage.com/pfp-base/42/keep.png' })) } } }))
vi.mock('@/app/lib/blob-image-upload', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/blob-image-upload')>()),
  uploadImageToBlob: vi.fn(async () => ({ url: 'https://s.public.blob.vercel-storage.com/pfp-base/42/new.png', pathname: '', filename: '' })),
}))
const list = vi.fn()
const del = vi.fn()
vi.mock('@vercel/blob', () => ({ list: (a: unknown) => list(a), del: (a: unknown) => del(a), put: vi.fn() }))

import { uploadMemberBase, pruneBaseUploads } from './upload-base'
import { uploadImageToBlob } from '@/app/lib/blob-image-upload'

const form = async (w: number, h: number) => {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer()
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array(buf)], 'a.png', { type: 'image/png' }))
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue({ blobs: [] })
})

describe('uploadMemberBase', () => {
  it('rejects images over 4096 px a side before uploading', async () => {
    await expect(uploadMemberBase(await form(4097, 10), '42')).rejects.toThrow(/too large/)
    expect(uploadImageToBlob).not.toHaveBeenCalled()
  })
  it('accepts a normal image', async () => {
    expect((await uploadMemberBase(await form(64, 64), '42')).url).toMatch(/pfp-base\/42\//)
  })
})

describe('pruneBaseUploads', () => {
  it('keeps the latest N and the in-use base, deleting the rest', async () => {
    const mk = (n: number, name = `f${n}`) => ({ url: `https://s.public.blob.vercel-storage.com/pfp-base/42/${name}.png`, uploadedAt: new Date(2026, 0, n).toISOString() })
    list.mockResolvedValue({ blobs: [mk(1, 'keep'), mk(2), mk(3), mk(4), mk(5), mk(6), mk(7)] })
    await pruneBaseUploads('42', 3)
    expect(del).toHaveBeenCalledTimes(1)
    const deleted = del.mock.calls[0][0] as string[]
    expect(deleted.map((u) => u.split('/').pop())).toEqual(['f4.png', 'f3.png', 'f2.png'])
  })
})
