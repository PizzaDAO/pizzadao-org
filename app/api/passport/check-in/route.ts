import { requireSession } from '@/app/lib/auth-guards'
import { rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit, checkRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { loadPassportConfig } from '@/app/lib/passport/config'
import { performCheckIn } from '@/app/lib/passport/stamps'
import { parseQrPath } from '@/app/lib/passport/qr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/passport/check-in  { qr: "<slug>.<code>", lat?, lng?, accuracy? }
 * Any logged-in member. 404 while the feature is off. The server recomputes the distance.
 */
export async function POST(request: Request) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const config = await loadPassportConfig()
  if (!config.enabled) return json({ error: 'Not found' }, 404)
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe

  const ip = await checkRateLimit(request, 'passport-checkin-ip')
  if (!ip.success) return rateLimitResponse(ip)
  const user = await checkKeyedRateLimit('passport-checkin', auth.session.discordId)
  if (!user.success) return rateLimitResponse(user)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const parsed = body && typeof body.qr === 'string' ? parseQrPath(body.qr) : null
  if (!body || !parsed) return json({ ok: false, reason: 'bad_qr' }, 400)

  const hasLoc = body.lat != null && body.lng != null
  const result = await performCheckIn(
    {
      discordId: auth.session.discordId,
      slug: parsed.slug,
      code: parsed.code,
      client: hasLoc ? { lat: body.lat, lng: body.lng, accuracy: body.accuracy } : null,
    },
    config,
  )
  if (!result.ok) return json(result, result.reason === 'not_found' ? 404 : 422)
  return json(result)
}
