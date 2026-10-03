import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { blackjackAction, getActiveBlackjack, startBlackjack } from '@/app/lib/pep-games/blackjack'
import { cooldown, gameSession, jsonBody } from '../guard'

export const runtime = 'nodejs'

/** GET: the member's live hand (auto-standing it if it timed out), or null. */
const GET_HANDLER = async () => {
  const s = await gameSession()
  if ('off' in s) return s.off
  return NextResponse.json({ game: await getActiveBlackjack(s.discordId) })
}

/**
 * POST { action: "start", bet } | { action: "hit" | "stand", gameId }.
 * Same state and settlement as the Discord /blackjack buttons.
 */
const POST_HANDLER = async (req: Request) => {
  const s = await gameSession()
  if ('off' in s) return s.off
  const body = await jsonBody(req)

  if (body.action === 'start') {
    const r = await startBlackjack(s.discordId, body.bet as number, { source: 'web' })
    if (!r.ok && r.reason === 'cooldown') return cooldown(r.readyAt)
    if (!r.ok) return NextResponse.json({ error: 'You already have a hand in play', game: r.game }, { status: 409 })
    return NextResponse.json(r)
  }
  if ((body.action === 'hit' || body.action === 'stand') && typeof body.gameId === 'string') {
    const r = await blackjackAction(s.discordId, body.gameId, body.action)
    if (!r.ok) return NextResponse.json({ error: 'Hand not found' }, { status: 404 })
    return NextResponse.json(r)
  }
  throw new ValidationError('action must be start, hit or stand')
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
