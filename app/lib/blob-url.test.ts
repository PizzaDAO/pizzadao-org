// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { getOwnBlobHost, isOwnBlobUrl } from './blob-url'

const saved = process.env.BLOB_READ_WRITE_TOKEN

describe('blob-url', () => {
  afterEach(() => {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
    else process.env.BLOB_READ_WRITE_TOKEN = saved
  })

  it('derives the store host from the token', () => {
    expect(getOwnBlobHost('vercel_blob_rw_AbC123_secret')).toBe('abc123.public.blob.vercel-storage.com')
    expect(getOwnBlobHost('nope')).toBeNull()
  })

  it('only accepts our own store when the token is set', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_AbC123_secret'
    expect(isOwnBlobUrl('https://abc123.public.blob.vercel-storage.com/suggestions/x.png', '/suggestions/')).toBe(true)
    expect(isOwnBlobUrl('https://other.public.blob.vercel-storage.com/suggestions/x.png', '/suggestions/')).toBe(false)
    expect(isOwnBlobUrl('https://abc123.public.blob.vercel-storage.com/articles/x.png', '/suggestions/')).toBe(false)
  })

  it('rejects non-blob hosts, http, and lookalikes', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    expect(isOwnBlobUrl('https://x.public.blob.vercel-storage.com/a.png')).toBe(true)
    expect(isOwnBlobUrl('http://x.public.blob.vercel-storage.com/a.png')).toBe(false)
    expect(isOwnBlobUrl('https://evil.com/x.public.blob.vercel-storage.com')).toBe(false)
    expect(isOwnBlobUrl('https://public.blob.vercel-storage.com.evil.com/a.png')).toBe(false)
    expect(isOwnBlobUrl('javascript:alert(1)')).toBe(false)
    expect(isOwnBlobUrl('not a url')).toBe(false)
  })
})
