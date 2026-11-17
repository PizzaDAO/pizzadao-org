/**
 * Reads for /task: the open and your own crew tasks, and the autocomplete choices for claim / drop.
 * Crew tasks that still live in a Google Sheet are left out (their crew page is the place for those);
 * production reads every crew from the database. Everything is a select-limited query, cheap enough for
 * Discord's 3-second autocomplete window.
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings, getPriorityRank, isClosedStage } from '@/app/lib/crew-mappings'
import { realCrews } from '@/app/lib/crew-id'
import { usesDb } from '@/app/lib/sheets-import/source'
import { cutChars } from './text'
import type { TaskRow } from './task-command'

/** Stages that close a task (mirror of isClosedStage), for the database filter. */
const CLOSED = ['done', 'skip', 'skipped', 'complete', 'completed']
const notClosed = { NOT: { OR: CLOSED.map((s) => ({ stage: { equals: s, mode: 'insensitive' as const } })) } }
const unclaimed = { OR: [{ leadMemberId: null }, { leadMemberId: '' }] }
const SELECT = { id: true, crewId: true, label: true, stage: true, priority: true, due: true, position: true } as const

/** Ids of the real crews whose tasks are read from the database. */
async function dbCrewIds(crewId?: string): Promise<{ ids: string[]; labels: Map<string, string> }> {
  const { crews } = await getCrewMappings()
  const real = realCrews(crews).filter((c) => !crewId || c.id === crewId)
  const flags = await Promise.all(real.map((c) => usesDb('crewTasks', c.id)))
  return { ids: real.filter((_, i) => flags[i]).map((c) => c.id), labels: new Map(real.map((c) => [c.id, c.label])) }
}

type Row = { id: string; crewId: string; label: string; stage: string; priority: string | null; due: string | null; position: number }
const toRow = (r: Row): TaskRow => ({ id: r.id, crewId: r.crewId, label: r.label, stage: r.stage, priority: r.priority, due: r.due })

/** Priority rank, then due date (soonest first, none last), then crew, then the crew's own order. */
export function sortTasks<T extends Row>(rows: T[], labels: Map<string, string>): T[] {
  const dueKey = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d : '9999-99-99')
  return [...rows].sort(
    (a, b) =>
      getPriorityRank(a.priority ?? '') - getPriorityRank(b.priority ?? '') ||
      dueKey(a.due).localeCompare(dueKey(b.due)) ||
      (labels.get(a.crewId) ?? a.crewId).localeCompare(labels.get(b.crewId) ?? b.crewId) ||
      a.position - b.position,
  )
}

/** Open (not closed, nobody leads it) tasks of the database crews, best first; one crew when `crewId` is given. */
export async function openCrewTasks(crewId?: string): Promise<TaskRow[]> {
  const { ids, labels } = await dbCrewIds(crewId)
  if (ids.length === 0) return []
  const rows = await prisma.crewTask.findMany({
    where: { crewId: { in: ids }, archived: false, AND: [unclaimed, notClosed] },
    select: SELECT,
  })
  return sortTasks(rows.filter((r) => r.label.trim() && !isClosedStage(r.stage)), labels).map(toRow)
}

/** Open tasks this member leads (by member id), database crews only. */
export async function myCrewTasks(memberId: string): Promise<TaskRow[]> {
  const { ids, labels } = await dbCrewIds()
  if (ids.length === 0) return []
  const rows = await prisma.crewTask.findMany({
    where: { crewId: { in: ids }, archived: false, leadMemberId: String(memberId), ...notClosed },
    select: SELECT,
  })
  return sortTasks(rows.filter((r) => r.label.trim() && !isClosedStage(r.stage)), labels).map(toRow)
}

/** `Crew · label`, at most 100 characters (Discord's limit for a choice name), cut by code points. */
export const taskChoice = (t: { id: string; crewId: string; label: string }, labels: Map<string, string>) => ({
  name: cutChars(`${labels.get(t.crewId) ?? t.crewId} · ${t.label.replace(/\s+/g, ' ').trim()}`, 100),
  value: t.id,
})

/** claim: open tasks nobody leads. drop: your own open tasks. The value is the task id (a string). */
export async function taskPickChoices(kind: 'claim' | 'drop', memberId: string | null, query: string): Promise<Array<{ name: string; value: string }>> {
  if (kind === 'drop' && !memberId) return []
  const { ids, labels } = await dbCrewIds()
  if (ids.length === 0) return []
  const q = query.trim()
  const rows = await prisma.crewTask.findMany({
    where: {
      crewId: { in: ids },
      archived: false,
      AND: [kind === 'claim' ? unclaimed : { leadMemberId: String(memberId) }, notClosed, ...(q ? [{ label: { contains: q, mode: 'insensitive' as const } }] : [])],
    },
    orderBy: [{ crewId: 'asc' }, { position: 'asc' }],
    take: 25,
    select: SELECT,
  })
  return rows.filter((r) => r.label.trim() && !isClosedStage(r.stage)).map((r) => taskChoice(r, labels))
}
