// Shared Vercel Blob image upload (article images, shop item images).
// Validates size and the real image type (magic bytes, never the client's
// file.type; PNG/JPEG/GIF/WebP only, deliberately no SVG) and stores the file
// under `<keyPrefix>/<timestamp>-<rand>-<safe-name>.<ext>`.
import { put } from '@vercel/blob'
import { randomBytes } from 'crypto'
import { sniffImageFile } from './image-sniff'
import { ValidationError } from './errors/api-errors'

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

function sanitizeBase(name: string): string {
  // Strip extension, replace disallowed chars, truncate, fallback to 'image'
  const withoutExt = name.replace(/\.[^.]+$/, '')
  const cleaned = withoutExt.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const truncated = cleaned.slice(0, 60)
  return truncated || 'image'
}

/** Read the `file` field of a multipart form, or throw a 400. */
export function fileFromForm(formData: FormData): File {
  const fileField = formData.get('file')
  if (!(fileField instanceof File)) {
    throw new ValidationError('Missing file field in upload', 'file')
  }
  return fileField
}

export async function uploadImageToBlob(
  file: File,
  keyPrefix: string,
): Promise<{ url: string; pathname: string; filename: string }> {
  if (file.size === 0) {
    throw new ValidationError('File is empty', 'file')
  }
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
    throw new ValidationError('File too large. Max 5 MB.', 'file')
  }

  const sniffed = await sniffImageFile(file)
  if (!sniffed) {
    throw new ValidationError('Unsupported file type. Use PNG, JPEG, WebP, or GIF.', 'file')
  }
  const { ext, mime } = sniffed

  const safeBase = sanitizeBase(file.name || 'image')
  const timestamp = Date.now()
  const rand = randomBytes(3).toString('hex')
  const key = `${keyPrefix}/${timestamp}-${rand}-${safeBase}.${ext}`

  const blob = await put(key, file, {
    access: 'public',
    addRandomSuffix: false,
    contentType: mime,
  })

  return { url: blob.url, pathname: blob.pathname, filename: `${safeBase}.${ext}` }
}
