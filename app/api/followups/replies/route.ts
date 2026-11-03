import { NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { canReadFollowUpReplies, replyMinLevel } from '@/app/lib/followups/reply-access'
import { listReplies } from '@/app/lib/followups/replies-view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/followups/replies: read-only list of members' follow-up replies. Members at or above
 * followups.replyMinLevel, or Dread Pizza Roberts. There is no write method here; every write
 * stays on the Dread Pizza Roberts routes under /api/admin/followups.
 */
export async function GET() {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  if (!(await canReadFollowUpReplies(auth.session.discordId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ items: await listReplies(), minLevel: await replyMinLevel().catch(() => null) }, { headers: { 'Cache-Control': 'no-store' } })
}
