// app/api/memes/[id]/report/route.ts
//
// POST { reason? }: a member reports an approved meme (once per member per meme, 20 a day). Enough
// different reporters hide it until a capo looks (memes.autoHideReports).
import { NextRequest } from 'next/server'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { requireMemeMember } from '@/app/lib/memes/access'
import { reportMeme } from '@/app/lib/memes/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const POST_HANDLER = async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireMemeMember()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown } | null
  const { id } = await ctx.params
  const r = await reportMeme({ id, reporterId: auth.session.discordId, reason: body?.reason })
  // The reporter is told "thanks", never whether their report hid the meme.
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status)
}

export const POST = withErrorHandling(POST_HANDLER)
