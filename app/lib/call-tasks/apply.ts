/**
 * Deciding on proposed crew task updates (plans/post-call-agenda-updates.md, ask 2): apply, edit,
 * dismiss, apply all. Only a lead of the crew or a guild admin (canManageCrew) may decide, and only
 * for crews whose tasks are edited on the website. Applying writes through the shared task writer
 * (crew-tasks-write.ts), so `doneAt`, the history (CrewTaskEvent, via: 'call-proposal') and the
 * archive-never-delete rule are the same as in the editor. A task that changed since the proposal
 * was made is a conflict: the lead has to confirm again (force) before it is overwritten.
 */
import { prisma } from '@/app/lib/db'
import { canManageCrew } from '@/app/lib/crew-leads'
import { usesDb } from '@/app/lib/sheets-import/source'
import { isClosedStage, invalidateCrewMappingsCache } from '@/app/lib/crew-mappings'
import { isCrewExcluded, loadPostFilter } from '@/app/lib/calls/post-filters'
import { archiveCrewTask, createCrewTask, unarchiveCrewTask, updateCrewTask, type TaskPatch } from '@/app/lib/crew-tasks-write'
import { crewInAllowlist, loadTaskProposalConfig } from './config'
import type { ProposalChanges, ProposalField } from './proposals'

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** What an approver may change before applying. `skipLead` leaves the lead out of the change. */
export interface ProposalEdits {
  label?: string
  stage?: string
  priority?: string | null
  due?: string | null
  leadName?: string | null
  leadMemberId?: string | null
  skipLead?: boolean
}

export function cleanEdits(raw: unknown): ProposalEdits | null {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: ProposalEdits = {}
  const str = (v: unknown, max: number): string | null | undefined => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v !== 'string') throw new Error('bad')
    const t = v.replace(/\s+/g, ' ').trim()
    if (t.length > max) throw new Error('bad')
    return t || null
  }
  try {
    const label = str(r.label, 300)
    if (label === null) return null
    if (label !== undefined) out.label = label
    const stage = str(r.stage, 40)
    if (stage === null) return null
    if (stage !== undefined) out.stage = stage
    const priority = str(r.priority, 40)
    if (priority !== undefined) out.priority = priority
    const due = str(r.due, 10)
    if (due !== undefined) {
      if (due !== null && !ISO.test(due)) return null
      out.due = due
    }
    const leadName = str(r.leadName, 120)
    if (leadName !== undefined) out.leadName = leadName
    const leadMemberId = str(r.leadMemberId, 20)
    if (leadMemberId !== undefined) {
      if (leadMemberId !== null && !/^\d{1,20}$/.test(leadMemberId)) return null
      out.leadMemberId = leadMemberId
    }
    if (r.skipLead !== undefined) out.skipLead = r.skipLead === true
  } catch {
    return null
  }
  return out
}

type Row = {
  id: string
  recordingId: string
  crewId: string
  kind: string
  taskId: string | null
  baseUpdatedAt: Date | null
  changes: unknown
  edited: unknown
  leadMemberId: string | null
  candidates: unknown
  status: string
}

const FIELDS: ProposalField[] = ['label', 'stage', 'priority', 'due', 'leadName', 'leadMemberId']

/** The values to write: the proposal's `to` values, then the approver's edits on top. */
export function effectiveValues(changes: ProposalChanges, edits: ProposalEdits, edited?: ProposalEdits | null): Partial<Record<ProposalField, string | null>> {
  const out: Partial<Record<ProposalField, string | null>> = {}
  for (const f of FIELDS) {
    const to = changes[f]?.to
    if (to !== undefined && typeof to !== 'boolean') out[f] = to
  }
  const e = { ...(edited ?? {}), ...edits }
  if (e.skipLead) {
    delete out.leadName
    delete out.leadMemberId
  }
  for (const f of ['label', 'stage', 'priority', 'due'] as const) if (e[f] !== undefined) out[f] = e[f] as string | null
  if (!e.skipLead) {
    if (e.leadMemberId !== undefined) {
      out.leadMemberId = e.leadMemberId
      if (e.leadName !== undefined) out.leadName = e.leadName
    } else if (e.leadName !== undefined) {
      out.leadName = e.leadName
      out.leadMemberId = null
    }
  }
  return out
}

const hasCandidates = (r: Pick<Row, 'candidates'>) => Array.isArray(r.candidates) && r.candidates.length > 0

/** An ambiguous lead has to be picked (or skipped) by the approver. */
export function needsLeadPick(r: Pick<Row, 'candidates' | 'leadMemberId'>, eff: Partial<Record<ProposalField, string | null>>, edits: ProposalEdits): boolean {
  if (!hasCandidates(r) || edits.skipLead) return false
  return !(eff.leadMemberId || edits.leadName)
}

export type ApplyOutcome =
  | { result: 'applied'; taskId: string | null }
  | { result: 'not-found' | 'not-pending' | 'forbidden' | 'not-db-crew' | 'needs-lead' | 'needs-confirm' | 'missing-task' | 'bad-edits' | 'failed' | 'disabled' | 'expired' }
  | { result: 'conflict'; current: { label: string; stage: string; priority: string | null; due: string | null; leadName: string | null } }

