// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { canTransition, cleanTags, cleanText, parseCategory, shouldAutoHide, stripJpegMetadata, validateUpload, MEME_MAX_SIDE_PX } from './rules'

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const png = (w: number, h: number, pad = 0) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(w), ...be32(h), ...new Array(pad).fill(0)])

const MB = 1024 * 1024

describe('validateUpload', () => {
  it('accepts a small PNG and reports its type and size', () => {
    expect(validateUpload(png(100, 80), MB)).toEqual({ ok: true, mime: 'image/png', ext: 'png', width: 100, height: 80 })
  })

  it('rejects empty files', () => {
    expect(validateUpload(new Uint8Array(0), MB)).toMatchObject({ ok: false, code: 'empty' })
  })

  it('rejects files over the cap', () => {
    expect(validateUpload(png(10, 10, 2 * MB), MB)).toMatchObject({ ok: false, code: 'too_large' })
  })

  it('judges the type by magic bytes, not by a name or client type', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(validateUpload(svg, MB)).toMatchObject({ ok: false, code: 'bad_type' })
    const html = new TextEncoder().encode('<!doctype html><title>x</title>')
    expect(validateUpload(html, MB)).toMatchObject({ ok: false, code: 'bad_type' })
    const pdf = new TextEncoder().encode('%PDF-1.7 ....')
    expect(validateUpload(pdf, MB)).toMatchObject({ ok: false, code: 'bad_type' })
  })

  it('rejects an image whose header cannot be read', () => {
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(validateUpload(truncated, MB)).toMatchObject({ ok: false, code: 'bad_dimensions' })
  })

  it('caps pixels per side', () => {
    expect(validateUpload(png(MEME_MAX_SIDE_PX, MEME_MAX_SIDE_PX), MB).ok).toBe(true)
    expect(validateUpload(png(MEME_MAX_SIDE_PX + 1, 100), MB)).toMatchObject({ ok: false, code: 'too_many_pixels' })
    expect(validateUpload(png(100, MEME_MAX_SIDE_PX + 1), MB)).toMatchObject({ ok: false, code: 'too_many_pixels' })
  })
})

describe('text cleaning', () => {
  it('removes markup characters and control characters, collapses spaces and caps length', () => {
    expect(cleanText('  <b>hi</b>\n\tthere  ', 50)).toBe('b hi /b there')
    expect(cleanText('x'.repeat(300), 200)?.length).toBe(200)
    expect(cleanText('   ', 10)).toBeNull()
    expect(cleanText(42, 10)).toBeNull()
  })

  it('keeps at most five distinct, lowercase, short tags', () => {
    expect(cleanTags('Pizza, pizza, Benny!, a b c, , d, e, f, g')).toEqual(['pizza', 'benny', 'a-b-c', 'd', 'e'])
    expect(cleanTags(['X'.repeat(40)])[0].length).toBe(24)
    expect(cleanTags(undefined)).toEqual([])
  })

  it('parses the category strictly', () => {
    expect(parseCategory('benny')).toBe('benny')
    expect(parseCategory('pizzadao')).toBe('pizzadao')
    expect(parseCategory('other')).toBeNull()
    expect(parseCategory(null)).toBeNull()
  })
})

describe('status machine', () => {
  it('lets only a waiting meme be approved or rejected', () => {
    expect(canTransition('PENDING', 'APPROVED')).toBe(true)
    expect(canTransition('PENDING', 'REJECTED')).toBe(true)
    expect(canTransition('APPROVED', 'REJECTED')).toBe(false)
    expect(canTransition('HIDDEN', 'REJECTED')).toBe(true)
    expect(canTransition('REJECTED', 'APPROVED')).toBe(false)
  })

  it('lets a capo hide and restore', () => {
    expect(canTransition('APPROVED', 'HIDDEN')).toBe(true)
    expect(canTransition('HIDDEN', 'APPROVED')).toBe(true)
    expect(canTransition('PENDING', 'HIDDEN')).toBe(false)
  })

  it('treats deleted and rejected as final, and unknown statuses as closed', () => {
    expect(canTransition('DELETED', 'APPROVED')).toBe(false)
    expect(canTransition('DELETED', 'DELETED')).toBe(false)
    expect(canTransition('NONSENSE', 'APPROVED')).toBe(false)
  })
})

describe('auto-hide threshold', () => {
  it('hides an approved meme at the threshold, not before, and nothing else', () => {
    expect(shouldAutoHide('APPROVED', 2, 3)).toBe(false)
    expect(shouldAutoHide('APPROVED', 3, 3)).toBe(true)
    expect(shouldAutoHide('PENDING', 9, 3)).toBe(false)
    expect(shouldAutoHide('HIDDEN', 9, 3)).toBe(false)
    expect(shouldAutoHide('APPROVED', 9, 0)).toBe(false)
  })
})

describe('stripJpegMetadata', () => {
  const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]

  it('drops EXIF (APP1) and comments but keeps JFIF, ICC and the picture data', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xe0, ascii('JFIF\0')),
      ...seg(0xe1, ascii('Exif\0GPS-DATA')),
      ...seg(0xe2, ascii('ICC_PROFILE')),
      ...seg(0xfe, ascii('a comment')),
      0xff, 0xda, 0, 4, 1, 2, 9, 9, 9, 0xff, 0xd9,
    ])
    const out = stripJpegMetadata(jpeg)
    const text = Buffer.from(out).toString('latin1')
    expect(text).not.toContain('GPS-DATA')
    expect(text).not.toContain('a comment')
    expect(text).toContain('JFIF')
    expect(text).toContain('ICC_PROFILE')
    expect(Array.from(out.slice(-3))).toEqual([9, 0xff, 0xd9])
    expect(out.length).toBeLessThan(jpeg.length)
  })

  it('leaves non-JPEG and malformed input unchanged', () => {
    const p = png(10, 10)
    expect(stripJpegMetadata(p)).toBe(p)
    const bad = new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0x56])
    expect(stripJpegMetadata(bad)).toBe(bad)
  })
})
