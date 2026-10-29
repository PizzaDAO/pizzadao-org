// app/api/telegram/webhook/route.ts
//
// Telegram Bot API webhook for the login bot (follow-up buttons, replies, /start, /stop).
// Telegram sends the secret registered with setWebhook in X-Telegram-Bot-Api-Secret-Token; anything
// without the right value is refused. With TELEGRAM_WEBHOOK_SECRET unset the endpoint is closed (503).
// Register once, against production only: scripts/telegram-set-webhook.mjs.
import { after, NextResponse } from 'next/server'
import { notifyApprovers } from '@/app/lib/followups/notify'
import { answerCallback } from '@/app/lib/followups/telegram'
import { secretMatches } from '@/app/lib/followups/webhook-auth'
import { handleTelegramUpdate, realUpdateDeps, type TgUpdate } from '@/app/lib/followups/telegram-updates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret?.trim()) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  if (!secretMatches(req.headers.get('x-telegram-bot-api-secret-token'), secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const update = (await req.json().catch(() => null)) as TgUpdate | null
  if (!update || typeof update !== 'object') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    await handleTelegramUpdate(
      update,
      realUpdateDeps((text) => after(() => notifyApprovers(text).then(() => undefined, () => undefined)), answerCallback),
    )
  } catch (err) {
    // Always 200 for an authentic update: a non-200 makes Telegram retry the same update for hours.
    console.error('[telegram/webhook] handler failed:', err instanceof Error ? err.message.slice(0, 200) : 'error')
  }
  return NextResponse.json({ ok: true })
}
