import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/lib/auth-guards'
import { loadSettings } from '@/app/lib/settings'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { UPDATES_VOICES } from '@/app/lib/settings/call-updates-settings'
import { TTS_MODEL, defaultSynth } from '@/app/lib/call-updates/tts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SAMPLE_TEXT = "Automated call updates for the Ops call. Two tasks were completed since the last call. That's the update."

/**
 * POST /api/admin/calls/updates-sample { voice } (admin only, production only).
 * Returns a short MP3 sample of the chosen base voice in the saved style, for the admin to play in the
 * browser. Never cached, never sent to Discord. Previews refuse: they must not call the voice provider.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  if (process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ error: 'Voice samples are only available on production.' }, { status: 403 })
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY is not configured.' }, { status: 503 })
  const body = (await request.json().catch(() => null)) as { voice?: unknown } | null
  const voice = typeof body?.voice === 'string' ? body.voice : ''
  if (!(UPDATES_VOICES as readonly string[]).includes(voice)) throw new ValidationError('Unknown voice')
  const limit = await checkKeyedRateLimit('updates-sample', auth.session.discordId, undefined, { failClosed: true })
  if (!limit.success) return rateLimitResponse(limit)

  const settings = await loadSettings()
  const bytes = await defaultSynth(apiKey, fetch, 'mp3')(SAMPLE_TEXT, { voice, instructions: settings.get('calls.updatesVoiceInstructions'), model: TTS_MODEL })
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store' } })
})
