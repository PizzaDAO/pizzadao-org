/**
 * Pure rules for the meme folder (bellpepper-80127): upload validation, text cleaning, the status
 * machine and the report threshold. No database or network here, so every rule is unit-tested.
 */
import { sniffImageType } from '@/app/lib/image-sniff'
import { imageDimensions } from '@/app/lib/image-dimensions'

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
  | { ok: false; code: 'empty' | 'too_large' | 'bad_type' | 'bad_dimensions' | 'too_many_pixels'; error: string }

/**
 * Check the bytes of an upload: size cap, real type from the magic bytes (never the client's file
 * type; PNG, JPEG, WebP and GIF only, no SVG and no PDF), readable dimensions, and at most
 * MEME_MAX_SIDE_PX on either side.
 */
export function validateUpload(bytes: Uint8Array, maxBytes: number): UploadCheck {
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

/**
 * Drop the segments that carry personal data (APP1: EXIF with GPS and camera, and XMP; APP13:
 * Photoshop info; COM comments) from a JPEG without re-encoding. JFIF, ICC colour profiles and the
 * Adobe colour transform stay so the picture renders the same. Other types, and anything that does
 * not parse, come back unchanged.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)]
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes
    const marker = bytes[i + 1]
    if (marker === 0xda || marker === 0xd9) {
      // Start of scan: the rest is image data.
      chunks.push(bytes.subarray(i))
      return Buffer.concat(chunks)
    }
    if (marker === 0xff) {
      i++
      continue
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (len < 2 || i + 2 + len > bytes.length) return bytes
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe
    if (!drop) chunks.push(bytes.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return bytes
}
