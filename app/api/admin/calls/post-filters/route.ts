import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { loadPostFilter, savePostFilter, MAX_FILTER_ENTRIES, MAX_FILTER_ENTRY_CHARS } from '@/app/lib/calls/post-filters'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PUT /api/admin/calls/post-filters
 * Dread Pizza Roberts only (same check as call review). The filter values are private editorial
 * settings: never returned to anyone else, never cached.
 */
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

export const GET = withErrorHandling(async () => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  return NextResponse.json(await loadPostFilter(), NO_STORE)
})

function list(body: Record<string, unknown>, key: string): string[] {
  const v = body[key]
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > MAX_FILTER_ENTRIES || v.some((x) => typeof x !== 'string' || x.length > MAX_FILTER_ENTRY_CHARS)) {
    throw new ValidationError(`${key} must be an array of up to ${MAX_FILTER_ENTRIES} strings of up to ${MAX_FILTER_ENTRY_CHARS} characters`)
  }
  return v as string[]
}

export const PUT = withErrorHandling(async (request: Request) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid body')
  const saved = await savePostFilter(
    { excludedCrewIds: list(body, 'excludedCrewIds'), excludedCrewLabelTerms: list(body, 'excludedCrewLabelTerms'), blockedTerms: list(body, 'blockedTerms') },
    auth.session.discordId,
  )
  return NextResponse.json(saved, NO_STORE)
})
