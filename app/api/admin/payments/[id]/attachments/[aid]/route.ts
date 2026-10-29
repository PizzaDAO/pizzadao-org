import { json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { readPrivate } from '@/app/lib/private-blob-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/payments/[id]/attachments/[aid]
 * Streams a private attachment to reviewers only. The blob path is never exposed, so copying it
 * gives nothing; the attachment must belong to the request in the URL. Never cached or sniffed.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const { id, aid } = await ctx.params
  const att = await prisma.paymentAttachment.findFirst({ where: { id: aid, requestId: id }, select: { blobPath: true, mime: true, kind: true } })
  if (!att) return json({ error: 'Not found' }, 404)
  const file = await readPrivate(att.blobPath)
  if (!file) return json({ error: 'File unavailable' }, 404)
  return new Response(file.stream, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': att.mime,
      'Content-Disposition': att.mime === 'application/pdf' ? 'attachment; filename="receipt.pdf"' : 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
