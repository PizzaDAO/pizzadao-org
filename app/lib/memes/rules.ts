/**
 * Pure rules for the meme folder (bellpepper-80127): upload validation, text cleaning, the status
 * machine and the report threshold. No database or network here, so every rule is unit-tested.
 */
import { sniffImageType } from '@/app/lib/image-sniff'
import { gifInfo, imageDimensions } from '@/app/lib/image-dimensions'

export const MEME_CATEGORIES = ['benny', 'pizzadao'] as const
export type MemeCategory = (typeof MEME_CATEGORIES)[number]

export const MEME_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN', 'DELETED'] as const
export type MemeStatus = (typeof MEME_STATUSES)[number]

/** Longest side, in pixels. Fixed (not a setting): it bounds what a browser must decode. */
export const MEME_MAX_SIDE_PX = 4096
export const MEME_MAX_CAPTION = 200
export const MEME_MAX_TAGS = 5
export const MEME_MAX_TAG_LENGTH = 24
export const MEME_MAX_NOTE = 300
export const MEME_MAX_REPORT_REASON = 300
/** Reports one member may file per rolling day. Fixed. */
export const MEME_MAX_REPORTS_PER_DAY = 20
export const MEME_PAGE_SIZE = 24
export const MEME_MAX_PAGE_SIZE = 48

export function parseCategory(v: unknown): MemeCategory | null {
  return typeof v === 'string' && (MEME_CATEGORIES as readonly string[]).includes(v) ? (v as MemeCategory) : null
}

export type UploadCheck =
  | { ok: true; mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; ext: 'png' | 'jpg' | 'gif' | 'webp'; width: number; height: number }
  | { ok: false; code: 'empty' | 'too_large' | 'bad_type' | 'bad_dimensions' | 'too_many_pixels' | 'too_many_frames'; error: string }

/**
 * Check the bytes of an upload: size cap, real type from the magic bytes (never the client's file
 * type; PNG, JPEG, WebP and GIF only, no SVG and no PDF), readable dimensions, and at most
 * MEME_MAX_SIDE_PX on either side.
 */
export function validateUpload(bytes: Uint8Array, maxBytes: number, maxGifFrames = 300): UploadCheck {
  if (bytes.byteLength === 0) return { ok: false, code: 'empty', error: 'File is empty' }
  if (bytes.byteLength > maxBytes) {
    return { ok: false, code: 'too_large', error: `File too large. Max ${Math.max(1, Math.floor(maxBytes / (1024 * 1024)))} MB.` }
  }
  const kind = sniffImageType(bytes.subarray(0, 16))
  if (!kind) return { ok: false, code: 'bad_type', error: 'Unsupported file type. Use PNG, JPEG, WebP or GIF.' }
  const size = imageDimensions(bytes, kind.mime)
  if (!size) return { ok: false, code: 'bad_dimensions', error: 'Could not read the image size. Is the file damaged?' }
  if (size.width > MEME_MAX_SIDE_PX || size.height > MEME_MAX_SIDE_PX) {
    return { ok: false, code: 'too_many_pixels', error: `Image too large. Max ${MEME_MAX_SIDE_PX} px on a side.` }
  }
  if (kind.mime === 'image/gif') {
    // Every frame's rectangle counts, not just the logical screen, and the frame count is capped.
    const gif = gifInfo(bytes, maxGifFrames)
    if (!gif) return { ok: false, code: 'bad_dimensions', error: 'Could not read the GIF. Is the file damaged?' }
    if (gif.frames > maxGifFrames) return { ok: false, code: 'too_many_frames', error: `GIF has too many frames. Max ${maxGifFrames}.` }
    if (gif.maxRight > MEME_MAX_SIDE_PX || gif.maxBottom > MEME_MAX_SIDE_PX || gif.maxFrameWidth > MEME_MAX_SIDE_PX || gif.maxFrameHeight > MEME_MAX_SIDE_PX) {
      return { ok: false, code: 'too_many_pixels', error: `Image too large. Max ${MEME_MAX_SIDE_PX} px on a side.` }
    }
  }
  return { ok: true, mime: kind.mime, ext: kind.ext, width: size.width, height: size.height }
}

