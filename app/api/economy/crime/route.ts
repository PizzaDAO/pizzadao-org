import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { commitCrime } from '@/app/lib/pep-earn/crime'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

/**
 * POST /api/economy/crime: UnbelievaBoat's /crime, on the web.
 * Off (404) unless PEP_CRIME_ENABLED=1, so merging this does not launch it.
 * 429 with `readyAt` while on cooldown.
 */
const POST_HANDLER = async () => {
  if (process.env.PEP_CRIME_ENABLED !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()

  const result = await commitCrime(session.discordId)
  if (!result.ok) {
    return NextResponse.json({ error: 'cooldown', readyAt: result.readyAt.toISOString() }, { status: 429 })
  }
  return NextResponse.json(result)
}

export const POST = withErrorHandling(POST_HANDLER)
