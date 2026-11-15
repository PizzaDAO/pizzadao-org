/**
 * What the review panels show for a crew's proposals: the stored proposal, the task as it is now,
 * and whether it changed since (stale-edit check). The transcript quote is included only for a
 * viewer who may read call transcripts (canViewCallTranscript); everyone else gets the reason only.
 */
import { prisma } from '@/app/lib/db'
import { NON_ROSTER_CREW_IDS, normalizeCrewId } from '@/app/lib/crew-id'
import type { ProposalChanges } from './proposals'

/**
 * A new task from a call that is not a crew call (the Community Call) was routed to a crew: the
 * review shows that crew and lets a decider pick another one.
 */
export function isRoutable(kind: string, crewId: string, callCrewId: string | null): boolean {
  if (kind !== 'CREATE' || !callCrewId) return false
  return callCrewId !== crewId || NON_ROSTER_CREW_IDS.has(normalizeCrewId(callCrewId))
}

export interface ProposalView {
  id: string
  recordingId: string
  /** The crew the proposal waits on (for a routed new task: the crew it would be created in). */
  crewId: string
  /** The call's own crew id (differs from crewId for a task routed from the Community Call). */
  callCrewId: string | null
  /** A routed new task: the crew is shown and can be changed before applying. */
  routable: boolean
  /** Set when a decider moved it here from another crew. */
  fromCrewId: string | null
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
  opts: { recordingId?: string; statuses?: string[]; kinds?: string[]; since?: Date; includeQuote: boolean; limit?: number },
): Promise<ProposalView[]> {
  const rows = await prisma.crewTaskProposal.findMany({
    where: { crewId, status: { in: opts.statuses ?? ['PENDING'] }, ...(opts.recordingId ? { recordingId: opts.recordingId } : {}), ...(opts.kinds ? { kind: { in: opts.kinds } } : {}), ...(opts.since ? { decidedAt: { gte: opts.since } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: opts.limit ?? 100,
  })
  const ids = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))]
  const tasks = ids.length ? await prisma.crewTask.findMany({ where: { id: { in: ids } }, select: { id: true, label: true, updatedAt: true, archived: true } }) : []
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const recIds = [...new Set(rows.map((r) => r.recordingId))]
  let recs: Array<{ id: string; crewId: string | null }> = []
  try {
    recs = recIds.length ? ((await prisma.callRecording.findMany({ where: { id: { in: recIds } }, select: { id: true, crewId: true } })) ?? []) : []
  } catch {
    recs = [] // only the crew picker depends on it
  }
  const callCrew = new Map(recs.map((r) => [r.id, r.crewId]))
  return rows.map((r) => {
    const changes = (r.changes ?? {}) as ProposalChanges
    const t = r.taskId ? byId.get(r.taskId) : undefined
    const candidates = (Array.isArray(r.candidates) ? (r.candidates as Array<{ memberId?: unknown; name?: unknown }>) : [])
      .filter((c) => typeof c?.memberId === 'string' && typeof c?.name === 'string')
      .map((c) => ({ memberId: c.memberId as string, name: c.name as string }))
    const gone = r.kind !== 'CREATE' && (!t || t.archived)
    const callCrewId = callCrew.get(r.recordingId) ?? null
    const edited = (r.edited as Record<string, unknown> | null) ?? null
    return {
      id: r.id,
      recordingId: r.recordingId,
      crewId: r.crewId,
      callCrewId,
      routable: isRoutable(r.kind, r.crewId, callCrewId),
      fromCrewId: typeof edited?.fromCrewId === 'string' ? edited.fromCrewId : null,
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
