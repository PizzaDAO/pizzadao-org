import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { out, requireEnabled, safe, type RouteCtx } from '@/app/lib/proposals/http'
import { castBallot } from '@/app/lib/proposals/store'
import { TokenConfigError } from '@/app/lib/proposals/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A vote is one Redis write; fail fast rather than hang until the platform default.
export const maxDuration = 30

const STATUS = { not_found: 404, closed: 409, bad_request: 400, invalid_token: 401, not_production: 404, unavailable: 503 } as const

/**
 * POST /api/proposals/[id]/vote — cast or change a secret vote. Body: { token, preparedMessage, signature, choice }.
 * NO SESSION: the blind signature on the token is the only credential, and nothing here may identify the voter.
 * So this route reads no cookie, stores no member id, no IP and no timestamp, and logs neither token nor choice
 * (the per-IP throttle keeps only a hashed counter for a few minutes, outside the database).
 */
export const POST = safe('vote', async (request: Request, { params }: RouteCtx) => {
  const off = await requireEnabled()
  if (off) return off
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const limited = await enforceRateLimit(request, 'proposals-vote')
  if (limited) return limited
  const { id } = await params

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return out({ error: 'bad_request' }, 400)
  const { token, preparedMessage, signature, choice } = body
  if (typeof token !== 'string' || typeof preparedMessage !== 'string' || typeof signature !== 'string') {
    return out({ error: 'bad_request' }, 400)
  }
  try {
    const r = await castBallot(id, { token, preparedMessage, signature }, choice)
    if (!r.ok) return out({ error: r.code }, STATUS[r.code])
    return out({ ok: true })
  } catch (e) {
    if (e instanceof TokenConfigError) return out({ error: 'Voting is not configured' }, 503)
    throw e
  }
})