/** Plain text only: control characters and angle brackets out, spaces collapsed, length capped. Null when empty. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? Array.from(s).slice(0, max).join('') : null
}

/** Up to five short lowercase tags (letters, digits, dashes), de-duplicated. Accepts an array or a comma-separated string. */
export function cleanTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const tag = t.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, MEME_MAX_TAG_LENGTH)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length >= MEME_MAX_TAGS) break
  }
  return out
}

/**
 * Allowed status changes. Only a waiting meme can be approved or rejected; an approved one can be
 * hidden (by a capo or by reports) and a hidden one restored, rejected or cleared again. The owner can
 * delete from any live state. DELETED and REJECTED are final.
 */
const TRANSITIONS: Record<MemeStatus, readonly MemeStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'DELETED'],
  APPROVED: ['HIDDEN', 'DELETED'],
  HIDDEN: ['APPROVED', 'REJECTED', 'DELETED'],
  REJECTED: [],
  DELETED: [],
}

export function canTransition(from: string, to: MemeStatus): boolean {
  return (TRANSITIONS[from as MemeStatus] ?? []).includes(to)
}

/** An approved meme is hidden once this many different members have reported it. */
export function shouldAutoHide(status: string, distinctReports: number, threshold: number): boolean {
  return status === 'APPROVED' && threshold > 0 && distinctReports >= threshold
}

/** Minimal EXIF APP1 holding only the Orientation tag (so a rotated phone photo still shows upright). */
function orientationSegment(orientation: number): number[] {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = payload.length + 2
  return [0xff, 0xe1, len >> 8, len & 255, ...payload]
}

/** The EXIF Orientation (2 to 8) from an APP1 payload, or 0 when absent, 1, or unreadable. */
function readOrientation(p: Uint8Array): number {
  // "Exif\0\0" then a TIFF header
  if (p.length < 22 || String.fromCharCode(p[0], p[1], p[2], p[3]) !== 'Exif') return 0
  const t = p.subarray(6)
  const le = t[0] === 0x49 && t[1] === 0x49
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return 0
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1])
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0)
  if (u16(2) !== 0x2a) return 0
  const ifd = u32(4)
  if (ifd + 2 > t.length) return 0
  const count = u16(ifd)
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > t.length) return 0
    if (u16(e) === 0x0112) {
      const v = u16(e + 8)
      return v >= 2 && v <= 8 ? v : 0
    }
  }
  return 0
}

/**
 * Remove personal data from a JPEG without re-encoding: EXIF (GPS, camera, times), XMP, Photoshop
 * info and comments all go. Kept: JFIF, ICC colour profile, the Adobe colour transform, and a minimal
 * EXIF holding only the Orientation tag so rotated photos still display upright. Returns null when
 * the file does not parse cleanly: callers must not publish the original bytes then.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)]
  let orientation = 0
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded image data.
      if (orientation) chunks.push(Uint8Array.from(orientationSegment(orientation)))
      chunks.push(bytes.subarray(i))
      return Buffer.concat(chunks)
    }
    if (marker === 0xd9 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return null
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (len < 2 || i + 2 + len > bytes.length) return null
    const payload = bytes.subarray(i + 4, i + 2 + len)
    const tagText = (n: number) => String.fromCharCode(...Array.from(payload.subarray(0, n)))
    if (marker === 0xe1) {
      orientation = orientation || readOrientation(payload)
    } else {
      const isApp = marker >= 0xe0 && marker <= 0xef
      const keep = !isApp ? marker !== 0xfe : marker === 0xe0 || (marker === 0xe2 && tagText(12) === 'ICC_PROFILE\0') || (marker === 0xee && tagText(5) === 'Adobe')
      if (keep) chunks.push(bytes.subarray(i, i + 2 + len))
    }
    i += 2 + len
  }
  return null
}
