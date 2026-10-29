// Private Vercel Blob upload for sensitive files (payment receipts and photos).
// Unlike blob-image-upload.ts these are NEVER public: they are stored with access 'private' and
// can only be read back through an authenticated route that streams them. The real file type comes
// from magic bytes, never the client's file.type (PNG/JPEG/GIF/WebP images and PDF; no SVG).
//
// If the project's Blob store does not support private files, `put` throws and callers report
// "private storage unavailable"; they must not fall back to a public upload.
import { get, put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { sha256Hex } from '@/app/lib/payments/hash'
import { sniffImageType } from './image-sniff'

export const PRIVATE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024 // 8 MB

export type PrivateKind = { mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'application/pdf'; ext: 'png' | 'jpg' | 'gif' | 'webp' | 'pdf' }

/** Image or PDF by magic bytes, or null. */
export function sniffPrivateFile(head: Uint8Array): PrivateKind | null {
  if (head.length >= 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d) {
    return { mime: 'application/pdf', ext: 'pdf' }
  }
  return sniffImageType(head)
}

export class PrivateUploadError extends Error {
  constructor(
    readonly code: 'empty' | 'too_large' | 'bad_type' | 'unavailable',
    message: string,
  ) {
    super(message)
  }
}

export async function uploadPrivate(
  bytes: Uint8Array,
  keyPrefix: string,
): Promise<{ pathname: string; sha256: string; sizeBytes: number; mime: string }> {
  if (bytes.byteLength === 0) throw new PrivateUploadError('empty', 'File is empty')
  if (bytes.byteLength > PRIVATE_UPLOAD_MAX_BYTES) throw new PrivateUploadError('too_large', 'File too large. Max 8 MB.')
  const kind = sniffPrivateFile(bytes.slice(0, 16))
  if (!kind) throw new PrivateUploadError('bad_type', 'Unsupported file type. Use PNG, JPEG, WebP, GIF or PDF.')
  const key = `${keyPrefix}/${Date.now()}-${randomBytes(6).toString('hex')}.${kind.ext}`
  try {
    const blob = await put(key, Buffer.from(bytes), { access: 'private', addRandomSuffix: false, contentType: kind.mime })
    return { pathname: blob.pathname, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength, mime: kind.mime }
  } catch {
    throw new PrivateUploadError('unavailable', 'Private file storage is unavailable')
  }
}

/** Stream a private blob back. Null when missing or the store cannot serve it. */
export async function readPrivate(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; size: number } | null> {
  try {
    const r = await get(pathname, { access: 'private' })
    if (!r || r.statusCode !== 200) return null
    return { stream: r.stream, contentType: r.blob.contentType, size: r.blob.size }
  } catch {
    return null
  }
}
