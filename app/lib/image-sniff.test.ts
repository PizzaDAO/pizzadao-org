// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sniffImageType, sniffImageFile } from './image-sniff'

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

describe('sniffImageType', () => {
  it('detects PNG', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))?.mime).toBe('image/png')
  })
  it('detects JPEG', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))?.ext).toBe('jpg')
  })
  it('detects GIF87a and GIF89a', () => {
    expect(sniffImageType(bytes(...ascii('GIF87a')))?.mime).toBe('image/gif')
    expect(sniffImageType(bytes(...ascii('GIF89a')))?.mime).toBe('image/gif')
  })
  it('detects WebP', () => {
    expect(sniffImageType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')))?.mime).toBe('image/webp')
  })
  it('rejects RIFF that is not WebP (e.g. WAV/AVI)', () => {
    expect(sniffImageType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull()
  })
  it('rejects SVG, HTML, empty and truncated input', () => {
    expect(sniffImageType(bytes(...ascii('<svg xmlns="')))).toBeNull()
    expect(sniffImageType(bytes(...ascii('<!DOCTYPE html>')))).toBeNull()
    expect(sniffImageType(bytes())).toBeNull()
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e))).toBeNull()
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull()
  })
})

describe('sniffImageFile', () => {
  it('ignores the declared MIME type', async () => {
    const html = new File(['<script>alert(1)</script>'], 'x.png', { type: 'image/png' })
    expect(await sniffImageFile(html)).toBeNull()

    const png = new File([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2)], 'x.txt', { type: 'text/plain' })
    expect(await sniffImageFile(png)).toEqual({ mime: 'image/png', ext: 'png' })
  })
})
