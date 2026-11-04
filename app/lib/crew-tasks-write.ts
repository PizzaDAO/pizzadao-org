/**
 * Row-level writes for crew tasks, shared by the crew-lead editor (sheets-import/crew-content.ts)
 * and the call task proposals (call-tasks/apply.ts), so both paths behave the same: `doneAt`
 * follows the stage, new rows get a fresh natural key and go to the end of the list, every change
 * writes a CrewTaskEvent, and nothing is ever deleted (retiring sets `archived`).
 */
import { prisma } from '@/app/lib/db'
import { invalidateCrewMappingsCache, isClosedStage } from '@/app/lib/crew-mappings'
import { normalizeLabel } from '@/app/lib/sheets-import/plan'

/** A natural key not used yet in this crew (web-created rows still match a later re-import by label). */
export function freshKey(label: string, taken: Set<string>): string {
  const base = normalizeLabel(label) || 'item'
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}#${n}`
  taken.add(key)
  return key
}

/** `doneAt` for a stage change: set when the task closes, kept while it stays closed, cleared on reopening. */
export function nextDoneAt(stage: string, prev: { stage?: string | null; doneAt?: Date | null } | undefined, now: Date = new Date()): Date | null {
  if (!isClosedStage(stage)) return null
  const wasClosed = prev ? isClosedStage(String(prev.stage ?? '')) : false
  return wasClosed ? (prev?.doneAt ?? now) : now
}

export type NewTaskInput = {
  label: string
  stage?: string
  priority?: string | null
  due?: string | null
  leadName?: string | null
  leadMemberId?: string | null
  notes?: string | null
  url?: string | null
  goal?: string | null
}

export type TaskPatch = Partial<{
  label: string
  stage: string
  priority: string | null
  due: string | null
  leadName: string | null
  leadMemberId: string | null
  notes: string | null
}>

export type TaskEventData = Record<string, unknown>

/** Create a task at the end of the crew's list and write its `create` event. Returns the new task id. */
export async function createCrewTask(crewId: string, input: NewTaskInput, actor: string, eventData: TaskEventData = {}): Promise<string> {
  const rows = await prisma.crewTask.findMany({ where: { crewId }, select: { naturalKey: true, position: true } })
  const taken = new Set(rows.map((r) => r.naturalKey))
  const position = rows.reduce((m, r) => Math.max(m, r.position), -1) + 1
  const stage = input.stage ?? 'todo'
  const created = await prisma.crewTask.create({
    data: {
      crewId,
      naturalKey: freshKey(input.label, taken),
      label: input.label,
      url: input.url ?? null,
      stage,
      priority: input.priority ?? null,
      goal: input.goal ?? null,
      due: input.due ?? null,
      leadName: input.leadName ?? null,
      leadMemberId: input.leadMemberId ?? null,
      notes: input.notes ?? null,
      position,
      doneAt: nextDoneAt(stage, undefined),
      createdBy: actor,
      updatedBy: actor,
    },
    select: { id: true },
  })
  await prisma.crewTaskEvent.create({ data: { taskId: created.id, crewId, action: 'create', actor, data: { ...eventData, label: input.label } as never } })
  await invalidateCrewMappingsCache()
  return created.id
}

/**
 * Update a task, only if it still has the `updatedAt` the caller read (`expectUpdatedAt`; pass null
 * to skip that check). Returns false when the task changed meanwhile (nothing written).
 */
export async function updateCrewTask(
  crewId: string,
  taskId: string,
  patch: TaskPatch,
  actor: string,
  opts: { expectUpdatedAt: Date | null; prev: { stage?: string | null; doneAt?: Date | null; due?: string | null; dueRaw?: string | null }; eventData?: TaskEventData },
): Promise<boolean> {
  const data: Record<string, unknown> = { ...patch, updatedBy: actor }
  if (patch.stage !== undefined) data.doneAt = nextDoneAt(patch.stage, opts.prev)
  // The sheet's own due text only stays while the date is unchanged.
  if (patch.due !== undefined && (opts.prev.due ?? null) !== patch.due) data.dueRaw = null
  const where: Record<string, unknown> = { id: taskId, crewId, archived: false }
  if (opts.expectUpdatedAt) where.updatedAt = opts.expectUpdatedAt
  const res = await prisma.crewTask.updateMany({ where, data: data as never })
  if (res.count !== 1) return false
  await prisma.crewTaskEvent.create({ data: { taskId, crewId, action: 'update', actor, data: { ...(opts.eventData ?? {}), changes: patch } as never } })
  await invalidateCrewMappingsCache()
  return true
}

/** Retire (hide) a task, with the same stale check as updateCrewTask. Never deletes. */
export async function archiveCrewTask(crewId: string, taskId: string, actor: string, opts: { expectUpdatedAt: Date | null; eventData?: TaskEventData }): Promise<boolean> {
  const where: Record<string, unknown> = { id: taskId, crewId, archived: false }
  if (opts.expectUpdatedAt) where.updatedAt = opts.expectUpdatedAt
  const res = await prisma.crewTask.updateMany({ where, data: { archived: true, updatedBy: actor } })
  if (res.count !== 1) return false
  await prisma.crewTaskEvent.create({ data: { taskId, crewId, action: 'archive', actor, data: (opts.eventData ?? {}) as never } })
  await invalidateCrewMappingsCache()
  return true
}
