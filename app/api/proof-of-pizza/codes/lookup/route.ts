import { NextResponse } from 'next/server'
import { guardProofOfPizzaRequest } from '@/app/lib/proof-of-pizza-auth'
import { lookupCode, normalizeCode } from '@/app/lib/redemption-codes'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * POST /api/proof-of-pizza/codes/lookup  { code }  (Bearer PROOF_OF_PIZZA_API_KEY)
 * 200 { status: 'active', holderName, acquiredAt } | { status: 'redeemed', redeemedAt, redeemedRef }
 *     | { status: 'void' } | { status: 'unknown' }. 400 for a malformed code (no database read).
 */
export const POST = withErrorHandling(async (request: Request) => {
  const denied = await guardProofOfPizzaRequest(request)
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  const code = normalizeCode(body?.code)
  if (!code) return NextResponse.json({ error: 'Malformed code' }, { status: 400, headers: noStore })
  // One shared caller, so this is a global backstop on top of the per-IP limit.
  const global = await checkKeyedRateLimit('pop-lookup-global', 'pop', undefined, { failClosed: true })
  if (!global.success) return rateLimitResponse(global)
  return NextResponse.json(await lookupCode(code), { headers: noStore })
})
