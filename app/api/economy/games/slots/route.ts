import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { playSlots } from '@/app/lib/pep-games/slots'
import { cooldown, gameSession, jsonBody } from '../guard'

export const runtime = 'nodejs'

/** POST { bet }: one slots spin. Off unless PEP_GAMES_ENABLED=1. */
const POST_HANDLER = async (req: Request) => {
  const s = await gameSession()
  if ('off' in s) return s.off
  const body = await jsonBody(req)
  const result = await playSlots(s.discordId, body.bet as number)
  if (!result.ok) return cooldown(result.readyAt)
  return NextResponse.json(result)
}

export const POST = withErrorHandling(POST_HANDLER)
