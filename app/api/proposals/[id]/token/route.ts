import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { out, requireProposalsSession, safe, type RouteCtx } from '@/app/lib/proposals/http'
import { issueToken } from '@/app/lib/proposals/store'
import { TokenConfigError } from '@/app/lib/proposals/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS = { not_found: 404, closed: 409, not_eligible: 403, already_issued: 409, bad_request: 400 } as const

/**
 * POST /api/proposals/[id]/token — blind-sign a ballot token for an eligible member. Body: { blindedMessage }.
 * Called when a member LOADS a proposal page (not when they vote), once per member per proposal; the server
 * records only that a token was issued and never sees the token.
 */
export const POST = safe('token', async (request: Request, { params }: RouteCtx) => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await params
  const limited = await checkKeyedRateLimit('proposals-token', auth.session.discordId)
  if (!limited.success) return out({ error: 'rate_limited' }, 429)

  const body = (await request.json().catch(() => null)) as { blindedMessage?: unknown } | null
  try {
    const r = await issueToken(id, auth.session.discordId, body?.blindedMessage)
    if (!r.ok) return out({ error: r.code }, STATUS[r.code])
    return out({ blindSignature: r.blindSignature })
  } catch (e) {
    if (e instanceof TokenConfigError) return out({ error: 'Voting is not configured' }, 503)
    throw e
  }
})
