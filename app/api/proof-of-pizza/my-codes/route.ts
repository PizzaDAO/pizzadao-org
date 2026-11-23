import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { requireOnboarded } from '@/app/lib/economy'
import { getMyCodes } from '@/app/lib/redemption-codes'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/proof-of-pizza/my-codes: the signed-in member's own codes (never public: codes are secrets). */
export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  await requireOnboarded(session.discordId)
  return NextResponse.json(await getMyCodes(session.discordId), { headers: { 'Cache-Control': 'no-store' } })
})
