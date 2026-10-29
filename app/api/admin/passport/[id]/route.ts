import { rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { requireAdminAuth, parsePartner } from '@/app/lib/passport/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/passport/[id]: edit a partner. Extra fields:
 *   status: ACTIVE | HIDDEN | CLOSED     bumpQr: true (invalidates printed QR codes)
 *   logoConsent: false clears the logo (revocation)
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminAuth()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await params
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return json({ error: 'Invalid body' }, 400)
  const parsed = parsePartner(b, true)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const v = parsed.value

  const current = await prisma.pizzeria.findUnique({ where: { id } })
  if (!current) return json({ error: 'Not found' }, 404)

  const data: Record<string, unknown> = {}
  for (const k of ['name', 'address', 'city', 'countryCode', 'website', 'stampInk'] as const) {
    if (k in v) data[k] = v[k]
  }
  if (v.lat != null && v.lng != null) {
    data.lat = v.lat
    data.lng = v.lng
  }
  if (typeof b.status === 'string' && ['ACTIVE', 'HIDDEN', 'CLOSED'].includes(b.status)) data.status = b.status
  if (b.bumpQr === true) data.qrVersion = { increment: 1 }

  const consent = 'logoConsent' in v ? v.logoConsent : !!current.logoConsentAt
  const logoUrl = 'logoUrl' in v ? v.logoUrl : current.logoUrl
  if (!consent) {
    data.logoUrl = null
    data.logoConsentAt = null
  } else if (logoUrl) {
    data.logoUrl = logoUrl
    data.logoConsentAt = current.logoConsentAt ?? new Date()
  }

  const updated = await prisma.pizzeria.update({ where: { id }, data })
  return json({ id: updated.id, slug: updated.slug })
}
