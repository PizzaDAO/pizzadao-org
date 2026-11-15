/**
 * Routing new tasks from a call that is not a crew call (the Community Call) to the crew they fit.
 * Pure: run.ts builds the crew list (real crews whose tasks are edited on the website, minus the
 * privately excluded ones), the model picks a crew id per CREATE, and routeCrew validates it. A
 * missing or unknown pick falls back to `calls.taskProposalsDefaultCrew`. No crew names live in code.
 */
import { normalizeCrewId } from '@/app/lib/crew-id'

export interface RoutingCrew {
  id: string
  label: string
  /** What the crew works on, from `calls.taskProposalsCrewHints` (may be empty). */
  hint: string
  /** A few of the crew's open task labels, for context. */
  examples: string[]
}

export interface Routing {
  crews: RoutingCrew[]
  /** Crew id used when the model is unsure or names an unknown crew; null = no fallback. */
  fallback: string | null
}

const HINT_LINE = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/

/** `calls.taskProposalsCrewHints`: one "crew_id: what it works on" per line. Bad lines are ignored. */
export function parseCrewHints(raw: unknown): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const m = line.match(HINT_LINE)
    if (!m) continue
    const id = normalizeCrewId(m[1])
    if (id && !out.has(id)) out.set(id, m[2].replace(/\s+/g, ' ').slice(0, 300))
  }
  return out
}

/** Every non-empty line must look like "crew_id: text" (settings check). */
export function validCrewHints(v: string): boolean {
  return v
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .every((l) => HINT_LINE.test(l))
}

export function buildRouting(
  crews: ReadonlyArray<{ id: string; label: string; tasks?: Array<{ label: string }> }>,
  hints: ReadonlyMap<string, string>,
  defaultCrew: string | null | undefined,
): Routing {
  const list: RoutingCrew[] = crews.map((c) => ({
    id: c.id,
    label: c.label,
    hint: hints.get(normalizeCrewId(c.id)) ?? '',
    examples: (c.tasks ?? []).map((t) => t.label.replace(/\s+/g, ' ').slice(0, 80)).filter(Boolean).slice(0, 3),
  }))
  const fb = normalizeCrewId(defaultCrew)
  return { crews: list, fallback: list.some((c) => c.id === fb) ? fb : null }
}

/** The model's crew pick, checked against the list (by id, then by name). Unknown or empty: the fallback. */
export function routeCrew(raw: string | null | undefined, routing: Routing): string | null {
  const text = String(raw ?? '').trim()
  if (text) {
    const id = normalizeCrewId(text)
    const byId = routing.crews.find((c) => normalizeCrewId(c.id) === id)
    if (byId) return byId.id
    const byLabel = routing.crews.find((c) => c.label.trim().toLowerCase() === text.toLowerCase())
    if (byLabel) return byLabel.id
  }
  return routing.fallback
}

/** Whether a crew id is one of the routing targets (re-checked when a decider changes the crew). */
export function isRoutingTarget(id: string | null | undefined, routing: Routing): boolean {
  const n = normalizeCrewId(id)
  return !!n && routing.crews.some((c) => c.id === n)
}

export function routingPromptSection(routing: Routing): string {
  const lines = routing.crews.map((c) => {
    const bits = [c.hint, c.examples.length ? `open tasks include: ${c.examples.join('; ')}` : ''].filter(Boolean)
    return `- ${c.id} (${c.label.replace(/\s+/g, ' ').slice(0, 60)})${bits.length ? `: ${bits.join('. ')}` : ''}`
  })
  return `Crews a new task can go to (use the id):\n${lines.join('\n')}`
}

export const ROUTING_SYSTEM_RULE =
  '- This call is not a crew call, so it has no crew of its own. For each CREATE, set crew to the id of the listed crew whose work the new task fits best; set it to null when no crew clearly fits. For UPDATE, DONE and RETIRE set crew to null.'
