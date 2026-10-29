import { json } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { addAttachment, ATTACHMENT_KINDS, type AttachmentKind } from '@/app/lib/payments/attachments'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { PRIVATE_UPLOAD_MAX_BYTES } from '@/app/lib/private-blob-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A multipart upload cannot use the JSON-only check, so a browser Origin that is not this host is refused. */
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  try {
    return !host || new URL(origin).host !== host
  } catch {
    return true
  }
}

/**
 * POST /api/admin/payments/[id]/attachments (multipart: file, kind)
 * Reviewers only ("add a receipt from the payments mailbox"). Private Blob storage, and only while
 * the `payments.receiptUploadEnabled` setting is on.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  if (crossOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403)
  const policy = await loadPaymentPolicy()
  if (!policy.receiptUploadEnabled) return json({ error: 'Receipt upload is switched off' }, 403)
  const { id } = await ctx.params
  const len = Number(request.headers.get('content-length') ?? 0)
  if (len > PRIVATE_UPLOAD_MAX_BYTES + 64 * 1024) return json({ error: 'File too large. Max 8 MB.' }, 413)
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const kind = String(form?.get('kind') ?? 'RECEIPT')
  if (!(file instanceof File) || !(ATTACHMENT_KINDS as readonly string[]).includes(kind)) return json({ error: 'Invalid request' }, 400)
  try {
    const r = await addAttachment({ requestId: id, bytes: new Uint8Array(await file.arrayBuffer()), kind: kind as AttachmentKind, uploadedBy: g.actor.discordId })
    if (!r.ok) return json({ error: r.error }, r.status)
    return json({ ok: true, id: r.id })
  } catch (e) {
    console.error('[admin payments] attachment failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not save the file' }, 500)
  }
}
