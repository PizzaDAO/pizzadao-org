import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { gamesEnabled } from '@/app/lib/pep-games/config'
import { UnauthorizedError } from '@/app/lib/errors/api-errors'

/** Games are off (404) unless PEP_GAMES_ENABLED=1; then a session is required. */
export async function gameSession(): Promise<{ off: NextResponse } | { discordId: string }> {
  if (!gamesEnabled()) return { off: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  return { discordId: session.discordId }
}

export function cooldown(readyAt: Date) {
  return NextResponse.json({ error: 'cooldown', readyAt: readyAt.toISOString() }, { status: 429 })
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}
