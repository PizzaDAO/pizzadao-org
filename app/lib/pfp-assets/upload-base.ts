// A member's own base-picture upload: dimension-checked, stored under pfp-base/<memberId>/, and
// only the latest few kept (older ones are deleted, except the one the current PFP is built from).
import sharp from 'sharp'
import { del, list } from '@vercel/blob'
import { prisma } from '@/app/lib/db'
import { fileFromForm, uploadImageToBlob } from '@/app/lib/blob-image-upload'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { MAX_PIXELS } from './compose'

export const MAX_BASE_DIMENSION = 4096
export const KEEP_UPLOADS = 5

export async function uploadMemberBase(formData: FormData, memberId: string): Promise<{ url: string }> {
  const file = fileFromForm(formData)
  let meta: sharp.Metadata
  try {
    meta = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: MAX_PIXELS }).metadata()
  } catch {
    throw new ValidationError('Could not read that image', 'file')
  }
  if (!meta.width || !meta.height || meta.width > MAX_BASE_DIMENSION || meta.height > MAX_BASE_DIMENSION) {
    throw new ValidationError(`Image is too large (max ${MAX_BASE_DIMENSION}x${MAX_BASE_DIMENSION} pixels)`, 'file')
  }
  const { url } = await uploadImageToBlob(file, `pfp-base/${memberId}`)
  await pruneBaseUploads(memberId).catch(() => undefined) // best effort
  return { url }
}

export async function pruneBaseUploads(memberId: string, keep = KEEP_UPLOADS): Promise<void> {
  const [{ blobs }, current] = await Promise.all([
    list({ prefix: `pfp-base/${memberId}/`, limit: 100 }),
    prisma.memberPfp.findUnique({ where: { memberId }, select: { baseUrl: true } }),
  ])
  const sorted = [...blobs].sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))
  const stale = sorted.slice(keep).filter((b) => b.url !== current?.baseUrl)
  if (stale.length) await del(stale.map((b) => b.url))
}
