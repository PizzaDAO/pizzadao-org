import { requireSession } from '@/app/lib/auth-guards'
import { json } from '@/app/lib/admin-guard'
import { canManageCrew } from '@/app/lib/crew-leads'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { canViewCallTranscript } from '@/app/lib/calls/transcript-access'
import { usesDb } from '@/app/lib/sheets-import/source'
import { listProposalViews } from '@/app/lib/call-tasks/view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/crew/<crewId>/proposals[?recordingId=<id>&status=all]
 * Proposed task updates from calls (plans/post-call-agenda-updates.md, ask 2). Leads of the crew and
 * guild admins only (fails closed). The transcript quote is included only for viewers who may read
 * call transcripts.
 */
export async function GET(request: Request, { params }: { params: Promise<{ crewId: string }> }) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const crewId = normalizeCrewId((await params).crewId)
  if (!crewId) return json({ error: 'Not found' }, 404)
  if (!(await canManageCrew(auth.session.discordId, crewId))) return json({ error: 'Only crew leads can see this' }, 403)
  if (!(await usesDb('crewTasks', crewId))) return json({ proposals: [], editable: false })
  const url = new URL(request.url)
  const recordingId = url.searchParams.get('recordingId')?.trim() || undefined
  const all = url.searchParams.get('status') === 'all'
  try {
    const includeQuote = await canViewCallTranscript(auth.session.discordId)
    const proposals = await listProposalViews(crewId, { recordingId, statuses: all ? ['PENDING', 'APPLIED', 'DISMISSED', 'STALE'] : ['PENDING'], includeQuote })
    return json({ proposals, editable: true })
  } catch (e) {
    console.error('[crew-proposals] list failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load' }, 500)
  }
}
