import { requireCallReviewer } from '@/app/lib/calls/access'
import { json } from '@/app/lib/admin-guard'
import { searchMembers } from '@/app/lib/followups/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/followups/members?q=<name>: member search for picking the person on an unresolved row. */
export async function GET(request: Request) {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const q = new URL(request.url).searchParams.get('q') ?? ''
  try {
    return json({ members: await searchMembers(q.slice(0, 80)) })
  } catch (e) {
    console.error('[admin followups] member search failed:', e instanceof Error ? e.message.slice(0, 120) : 'error')
    return json({ error: 'Member list unavailable' }, 502)
  }
}
