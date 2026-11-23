import { NextResponse } from 'next/server'
import { guardProofOfPizzaRequest } from '@/app/lib/proof-of-pizza-auth'
import { normalizeCode, normalizeRef, redeemCode } from '@/app/lib/redemption-codes'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * POST /api/proof-of-pizza/codes/redeem  { code, ref }  (Bearer PROOF_OF_PIZZA_API_KEY)
 * `ref` is the submission id on the other site. Consumes the holder's unit and marks the code redeemed.
 * 200 { ok: true, already: false, redeemedAt } on success, 200 { ok: true, already: true, redeemedAt }
 * for the same ref again; 404 { error: 'unknown_or_void' }; 409 { error: 'already_redeemed' } for a
 * different ref; 400 for a malformed code or ref.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const denied = await guardProofOfPizzaRequest(request)
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as { code?: unknown; ref?: unknown } | null
  const code = normalizeCode(body?.code)
  const ref = normalizeRef(body?.ref)
  if (!code || !ref) return NextResponse.json({ error: 'Malformed code or ref' }, { status: 400, headers: noStore })
  const r = await redeemCode(code, ref)
  switch (r.status) {
    case 'redeemed':
      return NextResponse.json({ ok: true, already: false, redeemedAt: r.redeemedAt }, { headers: noStore })
    case 'already':
      return NextResponse.json({ ok: true, already: true, redeemedAt: r.redeemedAt }, { headers: noStore })
    case 'conflict':
      return NextResponse.json({ error: 'already_redeemed' }, { status: 409, headers: noStore })
    default:
      return NextResponse.json({ error: 'unknown_or_void' }, { status: 404, headers: noStore })
  }
})
