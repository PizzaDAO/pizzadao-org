/**
 * Crew tasks, agenda steps and goals from the database (plans/sheets-cutover.md PR 4), in the same
 * shapes the crew sheet paths return, so the crew page, "my tasks", the dashboard and the call
 * agenda do not change. Used once `sheets.source.crewTasks` covers the crew.
 */
import { prisma } from '@/app/lib/db'
import { isActiveStage, isClosedStage } from '@/app/lib/crew-mappings'
import type { CrewSheetAgendaStep, CrewSheetGoal, CrewSheetTask } from '@/app/lib/crew-sheet'

export type DbCrewTask = {
  id: string
  crewId: string
  label: string
  url: string | null
  stage: string
  priority: string | null
  goal: string | null
  due: string | null
  dueRaw: string | null
  leadName: string | null
  leadMemberId: string | null
  notes: string | null
  position: number
}

/** Every task of a crew that was not removed on the website, in order. */
export async function loadCrewTasks(crewId: string): Promise<DbCrewTask[]> {
  return prisma.crewTask.findMany({ where: { crewId, archived: false }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
}

/** A task as the crew page shows it (the same fields the sheet parser returns). */
export function toPageTask(t: DbCrewTask): Omit<CrewSheetTask, 'sheetRow' | 'dueCell'> & { id: string } {
  return {
    id: t.id,
    priority: t.priority ?? '',
    stage: t.stage,
    goal: t.goal ?? '',
    task: t.label,
    url: t.url,
    dueDate: t.dueRaw ?? t.due ?? '',
    lead: t.leadName ?? '',
    leadId: t.leadMemberId ?? '',
    notes: t.notes ?? '',
  }
}

/** The crew page sections that live in the database. */
export async function crewContentFromDb(crewId: string): Promise<{
  tasks: Array<ReturnType<typeof toPageTask>>
  goals: CrewSheetGoal[]
  agenda: CrewSheetAgendaStep[]
}> {
  const [tasks, goals, agenda] = await Promise.all([
    loadCrewTasks(crewId),
    prisma.crewGoal.findMany({ where: { crewId, archived: false }, orderBy: { position: 'asc' } }),
    prisma.crewAgendaStep.findMany({ where: { crewId, archived: false }, orderBy: { position: 'asc' } }),
  ])
  return {
    tasks: tasks.map(toPageTask),
    goals: goals.map((g) => ({ priority: g.priority ?? '', description: g.description })),
    agenda: agenda.map((a) => ({ time: a.time ?? '', lead: a.leadName ?? '', step: a.step, stepUrl: a.stepUrl, action: a.action ?? '', notes: a.notes ?? '' })),
  }
}

/**
 * A member's open tasks in a crew (they are the lead, the task is active) and how many tasks they
 * closed there. The sheet path read "Closed" from the crew roster; here it is the number of closed
 * tasks the member leads.
 */
export async function myTasksFromDb(crewId: string, memberId: string): Promise<{ active: Array<{ label: string; url?: string }>; doneCount: number }> {
  const id = String(memberId).trim()
  if (!id) return { active: [], doneCount: 0 }
  const rows = await prisma.crewTask.findMany({ where: { crewId, archived: false, leadMemberId: id }, orderBy: { position: 'asc' } })
  const active: Array<{ label: string; url?: string }> = []
  let doneCount = 0
  for (const t of rows) {
    if (isClosedStage(t.stage)) doneCount++
    else if (isActiveStage(t.stage) && t.label && !active.some((a) => a.label === t.label)) active.push({ label: t.label, url: t.url ?? undefined })
  }
  return { active, doneCount }
}
