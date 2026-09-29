import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { getWebhookUrl } from '@/app/lib/discord-webhook'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

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

// POST /api/suggestions - Log a site improvement suggestion (open to anyone)
const POST_HANDLER = async (request: NextRequest) => {
  const payload = (await request.json().catch(() => ({}))) as SuggestionPayload

  const body = asTrimmedString(payload.body)
  if (!body) {
    throw new ValidationError('A suggestion message is required', 'body')
  }

  const name = asTrimmedString(payload.name)
  const email = asTrimmedString(payload.email)
  const imageUrl = asTrimmedString(payload.imageUrl)
  const pageUrl = asTrimmedString(payload.pageUrl)

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
