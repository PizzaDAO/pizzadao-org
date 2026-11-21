// app/lib/image-dimensions.ts
// Read an image's pixel size from its header bytes (PNG, JPEG, GIF, WebP), without decoding it.
// Companion to image-sniff.ts: that says what the file is, this says how big. Returns null when the
// header is truncated or malformed (callers treat that as "not a usable image").

export type ImageSize = { width: number; height: number }

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const tag = (b: Uint8Array, o: number, s: string) => b.length >= o + s.length && Array.from(s).every((c, i) => b[o + i] === c.charCodeAt(0))

function png(b: Uint8Array): ImageSize | null {
  // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (b.length < 24 || !tag(b, 12, 'IHDR')) return null
  return { width: u32be(b, 16), height: u32be(b, 20) }
}

function gif(b: Uint8Array): ImageSize | null {
  if (b.length < 10) return null
  return { width: u16le(b, 6), height: u16le(b, 8) }
}

function jpeg(b: Uint8Array): ImageSize | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    let marker = b[i + 1]
    while (marker === 0xff && i + 2 < b.length) {
      i++
      marker = b[i + 1]
    }
    // Start-of-frame markers (not DHT 0xC4, JPG 0xC8, DAC 0xCC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) }
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = u16be(b, i + 2)
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null
  if (tag(b, 12, 'VP8X')) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  if (tag(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (tag(b, 12, 'VP8 ')) {
    // Frame header: 3-byte tag, start code 9d 01 2a, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  return null
}

export function imageDimensions(bytes: Uint8Array, mime: string): ImageSize | null {
  const size = mime === 'image/png' ? png(bytes) : mime === 'image/gif' ? gif(bytes) : mime === 'image/jpeg' ? jpeg(bytes) : mime === 'image/webp' ? webp(bytes) : null
  if (!size || size.width < 1 || size.height < 1) return null
  return size
}