export async function applyProposal(id: string, actor: string, opts: { edits?: unknown; force?: boolean; confirmed?: boolean; now?: Date } = {}): Promise<ApplyOutcome> {
  const row = (await prisma.crewTaskProposal.findUnique({ where: { id } })) as (Row & { createdAt?: Date }) | null
  if (!row) return { result: 'not-found' }
  if (row.status !== 'PENDING') return { result: 'not-pending' }
  if (!(await canManageCrew(actor, row.crewId))) return { result: 'forbidden' }
  if (!(await usesDb('crewTasks', row.crewId))) return { result: 'not-db-crew' }
  // The feature switch, the crew list, the private exclusion list and the age limit all apply to applying too.
  const cfg = await loadTaskProposalConfig()
  if (!cfg.enabled || !crewInAllowlist(cfg, row.crewId)) return { result: 'disabled' }
  const rec = await prisma.callRecording.findUnique({ where: { id: row.recordingId }, select: { crewLabel: true } })
  try {
    if (isCrewExcluded({ id: row.crewId, label: rec?.crewLabel }, await loadPostFilter())) return { result: 'disabled' }
  } catch {
    return { result: 'disabled' } // fail closed
  }
  const now0 = opts.now ?? new Date()
  if (row.createdAt && row.createdAt.getTime() < now0.getTime() - cfg.maxDays * 86_400_000) {
    await prisma.crewTaskProposal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'STALE' } })
    return { result: 'expired' }
  }
  const edits = cleanEdits(opts.edits)
  if (!edits) return { result: 'bad-edits' }
  const changes = (row.changes ?? {}) as ProposalChanges
  const eff = effectiveValues(changes, edits, row.edited as ProposalEdits | null)
  if (needsLeadPick(row, eff, edits)) return { result: 'needs-lead' }
  if (row.kind === 'CREATE' && !eff.label) return { result: 'bad-edits' }

  // Look at the task before claiming: a conflict leaves the proposal pending so the lead can re-confirm.
  const task = row.kind === 'CREATE' ? null : await prisma.crewTask.findFirst({ where: { id: row.taskId ?? '', crewId: row.crewId, archived: false } })
  if (row.kind !== 'CREATE') {
    if (!task) {
      await prisma.crewTaskProposal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'STALE', error: 'The task no longer exists' } })
      return { result: 'missing-task' }
    }
    const changed = !row.baseUpdatedAt || task.updatedAt.getTime() !== row.baseUpdatedAt.getTime()
    if (changed && !opts.force) {
      return { result: 'conflict', current: { label: task.label, stage: task.stage, priority: task.priority, due: task.due, leadName: task.leadName } }
    }
  }

  // Closing or hiding a task is single-apply and needs an explicit confirmation.
  const closes = !!eff.stage && isClosedStage(eff.stage) && !(task && isClosedStage(task.stage))
  if ((row.kind === 'DONE' || row.kind === 'RETIRE' || closes) && !opts.confirmed) return { result: 'needs-confirm' }

  const now = opts.now ?? new Date()
  const hasEdits = Object.keys(edits).length > 0
  // Claim first: two clicks (or two leads) can never apply the same proposal twice. (CREATE claims inside its transaction.)
  if (row.kind !== 'CREATE') {
    const claim = await prisma.crewTaskProposal.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPLIED', decidedBy: actor, decidedAt: now, error: null, ...(hasEdits ? { edited: edits as never } : {}) },
    })
    if (claim.count !== 1) return { result: 'not-pending' }
  }
  const release = (error: string) => prisma.crewTaskProposal.updateMany({ where: { id }, data: { status: 'PENDING', decidedBy: null, decidedAt: null, error } }).catch(() => {})
  const eventData = { via: 'call-proposal', proposalId: id, recordingId: row.recordingId, kind: row.kind, edited: hasEdits }
  try {
    if (row.kind === 'CREATE') {
      // Claim, task and history in one transaction: a retry can never leave a duplicate task behind.
      const taskId = await prisma.$transaction(async (tx) => {
        const c = await tx.crewTaskProposal.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'APPLIED', decidedBy: actor, decidedAt: now, error: null, ...(hasEdits ? { edited: edits as never } : {}) },
        })
        if (c.count !== 1) throw new Error('not-pending')
        return createCrewTask(
          row.crewId,
          { label: eff.label as string, stage: eff.stage ?? undefined, priority: eff.priority ?? null, due: eff.due ?? null, leadName: eff.leadName ?? null, leadMemberId: eff.leadMemberId ?? null },
          actor,
          eventData,
          tx as never,
        )
      })
      await invalidateCrewMappingsCache()
      return { result: 'applied', taskId }
    }
    const current = task as NonNullable<typeof task>
    // With force the task is re-based: whatever it is now is what gets overwritten.
    const expect = opts.force ? current.updatedAt : (row.baseUpdatedAt as Date)
    let ok: boolean
    if (row.kind === 'RETIRE') {
      ok = await archiveCrewTask(row.crewId, current.id, actor, { expectUpdatedAt: expect, eventData })
    } else {
      const patch: TaskPatch = {}
      if (eff.stage !== undefined && eff.stage !== null) patch.stage = eff.stage
      if (eff.priority !== undefined) patch.priority = eff.priority
      if (eff.due !== undefined) patch.due = eff.due
      if (eff.leadName !== undefined) patch.leadName = eff.leadName
      if (eff.leadMemberId !== undefined) patch.leadMemberId = eff.leadMemberId
      if (Object.keys(patch).length === 0) {
        await release('Nothing to change')
        return { result: 'bad-edits' }
      }
      ok = await updateCrewTask(row.crewId, current.id, patch, actor, { expectUpdatedAt: expect, prev: current, eventData })
    }
    if (!ok) {
      await release('The task changed while applying')
      const fresh = await prisma.crewTask.findUnique({ where: { id: current.id } })
      return { result: 'conflict', current: { label: fresh?.label ?? current.label, stage: fresh?.stage ?? current.stage, priority: fresh?.priority ?? current.priority, due: fresh?.due ?? current.due, leadName: fresh?.leadName ?? current.leadName } }
    }
    return { result: 'applied', taskId: current.id }
  } catch (e) {
    if (e instanceof Error && e.message === 'not-pending') return { result: 'not-pending' }
    if (row.kind === 'CREATE') {
      // The transaction rolled back: no task, no history, still pending.
      console.error('[call-tasks] apply failed:', e instanceof Error ? e.message : e)
      await prisma.crewTaskProposal.updateMany({ where: { id, status: 'PENDING' }, data: { error: 'Could not apply; try again' } }).catch(() => {})
      return { result: 'failed' }
    }
    console.error('[call-tasks] apply failed:', e instanceof Error ? e.message : e)
    await release('Could not apply; try again')
    return { result: 'failed' }
  }
}

