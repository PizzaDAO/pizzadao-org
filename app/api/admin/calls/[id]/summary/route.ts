import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { updateRecordingText, type RecordingTextEdit } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LIST = 30

function text(v: unknown, name: string, max: number): string | null {
  if (v === null) return null
  if (typeof v !== 'string' || v.length > max) throw new ValidationError(`${name} must be a string up to ${max} characters`)
  return v.trim() || null
}

/** Parse only the fields present in the body. */
function parseTextEdit(body: Record<string, unknown>): RecordingTextEdit {
  const edit: RecordingTextEdit = {}
  if ('title' in body && body.title !== undefined) edit.title = text(body.title, 'title', 200)
  if ('summary' in body && body.summary !== undefined) edit.summary = text(body.summary, 'summary', 20000)
  if (body.actionItems !== undefined) {
    if (!Array.isArray(body.actionItems) || body.actionItems.length > MAX_LIST) throw new ValidationError(`actionItems must be an array of up to ${MAX_LIST}`)
    edit.actionItems = body.actionItems
      .map((raw, i) => {
        const r = (raw ?? {}) as { text?: unknown; owner?: unknown }
        const t = text(r.text ?? null, `actionItems[${i}].text`, 500)
        const owner = r.owner == null ? null : text(r.owner, `actionItems[${i}].owner`, 100)
        return t ? { text: t, ...(owner ? { owner } : {}) } : null
      })
      .filter((x): x is { text: string; owner?: string } => !!x)
  }
  if (body.chapters !== undefined) {
    if (!Array.isArray(body.chapters) || body.chapters.length > MAX_LIST) throw new ValidationError(`chapters must be an array of up to ${MAX_LIST}`)
    edit.chapters = body.chapters
      .map((raw, i) => {
        const r = (raw ?? {}) as { startMs?: unknown; title?: unknown }
        const title = text(r.title ?? null, `chapters[${i}].title`, 200)
        if (typeof r.startMs !== 'number' || !Number.isFinite(r.startMs) || r.startMs < 0 || r.startMs > 86_400_000) {
          throw new ValidationError(`chapters[${i}].startMs must be a number of milliseconds`)
        }
        return title ? { startMs: Math.round(r.startMs), title } : null
      })
      .filter((x): x is { startMs: number; title: string } => !!x)
  }
  return edit
}

/**
 * PATCH /api/admin/calls/[id]/summary — reviewer edits of title, summary, action items, chapters.
 * Only fields present are written. Dread Pizza Roberts only.
 */
export const PATCH = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Body must be a JSON object')
  const edit = parseTextEdit(body)

  const { id } = await ctx.params
  const result = await updateRecordingText(id, edit)
  if (result === 'not-found') throw new NotFoundError('Recording')
  if (result === 'invalid') throw new ValidationError('This recording cannot be edited that way right now (a published call keeps its title and summary; a processing call is locked)')
  return NextResponse.json({ success: true })
})
