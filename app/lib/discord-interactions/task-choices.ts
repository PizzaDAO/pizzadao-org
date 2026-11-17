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
import { leadCrewIds } from '@/app/lib/crew-leads'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { cutChars } from './text'
import { normalizeForDedupe } from './task-add'
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

/** An open (not archived, not closed) task of the crew whose normalized label equals `label`, or null. */
export async function findOpenDuplicate(crewId: string, label: string): Promise<TaskRow | null> {
  const key = normalizeForDedupe(label)
  if (!key) return null
  const rows = await prisma.crewTask.findMany({ where: { crewId, archived: false, ...notClosed }, select: SELECT })
  const hit = rows.find((r) => !isClosedStage(r.stage) && normalizeForDedupe(r.label) === key)
  return hit ? toRow(hit) : null
}

/**
 * /task add's `crew` choices: real crews whose tasks are in the database (a sheet crew is refused in
 * the deferred step), the ones the caller can manage first (alphabetical), then the rest. Admin roles
 * mean every crew is manageable; otherwise the caller's lead crews come from `leadCrewIds`. Only a
 * hint: permission is always checked by canManageCrew when the command runs.
 */
export async function addCrewChoices(memberId: string | null, query: string, roles: string[] = []): Promise<Array<{ name: string; value: string }>> {
  const { ids, labels } = await dbCrewIds()
  const q = query.trim().toLowerCase()
  const isAdmin = roles.some((r) => (ADMIN_ROLE_IDS as readonly string[]).includes(r))
  const mine = isAdmin ? new Set(ids) : await leadCrewIds(memberId)
  const byLabel = (a: string, b: string) => (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b)
  const shown = ids.filter((id) => !q || (labels.get(id) ?? id).toLowerCase().includes(q) || id.includes(q))
  const ordered = [...shown.filter((id) => mine.has(id)).sort(byLabel), ...shown.filter((id) => !mine.has(id)).sort(byLabel)]
  return ordered.slice(0, 25).map((id) => ({ name: cutChars(labels.get(id) ?? id, 100), value: id }))
}
