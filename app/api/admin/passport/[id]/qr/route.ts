import QRCode from 'qrcode'
import { json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { requireAdminAuth } from '@/app/lib/passport/admin'
import { qrCodeFor, qrPath } from '@/app/lib/passport/qr'
import { appBaseUrl } from '@/app/lib/slices/config'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/passport/[id]/qr: the table QR as SVG (print-ready). ?format=url returns the link as JSON. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminAuth()
  if (!auth.ok) return auth.response
  const { id } = await params
  const p = await prisma.pizzeria.findUnique({ where: { id } })
  if (!p) return json({ error: 'Not found' }, 404)
  let code: string
  try {
    code = qrCodeFor(p.id, p.qrVersion)
  } catch {
    return json({ error: 'PASSPORT_QR_SECRET is not set' }, 503)
  }
  const origin = appBaseUrl()
  const url = `${origin}${qrPath(p.slug, code)}`
  if (new URL(request.url).searchParams.get('format') === 'url') return json({ url })
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', ...NO_STORE_HEADERS } })
}
