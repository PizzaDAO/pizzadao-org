// Asset art upload: PNG/WebP only, <= 5MB, magic-byte sniffed, square, and (except backgrounds)
// carrying an alpha channel so a flattened layer cannot hide the PFP underneath.
import sharp from 'sharp'
import { fileFromForm, uploadImageToBlob, IMAGE_UPLOAD_MAX_BYTES } from '@/app/lib/blob-image-upload'
import { sniffImageFile } from '@/app/lib/image-sniff'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { isAssetKind } from './types'

export const MIN_ART_SIZE = 256
export const MAX_ART_SIZE = 4096

export async function uploadAssetArt(formData: FormData, actorId: string): Promise<{ url: string; width: number; height: number }> {
  const file = fileFromForm(formData)
  const kindRaw = formData.get('kind')
  const kind = kindRaw === null || kindRaw === '' ? null : String(kindRaw)
  if (kind !== null && !isAssetKind(kind)) throw new ValidationError('Unknown kind', 'kind')
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) throw new ValidationError('File too large. Max 5 MB.', 'file')

  const sniffed = await sniffImageFile(file)
  if (!sniffed || (sniffed.mime !== 'image/png' && sniffed.mime !== 'image/webp')) {
    throw new ValidationError('Use a PNG or WebP image', 'file')
  }
  let meta: sharp.Metadata
  try {
    meta = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: MAX_ART_SIZE * MAX_ART_SIZE }).metadata()
  } catch {
    throw new ValidationError('Could not read that image', 'file')
  }
  const { width = 0, height = 0 } = meta
  if (width !== height) throw new ValidationError('Art must be square (1024x1024 recommended)', 'file')
  if (width < MIN_ART_SIZE || width > MAX_ART_SIZE) {
    throw new ValidationError(`Art must be between ${MIN_ART_SIZE} and ${MAX_ART_SIZE} pixels`, 'file')
  }
  if (kind !== 'background' && !meta.hasAlpha) {
    throw new ValidationError('This layer needs a transparent background (PNG or WebP with alpha)', 'file')
  }
  const { url } = await uploadImageToBlob(file, `pfp-assets/${actorId}`)
  return { url, width, height }
}
