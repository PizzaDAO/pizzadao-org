import { rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { requireAdminAuth, parsePartner } from '@/app/lib/passport/admin'
import { geocodeAddress } from '@/app/lib/passport/geocode'
import { slugify } from '@/app/lib/passport/qr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/passport: partner pizzerias + check-ins waiting for a reviewer. */
export async function GET() {
  const auth = await requireAdminAuth()
  if (!auth.ok) return auth.response
  const [pizzerias, pending] = await Promise.all([
    prisma.pizzeria.findMany({ where: { isPartner: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.pizzeriaCheckIn.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { pizzeria: { select: { name: true, city: true } } },
    }),
  ])
  return json({
    pizzerias: pizzerias.map((p) => ({ ...p, logoConsent: !!p.logoConsentAt })),
    pending: pending.map((c) => ({
      id: c.id,
      discordId: c.discordId,
      pizzeria: c.pizzeria.name,
      city: c.pizzeria.city,
      method: c.method,
      distanceM: c.distanceM,
      riskFlags: c.riskFlags,
      createdAt: c.createdAt.toISOString(),
    })),
  })
}

/** POST /api/admin/passport: add a partner. Address is geocoded when lat/lng are left blank. */
export async function POST(request: Request) {
  const auth = await requireAdminAuth()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return json({ error: 'Invalid body' }, 400)
  const parsed = parsePartner(b)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const v = parsed.value

  let lat = v.lat ?? null
  let lng = v.lng ?? null
  if (lat == null || lng == null) {
    const g = await geocodeAddress([v.name, v.address, v.city].filter(Boolean).join(', '))
    if (!g) return json({ error: 'Could not find that address. Enter latitude and longitude.' }, 422)
    lat = g.lat
    lng = g.lng
  }

  const base = slugify(v.name!, v.city)
  const now = new Date()
  let created: { id: string; slug: string } | null = null
  for (let n = 1; n <= 20 && !created; n++) {
    const slug = n === 1 ? base : `${base}-${n}`.slice(0, 80)
    try {
      created = await prisma.pizzeria.create({
        data: {
          slug,
          name: v.name!,
          address: v.address ?? null,
          city: v.city ?? null,
          countryCode: v.countryCode ?? null,
          lat,
          lng,
          source: 'ADMIN',
          isPartner: true,
          partnerSince: now,
          website: v.website ?? null,
          stampInk: v.stampInk ?? null,
          logoUrl: v.logoUrl && v.logoConsent ? v.logoUrl : null,
          logoConsentAt: v.logoUrl && v.logoConsent ? now : null,
          createdBy: auth.session.discordId,
        },
        select: { id: true, slug: true },
      })
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e // slug taken (also under a race): try the next suffix
    }
  }
  if (!created) return json({ error: 'Could not pick a unique slug' }, 409)
  return json({ id: created.id, slug: created.slug }, 201)
}
