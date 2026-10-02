import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { getWebhookUrl } from '@/app/lib/discord-webhook'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { isOwnBlobUrl } from '@/app/lib/blob-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SuggestionPayload {
  body?: unknown
  name?: unknown
  email?: unknown
  imageUrl?: unknown
  pageUrl?: unknown
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Field length caps (anyone can POST here, so keep stored rows bounded).
const SUGGESTION_LIMITS = {
  body: 5000,
  name: 100,
  email: 254,
  pageUrl: 2048,
  imageUrl: 2048,
} as const

function capped(value: string | null, field: keyof typeof SUGGESTION_LIMITS): string | null {
  if (value && value.length > SUGGESTION_LIMITS[field]) {
    throw new ValidationError(
      `${field} is too long (max ${SUGGESTION_LIMITS[field]} characters)`,
      field
    )
  }
  return value
}

// POST /api/suggestions - Log a site improvement suggestion (open to anyone)
const POST_HANDLER = async (request: NextRequest) => {
  const limited = await enforceRateLimit(request, 'suggestions')
  if (limited) return limited

  const payload = (await request.json().catch(() => ({}))) as SuggestionPayload

  const body = capped(asTrimmedString(payload.body), 'body')
  if (!body) {
    throw new ValidationError('A suggestion message is required', 'body')
  }

  const name = capped(asTrimmedString(payload.name), 'name')
  const email = capped(asTrimmedString(payload.email), 'email')
  const imageUrl = capped(asTrimmedString(payload.imageUrl), 'imageUrl')
  // pageUrl is captured automatically client-side; truncate rather than reject.
  const pageUrl = asTrimmedString(payload.pageUrl)?.slice(0, SUGGESTION_LIMITS.pageUrl) ?? null

  // Only accept images uploaded through /api/suggestions/upload (our Blob store).
  if (imageUrl && !isOwnBlobUrl(imageUrl, '/suggestions/')) {
    throw new ValidationError('imageUrl must be an image uploaded via this site', 'imageUrl')
  }

  // Auth is optional — capture identity if a session exists.
  let discordId: string | null = null
  try {
    const session = await getSession()
    if (session?.discordId) {
      discordId = session.discordId
    }
  } catch {
    // No / invalid session — that's fine, suggestions are open to anyone.
  }

  const suggestion = await prisma.suggestion.create({
    data: {
      body,
      name,
      email,
      imageUrl,
      pageUrl,
      discordId,
    },
  })

  // Best-effort Discord ping. A webhook failure must never fail the request.
  try {
    const webhookUrl = await getWebhookUrl('General')
    if (webhookUrl) {
      const meta = [name, email, pageUrl].filter(Boolean).join(' • ')
      const lines: string[] = ['**💡 New site suggestion**', body]
      if (meta) lines.push(`_— ${meta}_`)
      if (imageUrl) lines.push(imageUrl)

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: lines.join('\n'),
          allowed_mentions: { parse: [] },
        }),
      })
    }
  } catch {
    // Swallow webhook errors.
  }

  return NextResponse.json({ ok: true, id: suggestion.id })
}

export const POST = withErrorHandling(POST_HANDLER)
