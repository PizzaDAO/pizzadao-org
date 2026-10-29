import { json } from '@/app/lib/admin-guard'
import { requireSession } from '@/app/lib/auth-guards'
import { prisma } from '@/app/lib/db'
import { addAttachment, ATTACHMENT_KINDS, type AttachmentKind } from '@/app/lib/payments/attachments'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { PRIVATE_UPLOAD_MAX_BYTES } from '@/app/lib/private-blob-upload'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
 * POST /api/payments/[id]/attachments (multipart: file, kind) — the requester adds a receipt or photo
 * to their own open request. Private storage only, and only while `payments.receiptUploadEnabled` is on.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  if (crossOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403)
  const policy = await loadPaymentPolicy()
  if (!policy.receiptUploadEnabled) return json({ error: 'Receipt upload is not open yet' }, 403)
  const { id } = await ctx.params
  const own = await prisma.paymentRequest.findFirst({ where: { id, requesterDiscordId: auth.session.discordId }, select: { id: true } })
  if (!own) return json({ error: 'Not found' }, 404)

  const limited = await checkKeyedRateLimit('payments-upload', auth.session.discordId)
  if (!limited.success) return rateLimitResponse(limited)
  if (Number(request.headers.get('content-length') ?? 0) > PRIVATE_UPLOAD_MAX_BYTES + 64 * 1024) return json({ error: 'File too large. Max 8 MB.' }, 413)

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const kind = String(form?.get('kind') ?? 'RECEIPT')
  if (!(file instanceof File) || !(ATTACHMENT_KINDS as readonly string[]).includes(kind)) return json({ error: 'Invalid request' }, 400)
  try {
    const r = await addAttachment({ requestId: id, bytes: new Uint8Array(await file.arrayBuffer()), kind: kind as AttachmentKind, uploadedBy: auth.session.discordId })
    if (!r.ok) return json({ error: r.error }, r.status)
    // The requester gets no hint about what the checks found.
    return json({ ok: true, id: r.id })
  } catch (e) {
    console.error('[payments] attachment failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not save the file' }, 500)
  }
}
