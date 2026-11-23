/**
 * Bearer auth for the Proof of Pizza site's server-to-server calls (plans/proof-of-pizza-codes.md):
 * `Authorization: Bearer $PROOF_OF_PIZZA_API_KEY`, constant-time compare. With no key configured the
 * API is off for everyone (503), so previews without the key refuse every call.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from './rate-limit'

const digest = (s: string) => createHash('sha256').update(s).digest()

export const proofOfPizzaKey = (env: NodeJS.ProcessEnv = process.env): string | null => env.PROOF_OF_PIZZA_API_KEY?.trim() || null

export function isProofOfPizzaAuthorized(authorization: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const key = proofOfPizzaKey(env)
  if (!key || !authorization) return false
  // Hash both sides so the compare is constant-time whatever the lengths.
  return timingSafeEqual(digest(`Bearer ${key}`), digest(authorization.trim()))
}

const noStore = { 'Cache-Control': 'no-store' }

/**
 * Shared front door of both routes. Returns a response to send, or null when the caller may proceed:
 * 503 when no key is set, 429 over the per-IP limit (counted before the key is checked), 401 for a
 * wrong key (repeated failures get 429).
 */
export async function guardProofOfPizzaRequest(request: Request): Promise<NextResponse | null> {
  if (!proofOfPizzaKey()) return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: noStore })
  const ip = await checkRateLimit(request, 'pop-lookup')
  if (!ip.success) return rateLimitResponse(ip)
  if (isProofOfPizzaAuthorized(request.headers.get('authorization'))) return null
  const fail = await checkRateLimit(request, 'pop-auth-fail')
  if (!fail.success) return rateLimitResponse(fail)
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
}
