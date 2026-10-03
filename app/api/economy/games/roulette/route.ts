import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { parseRouletteSpace, playRoulette } from '@/app/lib/pep-games/roulette'
import { cooldown, gameSession, jsonBody } from '../guard'

export const runtime = 'nodejs'

/** POST { bet, space }: one roulette spin. Off unless PEP_GAMES_ENABLED=1. */
const POST_HANDLER = async (req: Request) => {
  const s = await gameSession()
  if ('off' in s) return s.off
  const body = await jsonBody(req)
  const result = await playRoulette(s.discordId, body.bet as number, parseRouletteSpace(body.space))
  if (!result.ok) return cooldown(result.readyAt)
  return NextResponse.json(result)
}

export const POST = withErrorHandling(POST_HANDLER)
