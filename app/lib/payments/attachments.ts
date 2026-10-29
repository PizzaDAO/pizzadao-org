/**
 * Receipts, photos and budget sheets attached to a payment request. Files go to PRIVATE Blob
 * storage only and are read back through an authenticated route. Their sha256 is kept so the same
 * file reused on another request can be flagged. Uploads are off unless the
 * `payments.receiptUploadEnabled` setting is on (it needs a Blob store that supports private files).
 */
import { prisma } from '@/app/lib/db'
import { evaluateRequest } from './checks'
import { PrivateUploadError, uploadPrivate } from '@/app/lib/private-blob-upload'

export const ATTACHMENT_KINDS = ['RECEIPT', 'PHOTO', 'BUDGET', 'OTHER'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const MAX_ATTACHMENTS_PER_REQUEST = 12

export type AddAttachmentResult =
  | { ok: true; id: string; sha256: string }
  | { ok: false; status: 400 | 404 | 409 | 413 | 503; error: string }

export async function addAttachment(args: {
  requestId: string
  bytes: Uint8Array
  kind: AttachmentKind
  uploadedBy: string
}): Promise<AddAttachmentResult> {
  const req = await prisma.paymentRequest.findUnique({ where: { id: args.requestId }, select: { id: true, status: true } })
  if (!req) return { ok: false, status: 404, error: 'Not found' }
  if (req.status === 'PAID' || req.status === 'REJECTED' || req.status === 'WITHDRAWN') {
    return { ok: false, status: 409, error: 'This request is closed' }
  }
  const count = await prisma.paymentAttachment.count({ where: { requestId: args.requestId } })
  if (count >= MAX_ATTACHMENTS_PER_REQUEST) return { ok: false, status: 409, error: 'Too many files on this request' }
  try {
    const up = await uploadPrivate(args.bytes, `payments/${args.requestId}`)
    const row = await prisma.paymentAttachment.create({
      data: { requestId: args.requestId, kind: args.kind, blobPath: up.pathname, sha256: up.sha256, sizeBytes: up.sizeBytes, mime: up.mime, uploadedBy: args.uploadedBy },
      select: { id: true },
    })
    // A new file can change the flags (reused file, receipts present).
    await evaluateRequest(args.requestId).catch((e) => console.error('[payments] check failed:', e instanceof Error ? e.message : e))
    return { ok: true, id: row.id, sha256: up.sha256 }
  } catch (e) {
    if (e instanceof PrivateUploadError) {
      const status = e.code === 'too_large' ? 413 : e.code === 'unavailable' ? 503 : 400
      return { ok: false, status, error: e.message }
    }
    throw e
  }
}
