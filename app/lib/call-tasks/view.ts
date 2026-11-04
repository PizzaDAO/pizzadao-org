/**
 * What the review panels show for a crew's proposals: the stored proposal, the task as it is now,
 * and whether it changed since (stale-edit check). The transcript quote is included only for a
 * viewer who may read call transcripts (canViewCallTranscript); everyone else gets the reason only.
 */
import { prisma } from '@/app/lib/db'
import type { ProposalChanges } from './proposals'

export interface ProposalView {
  id: string
  recordingId: string
  kind: string
  status: string
  taskId: string | null
  /** The task's label now (CREATE: the proposed label). */
  taskLabel: string
  changes: ProposalChanges
  edited: Record<string, unknown> | null
  leadName: string | null
  leadMemberId: string | null
  candidates: Array<{ memberId: string; name: string }>
  reason: string
  quote: string | null
  startMs: number | null
  confidence: string
  /** The task changed (or is gone) since this was proposed: applying needs a second confirmation. */
  taskChanged: boolean
  taskGone: boolean
  createdAt: string
  decidedAt: string | null
}

export async function listProposalViews(
  crewId: string,
  opts: { recordingId?: string; statuses?: string[]; includeQuote: boolean; limit?: number },
): Promise<ProposalView[]> {
  const rows = await prisma.crewTaskProposal.findMany({
    where: { crewId, status: { in: opts.statuses ?? ['PENDING'] }, ...(opts.recordingId ? { recordingId: opts.recordingId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: opts.limit ?? 100,
  })
  const ids = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))]
  const tasks = ids.length ? await prisma.crewTask.findMany({ where: { id: { in: ids } }, select: { id: true, label: true, updatedAt: true, archived: true } }) : []
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return rows.map((r) => {
    const changes = (r.changes ?? {}) as ProposalChanges
    const t = r.taskId ? byId.get(r.taskId) : undefined
    const candidates = (Array.isArray(r.candidates) ? (r.candidates as Array<{ memberId?: unknown; name?: unknown }>) : [])
      .filter((c) => typeof c?.memberId === 'string' && typeof c?.name === 'string')
      .map((c) => ({ memberId: c.memberId as string, name: c.name as string }))
    const gone = r.kind !== 'CREATE' && (!t || t.archived)
    return {
      id: r.id,
      recordingId: r.recordingId,
      kind: r.kind,
      status: r.status,
      taskId: r.taskId,
      taskLabel: t?.label ?? String(changes.label?.to ?? ''),
      changes,
      edited: (r.edited as Record<string, unknown> | null) ?? null,
      leadName: r.leadName,
      leadMemberId: r.leadMemberId,
      candidates,
      reason: r.reason,
      quote: opts.includeQuote ? r.quote : null,
      startMs: opts.includeQuote ? r.startMs : null,
      confidence: r.confidence,
      taskChanged: r.kind !== 'CREATE' && !gone && !!t && (!r.baseUpdatedAt || t.updatedAt.getTime() !== r.baseUpdatedAt.getTime()),
      taskGone: gone,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    }
  })
}
