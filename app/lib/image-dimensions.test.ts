// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { imageDimensions } from './image-dimensions'

const bytes = (...n: number[]) => new Uint8Array(n)
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be16 = (n: number) => [(n >>> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, (n >>> 8) & 255]
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

describe('imageDimensions', () => {
  it('reads a PNG IHDR', () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(640), ...be32(480))
    expect(imageDimensions(png, 'image/png')).toEqual({ width: 640, height: 480 })
  })

  it('reads a GIF logical screen', () => {
    const gif = bytes(...ascii('GIF89a'), ...le16(320), ...le16(200), 0, 0, 0)
    expect(imageDimensions(gif, 'image/gif')).toEqual({ width: 320, height: 200 })
  })

  it('reads a JPEG start-of-frame after other segments', () => {
    const jpg = bytes(0xff, 0xd8, 0xff, 0xe1, ...be16(6), 1, 2, 3, 4, 0xff, 0xc0, ...be16(11), 8, ...be16(300), ...be16(500), 3, 0, 0, 0)
    expect(imageDimensions(jpg, 'image/jpeg')).toEqual({ width: 500, height: 300 })
  })

  it('reads WebP VP8X, VP8L and VP8', () => {
    const riff = (chunk: string, body: number[]) => bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), ...be32(body.length), ...body)
    const x = riff('VP8X', [0, 0, 0, 0, 99, 0, 0, 49, 0, 0, 0, 0, 0, 0])
    expect(imageDimensions(x, 'image/webp')).toEqual({ width: 100, height: 50 })
    // VP8L: signature 0x2f, then 14 bits width-1 and 14 bits height-1
    const w = 199
    const h = 99
    const bits = (w | (h << 14)) >>> 0
    const l = riff('VP8L', [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0, 0, 0, 0, 0, 0, 0])
    expect(imageDimensions(l, 'image/webp')).toEqual({ width: 200, height: 100 })
    const lossy = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(256), ...le16(128), 0, 0, 0, 0])
    expect(imageDimensions(lossy, 'image/webp')).toEqual({ width: 256, height: 128 })
  })

  it('returns null for truncated or unknown data', () => {
    expect(imageDimensions(bytes(0x89, 0x50), 'image/png')).toBeNull()
    expect(imageDimensions(bytes(0xff, 0xd8, 0xff), 'image/jpeg')).toBeNull()
    expect(imageDimensions(bytes(1, 2, 3), 'image/svg+xml')).toBeNull()
  })

  it('rejects a zero-sized image', () => {
    const gif = bytes(...ascii('GIF89a'), 0, 0, 0, 0, 0, 0, 0)
    expect(imageDimensions(gif, 'image/gif')).toBeNull()
  })
})