export type DismissOutcome = 'dismissed' | 'not-found' | 'not-pending' | 'forbidden'

export async function dismissProposal(id: string, actor: string, now = new Date()): Promise<DismissOutcome> {
  const row = await prisma.crewTaskProposal.findUnique({ where: { id }, select: { crewId: true, status: true } })
  if (!row) return 'not-found'
  if (!(await canManageCrew(actor, row.crewId))) return 'forbidden'
  if (row.status !== 'PENDING') return 'not-pending'
  const res = await prisma.crewTaskProposal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'DISMISSED', decidedBy: actor, decidedAt: now } })
  return res.count === 1 ? 'dismissed' : 'not-pending'
}

export interface ApplyAllReport {
  applied: number
  skipped: Array<{ id: string; reason: 'needs-lead' | 'needs-confirm' | 'conflict' | 'missing-task' | 'failed' | 'not-pending' | 'disabled' | 'expired' }>
}

/** Apply every pending proposal that needs no decision (no ambiguous lead, task unchanged). Nothing is forced, and anything that closes or hides a task (done, retire) is left for a single, confirmed apply. */
export async function applyAll(crewId: string, actor: string, opts: { recordingId?: string } = {}): Promise<ApplyAllReport | 'forbidden' | 'not-db-crew'> {
  if (!(await canManageCrew(actor, crewId))) return 'forbidden'
  if (!(await usesDb('crewTasks', crewId))) return 'not-db-crew'
  const rows = await prisma.crewTaskProposal.findMany({
    where: { crewId, status: 'PENDING', ...(opts.recordingId ? { recordingId: opts.recordingId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 60,
    select: { id: true },
  })
  const report: ApplyAllReport = { applied: 0, skipped: [] }
  for (const { id } of rows) {
    const r = await applyProposal(id, actor)
    if (r.result === 'applied') report.applied++
    else if (r.result === 'needs-lead' || r.result === 'needs-confirm' || r.result === 'conflict' || r.result === 'missing-task' || r.result === 'failed' || r.result === 'not-pending' || r.result === 'disabled' || r.result === 'expired') report.skipped.push({ id, reason: r.result })
    else report.skipped.push({ id, reason: 'failed' })
  }
  return report
}

export type UndoOutcome = 'undone' | 'not-found' | 'forbidden' | 'not-undoable'

/** Undo an applied RETIRE: the task is shown again. Same permission as applying. */
export async function undoRetire(id: string, actor: string, now = new Date()): Promise<UndoOutcome> {
  const row = await prisma.crewTaskProposal.findUnique({ where: { id }, select: { crewId: true, kind: true, status: true, taskId: true } })
  if (!row) return 'not-found'
  if (!(await canManageCrew(actor, row.crewId))) return 'forbidden'
  if (row.kind !== 'RETIRE' || row.status !== 'APPLIED' || !row.taskId) return 'not-undoable'
  const ok = await unarchiveCrewTask(row.crewId, row.taskId, actor, { via: 'call-proposal-undo', proposalId: id })
  if (!ok) return 'not-undoable'
  await prisma.crewTaskProposal.updateMany({ where: { id, status: 'APPLIED' }, data: { status: 'UNDONE', decidedBy: actor, decidedAt: now } })
  return 'undone'
}
