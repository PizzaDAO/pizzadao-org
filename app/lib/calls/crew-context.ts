/**
 * Crew context for the live call view: the crew's goals, open tasks, leads and its agenda link, so
 * people on the call know what the crew is working on. Read from the crew database content (or the
 * crew sheet while the crew still lives there); every part is best effort and fails to empty.
 * Built once per minute per crew and instance (the same data the crew page shows, nothing private).
 */
import { getCrewMappings, fetchOpenCrewTasksForCrew, isClosedStage } from '@/app/lib/crew-mappings'
import { crewContentFromDb } from '@/app/lib/crew-content'
import { getCrewRoster, isLeadStatus } from '@/app/lib/crew-leads'
import { usesDb } from '@/app/lib/sheets-import/source'
import { parseAgendaLinks } from '@/app/lib/call-agenda/rank'
import type { Settings } from '@/app/lib/settings'
import type { PersonRef } from './live-members'

export const CREW_CONTEXT_TTL_MS = 60_000
export const MAX_CONTEXT_GOALS = 5
export const MAX_CONTEXT_TASKS = 8
export const MAX_CONTEXT_LEADS = 6

export interface CrewContext {
  id: string
  label: string
  /** App path of the crew page. */
  pagePath: string
  goals: string[]
  tasks: Array<{ label: string; url: string | null; lead: string | null }>
  openTaskCount: number
  leads: PersonRef[]
  /** The crew's call guide / agenda link from calls.agendaLinks, when one is set. */
  link: { label: string; url: string } | null
}

export const crewPagePath = (crewId: string) => `/crew/${encodeURIComponent(crewId)}`

const cache = new Map<string, { at: number; value: Promise<CrewContext> }>()
export function clearCrewContextCache(): void {
  cache.clear()
}

async function build(crewId: string, label: string, settings: Settings): Promise<CrewContext> {
  const out: CrewContext = { id: crewId, label, pagePath: crewPagePath(crewId), goals: [], tasks: [], openTaskCount: 0, leads: [], link: null }
  out.link = parseAgendaLinks(String(settings.get('calls.agendaLinks') ?? '')).get(crewId.toLowerCase()) ?? null
  const work: Promise<void>[] = []
  work.push(
    (async () => {
      if (await usesDb('crewTasks', crewId)) {
        const c = await crewContentFromDb(crewId)
        out.goals = c.goals.map((g) => g.description.trim()).filter(Boolean).slice(0, MAX_CONTEXT_GOALS)
        const open = c.tasks.filter((t) => t.task.trim() && !isClosedStage(t.stage))
        out.openTaskCount = open.length
        out.tasks = open.slice(0, MAX_CONTEXT_TASKS).map((t) => ({ label: t.task.trim(), url: t.url ?? null, lead: t.lead.trim() || null }))
        return
      }
      const { crews } = await getCrewMappings()
      const crew = crews.find((c) => c.id === crewId)
      if (!crew) return
      const { tasks } = await fetchOpenCrewTasksForCrew(crew)
      out.openTaskCount = tasks.length
      out.tasks = tasks.slice(0, MAX_CONTEXT_TASKS).map((t) => ({ label: t.label, url: t.url ?? null, lead: null }))
    })().catch(() => {}),
    (async () => {
      const roster = await getCrewRoster(crewId)
      out.leads = roster
        .filter((m) => m.name.trim() && isLeadStatus(m.status))
        .slice(0, MAX_CONTEXT_LEADS)
        .map((m) => ({ name: m.name.trim(), memberId: m.id || null }))
    })().catch(() => {}),
  )
  await Promise.all(work)
  return out
}

export function loadCrewContext(crewId: string, label: string, settings: Settings, now: number = Date.now()): Promise<CrewContext> {
  const hit = cache.get(crewId)
  if (hit && now - hit.at < CREW_CONTEXT_TTL_MS) return hit.value
  const value = build(crewId, label, settings)
  cache.set(crewId, { at: now, value })
  if (cache.size > 50) for (const k of cache.keys()) if (k !== crewId) cache.delete(k)
  return value
}
