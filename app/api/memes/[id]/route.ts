// app/api/memes/[id]/route.ts
//
// DELETE: the uploader removes their own meme (any live state). PATCH: the uploader edits caption and
// tags while it is still waiting. Other members get a 404, never a hint that the meme exists.
import { NextRequest } from 'next/server'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { requireMemeMember } from '@/app/lib/memes/access'
import { deleteOwnMeme, updateOwnMeme } from '@/app/lib/memes/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const DELETE_HANDLER = async (request: NextRequest, ctx: Ctx) => {
  const auth = await requireMemeMember()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await ctx.params
  const r = await deleteOwnMeme(id, auth.session.discordId)
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status)
}

const PATCH_HANDLER = async (request: NextRequest, ctx: Ctx) => {
  const auth = await requireMemeMember()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON' }, 400)
  const { id } = await ctx.params
  const r = await updateOwnMeme(id, auth.session.discordId, { ...('caption' in body ? { caption: body.caption } : {}), ...('tags' in body ? { tags: body.tags } : {}) })
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status)
}

export const DELETE = withErrorHandling(DELETE_HANDLER)
export const PATCH = withErrorHandling(PATCH_HANDLER)
