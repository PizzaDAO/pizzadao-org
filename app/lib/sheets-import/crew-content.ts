/**
 * Crew tasks, agenda steps and goals (plans/sheets-cutover.md PR 4): importer from every crew
 * sheet, parity check of the open-task ranking (what the crew list and the call agenda use), and
 * the crew-lead editors for the crew page.
 */
import { prisma } from '@/app/lib/db'
import { getAgendaStepLinks, getTaskLinks } from '@/app/api/lib/google-sheets'
import { fetchCrewTasksFromDb, fetchOpenCrewTasksResult, getCrewMappings, invalidateCrewMappingsCache, isClosedStage, parseSheetDue } from '@/app/lib/crew-mappings'
import { extractSheetId, parseCrewSheetRows } from '@/app/lib/crew-sheet'
import { crewContentFromDb } from '@/app/lib/crew-content'
import { fetchGviz } from '@/app/lib/sheets/gviz'
import { getSheetData } from '@/app/lib/sheets/member-repository'
import { compareKeyed, type Importer, type ParityReport, type ParseIssue } from './framework'
import { labelKeys, stableEqual } from './plan'
import { freshKey, nextDoneAt } from '@/app/lib/crew-tasks-write'
import { isHttpUrlOrEmpty, type EditorRow, type EditorSpec, type SaveCounts } from './editor'

// ---------------------------------------------------------------------------
// Records (one union so a single import run covers all three sections)
// ---------------------------------------------------------------------------

export type TaskRecord = {
  kind: 'task'
  crewId: string
  naturalKey: string
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
  archived: boolean
}
export type AgendaRecord = {
  kind: 'agenda'
  crewId: string
  naturalKey: string
  position: number
  time: string | null
  step: string
  stepUrl: string | null
  action: string | null
  leadName: string | null
  notes: string | null
  archived: boolean
}
export type GoalRecord = { kind: 'goal'; crewId: string; naturalKey: string; position: number; description: string; priority: string | null; archived: boolean }
export type ContentRecord = TaskRecord | AgendaRecord | GoalRecord

const nz = (v: string | null | undefined) => (v && v.trim() ? v : null)
const recordKey = (r: { kind: string; crewId: string; naturalKey: string }) => `${r.kind}|${r.crewId}|${r.naturalKey}`

/** Records for one crew sheet (GViz headers=0 rows + the hyperlink maps). Pure. */
export function crewContentRecords(
  crewId: string,
  rows: unknown[],
  taskLinks: Record<string, string>,
  agendaLinks: Record<string, string>,
): { records: ContentRecord[]; foundTasks: boolean } {
  const parsed = parseCrewSheetRows(rows as never[], taskLinks, agendaLinks)
  const records: ContentRecord[] = []
  const taskKeys = labelKeys('', parsed.tasks.map((t) => t.task)).map((k) => k.slice(1))
  parsed.tasks.forEach((t, i) => {
    records.push({
      kind: 'task',
      crewId,
      naturalKey: taskKeys[i],
      label: t.task,
      url: nz(t.url),
      // A blank stage stays blank: the sheet ranks it as not active, and the crew page shows it empty.
      stage: t.stage,
      priority: nz(t.priority),
      goal: nz(t.goal),
      due: parseSheetDue(t.dueCell as never) ?? null,
      dueRaw: nz(t.dueDate),
      leadName: nz(t.lead),
      leadMemberId: nz(t.leadId),
      notes: nz(t.notes),
      position: i,
      archived: false,
    })
  })
  const agendaKeys = labelKeys('', parsed.agenda.map((a) => a.step || a.action)).map((k) => k.slice(1))
  parsed.agenda.forEach((a, i) => {
    records.push({
      kind: 'agenda',
      crewId,
      naturalKey: agendaKeys[i],
      position: i,
      time: nz(a.time),
      step: a.step,
      stepUrl: nz(a.stepUrl),
      action: nz(a.action),
      leadName: nz(a.lead),
      notes: nz(a.notes),
      archived: false,
    })
  })
  const goalKeys = labelKeys('', parsed.goals.map((g) => g.description)).map((k) => k.slice(1))
  parsed.goals.forEach((g, i) => {
    records.push({ kind: 'goal', crewId, naturalKey: goalKeys[i], position: i, description: g.description, priority: nz(g.priority), archived: false })
  })
  return { records, foundTasks: parsed.tasks.length > 0 }
}

export async function readCrewSheetRows(sheetId: string): Promise<{ rows: unknown[]; taskLinks: Record<string, string>; agendaLinks: Record<string, string> }> {
  const [gviz, taskLinks, agendaLinks] = await Promise.all([fetchGviz(sheetId, { headers: 0 }, { fresh: true }), getTaskLinks(sheetId), getAgendaStepLinks(sheetId)])
  return { rows: gviz?.table?.rows ?? [], taskLinks, agendaLinks }
}

export const crewContentImporter: Importer<ContentRecord> = {
  key: 'crewContent',
  async load() {
    const { crews } = await getCrewMappings(true)
    const issues: ParseIssue[] = []
    const records: Array<{ key: string; value: ContentRecord }> = []
    const extra: Record<string, number> = { crews: 0, crewsWithoutSheet: 0, crewsWithoutTasks: 0, unreadableSheets: 0, unresolvedLeadIds: 0, doneTasks: 0, skippedDbCrews: 0 }
    // Crews already edited on the website (a per-crew pilot) are left alone.
    const { getSource, readsFromDb } = await import('./source')
    const source = await getSource('crewTasks')
    let memberIds: Map<string, number> | null = null
    try {
      memberIds = (await getSheetData()).memberToIdx
    } catch {
      memberIds = null
    }
    for (const crew of crews) {
      extra.crews++
      if (readsFromDb(source, crew.id)) {
        extra.skippedDbCrews++
        continue
      }
      const sheetId = crew.sheet ? extractSheetId(crew.sheet) : null
      if (!sheetId) {
        extra.crewsWithoutSheet++
        continue
      }
      try {
        const { rows, taskLinks, agendaLinks } = await readCrewSheetRows(sheetId)
        const { records: recs, foundTasks } = crewContentRecords(crew.id, rows, taskLinks, agendaLinks)
        if (!foundTasks) extra.crewsWithoutTasks++
        for (const r of recs) {
          if (r.kind === 'task') {
            if (isClosedStage(r.stage)) extra.doneTasks++
            if (r.leadMemberId && memberIds && !memberIds.has(r.leadMemberId)) {
              extra.unresolvedLeadIds++
              issues.push({ row: r.position + 1, code: 'lead-id-not-a-member', scope: crew.id })
            }
          }
          records.push({ key: recordKey(r), value: r })
        }
      } catch {
        extra.unreadableSheets++
        issues.push({ row: 0, code: 'sheet-unreadable', scope: crew.id })
      }
    }
    return { records, issues, extra }
  },
  async existing() {
    const [tasks, agenda, goals] = await Promise.all([prisma.crewTask.findMany(), prisma.crewAgendaStep.findMany(), prisma.crewGoal.findMany()])
    const map = new Map<string, ContentRecord>()
    for (const t of tasks) {
      const r: TaskRecord = {
        kind: 'task', crewId: t.crewId, naturalKey: t.naturalKey, label: t.label, url: t.url, stage: t.stage, priority: t.priority, goal: t.goal,
        due: t.due, dueRaw: t.dueRaw, leadName: t.leadName, leadMemberId: t.leadMemberId, notes: t.notes, position: t.position, archived: t.archived,
      }
      map.set(recordKey(r), r)
    }
    for (const a of agenda) {
      const r: AgendaRecord = {
        kind: 'agenda', crewId: a.crewId, naturalKey: a.naturalKey, position: a.position, time: a.time, step: a.step, stepUrl: a.stepUrl,
        action: a.action, leadName: a.leadName, notes: a.notes, archived: a.archived,
      }
      map.set(recordKey(r), r)
    }
    for (const g of goals) {
      const r: GoalRecord = { kind: 'goal', crewId: g.crewId, naturalKey: g.naturalKey, position: g.position, description: g.description, priority: g.priority, archived: g.archived }
      map.set(recordKey(r), r)
    }
    return map
  },
  async apply(plan, progress) {
    const ops = [...plan.create, ...plan.update].map(({ value }) => {
      const where = { crewId_naturalKey: { crewId: value.crewId, naturalKey: value.naturalKey } }
      if (value.kind === 'task') {
        const { kind: _k, ...data } = value
        const doneAt = isClosedStage(data.stage) ? new Date() : null
        return prisma.crewTask.upsert({ where, create: { ...data, doneAt, createdBy: 'sheet-import', updatedBy: 'sheet-import' }, update: { ...data, updatedBy: 'sheet-import' } })
      }
      if (value.kind === 'agenda') {
        const { kind: _k, ...data } = value
        return prisma.crewAgendaStep.upsert({ where, create: { ...data, updatedBy: 'sheet-import' }, update: { ...data, updatedBy: 'sheet-import' } })
      }
      const { kind: _k, ...data } = value
      return prisma.crewGoal.upsert({ where, create: { ...data, updatedBy: 'sheet-import' }, update: { ...data, updatedBy: 'sheet-import' } })
    })
    // Chunked so one huge transaction does not hit the connection timeout; progress is logged so a
    // failure part-way shows how far it got (re-running the apply finishes the rest).
    for (let i = 0; i < ops.length; i += 100) {
      await prisma.$transaction(ops.slice(i, i + 100))
      progress(Math.min(i + 100, ops.length))
    }
    await invalidateCrewMappingsCache()
  },
}

/**
 * Per crew, the ranked open tasks (label, priority, stage, due, in order) the crew list and the
 * call agenda use, plus the agenda steps and goals the crew page shows: sheet vs database.
 */
export async function crewContentParity(): Promise<ParityReport> {
  const { crews } = await getCrewMappings(true)
  const sheet = new Map<string, unknown>()
  const db = new Map<string, unknown>()
  const byScope: Record<string, number> = {}
  let excluded = 0
  for (const crew of crews) {
    const sheetId = crew.sheet ? extractSheetId(crew.sheet) : null
    if (!sheetId) continue
    const [s, d, rows, content] = await Promise.all([
      fetchOpenCrewTasksResult(crew.sheet!),
      fetchCrewTasksFromDb(crew.id, true),
      readCrewSheetRows(sheetId).catch(() => null),
      crewContentFromDb(crew.id),
    ])
    const local = { sheet: new Map<string, unknown>(), db: new Map<string, unknown>() }
    const shown = (t: { label: string; priority?: string; stage: string; due?: string }) => ({ label: collapseSpaces(t.label), priority: t.priority ?? null, stage: t.stage, due: t.due ?? null })
    const parsed = rows ? parseCrewSheetRows(rows.rows as never[], rows.taskLinks, rows.agendaLinks) : null
    const { kept, outside } = parsed ? openTasksInTaskSection(s.tasks, parsed.tasks) : { kept: s.tasks, outside: 0 }
    excluded += outside
    kept.forEach((t, i) => local.sheet.set(`${crew.id}:open:${i}`, shown(t)))
    ;(d.all ?? []).forEach((t, i) => local.db.set(`${crew.id}:open:${i}`, shown(t)))
    if (parsed) {
      parsed.agenda.forEach((a, i) => local.sheet.set(`${crew.id}:agenda:${i}`, { step: a.step, action: a.action, lead: a.lead, time: a.time }))
      parsed.goals.forEach((g, i) => local.sheet.set(`${crew.id}:goal:${i}`, { description: g.description, priority: g.priority }))
    }
    content.agenda.forEach((a, i) => local.db.set(`${crew.id}:agenda:${i}`, { step: a.step, action: a.action, lead: a.lead, time: a.time }))
    content.goals.forEach((g, i) => local.db.set(`${crew.id}:goal:${i}`, { description: g.description, priority: g.priority }))
    const r = compareKeyed(crew.id, local.sheet, local.db)
    byScope[crew.id] = r.mismatches + r.onlyInDb + r.onlyInSheet
    for (const [k, v] of local.sheet) sheet.set(k, v)
    for (const [k, v] of local.db) db.set(k, v)
  }
  return { ...compareKeyed('crewContent', sheet, db, stableEqual), byScope, excluded }
}

const collapseSpaces = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * The sheet ranking path reads every row below the task header to the end of the sheet, so the
 * header and rows of a later section (goals, an issue log) show up there as "open tasks". The crew
 * page and the importer stop at the next section. Those rows are left out of the comparison (and
 * counted) rather than imported as tasks. Labels compare with runs of spaces collapsed, as the
 * crew page shows them. Removing rows from a stably ranked list keeps the rest in ranked order.
 */
export function openTasksInTaskSection<T extends { label: string }>(ranked: readonly T[], sectionTasks: ReadonlyArray<{ task: string }>): { kept: T[]; outside: number } {
  const left = new Map<string, number>()
  for (const t of sectionTasks) {
    const k = collapseSpaces(t.task.replace(/\s*\(https?:\/\/[^\s\)]+\)\s*/g, ' '))
    left.set(k, (left.get(k) ?? 0) + 1)
  }
  const kept: T[] = []
  let outside = 0
  for (const t of ranked) {
    const k = collapseSpaces(t.label)
    const n = left.get(k) ?? 0
    if (n > 0) {
      left.set(k, n - 1)
      kept.push(t)
    } else outside++
  }
  return { kept, outside }
}

// ---------------------------------------------------------------------------
// Crew-lead editors (one spec per crew and section)
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const orNull = (v: unknown) => (text(v) ? text(v) : null)
const idKey = (row: EditorRow, index: number) => (row.id ? `id:${row.id}` : `new:${index}`)

export type Row = { id: string; naturalKey: string; archived: boolean } & Record<string, unknown>

/**
 * Shared save for the crew editors: rows are matched by id; new rows are created; rows that
 * disappeared are archived (never deleted). `fields` builds the stored fields from an edited row.
 */
export async function saveCrewRows(o: {
  rows: EditorRow[]
  existing: Row[]
  fields: (row: EditorRow, position: number, prev: Row | undefined) => Record<string, unknown>
  labelOf: (row: EditorRow) => string
  create: (data: Record<string, unknown>) => unknown
  update: (id: string, data: Record<string, unknown>) => unknown
  onChange?: (kind: 'create' | 'update' | 'archive', id: string | null, data: Record<string, unknown>) => unknown[]
}): Promise<SaveCounts> {
  const byId = new Map(o.existing.map((r) => [r.id, r]))
  const taken = new Set(o.existing.map((r) => r.naturalKey))
  const counts: SaveCounts = { created: 0, updated: 0, deactivated: 0, unchanged: 0 }
  const ops: unknown[] = []
  const kept = new Set<string>()
  o.rows.forEach((row, position) => {
    const prev = row.id ? byId.get(String(row.id)) : undefined
    const data = o.fields(row, position, prev)
    if (prev) {
      kept.add(prev.id)
      const changed = prev.archived || Object.entries(data).some(([k, v]) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(v ?? null))
      if (!changed) {
        counts.unchanged++
        return
      }
      counts.updated++
      ops.push(o.update(prev.id, { ...data, archived: false }))
      ops.push(...(o.onChange?.('update', prev.id, data) ?? []))
    } else {
      counts.created++
      const createData = { ...data, naturalKey: freshKey(o.labelOf(row), taken) }
      ops.push(o.create(createData))
    }
  })
  for (const r of o.existing) {
    if (kept.has(r.id) || r.archived) continue
    counts.deactivated++
    ops.push(o.update(r.id, { archived: true }))
    ops.push(...(o.onChange?.('archive', r.id, {}) ?? []))
  }
  if (ops.length) await prisma.$transaction(ops as never)
  return counts
}

export function crewTasksEditor(crewId: string): EditorSpec {
  return {
    dataset: `crewTasks:${crewId}`,
    label: 'Crew tasks',
    help: 'Tasks in the order they show. Stage: todo, now, doing, done or skip (done and skip close the task; todo, now and doing rank first; a blank stage ranks with the rest). Priority: Top, High, Mid or Low. Due is a date (YYYY-MM-DD). Lead id is the member id of whoever leads the task. Removing a row hides the task.',
    columns: [
      { key: 'id', label: 'Id', kind: 'text', readOnly: true, hidden: true },
      { key: 'task', label: 'Task', kind: 'text', maxLength: 300, required: true },
      { key: 'url', label: 'Link', kind: 'text', maxLength: 500, placeholder: 'https://...' },
      { key: 'stage', label: 'Stage', kind: 'text', maxLength: 40 },
      { key: 'priority', label: 'Priority', kind: 'text', maxLength: 40, placeholder: 'High' },
      { key: 'due', label: 'Due', kind: 'text', maxLength: 10, placeholder: 'YYYY-MM-DD' },
      { key: 'lead', label: 'Lead', kind: 'text', maxLength: 120 },
      { key: 'leadId', label: 'Lead id', kind: 'text', maxLength: 20 },
      { key: 'goal', label: 'Goal', kind: 'text', maxLength: 200 },
      { key: 'notes', label: 'Notes', kind: 'text', maxLength: 1000 },
    ],
    maxRows: 500,
    validate: (row) => {
      if (!isHttpUrlOrEmpty(row.url)) return 'link must be a full http(s) address'
      if (text(row.due) && !ISO.test(text(row.due))) return 'due must be YYYY-MM-DD'
      if (text(row.leadId) && !/^\d{1,20}$/.test(text(row.leadId))) return 'lead id must be a member id (a number)'
      return null
    },
    keyOf: idKey,
    async list() {
      const rows = await prisma.crewTask.findMany({ where: { crewId, archived: false }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
      return rows.map((t) => ({
        id: t.id, task: t.label, url: t.url ?? '', stage: t.stage, priority: t.priority ?? '', due: t.due ?? '', lead: t.leadName ?? '',
        leadId: t.leadMemberId ?? '', goal: t.goal ?? '', notes: t.notes ?? '',
      }))
    },
    async save(rows, actor) {
      const existing = (await prisma.crewTask.findMany({ where: { crewId } })) as unknown as Row[]
      const counts = await saveCrewRows({
        rows,
        existing,
        labelOf: (r) => text(r.task),
        fields: (r, position, prev) => {
          // Blank stays blank, as on the sheet (not active, shown empty).
          const stage = text(r.stage)
          const due = orNull(r.due)
          return {
            label: text(r.task), url: orNull(r.url), stage, priority: orNull(r.priority), due,
            // The sheet's own due text only stays while the date is unchanged.
            dueRaw: prev && (prev.due ?? null) === due ? (prev.dueRaw ?? null) : null,
            leadName: orNull(r.lead), leadMemberId: orNull(r.leadId), goal: orNull(r.goal), notes: orNull(r.notes), position,
            doneAt: nextDoneAt(stage, prev as { stage?: string | null; doneAt?: Date | null } | undefined),
          }
        },
        create: (data) => prisma.crewTask.create({ data: { ...data, crewId, createdBy: actor, updatedBy: actor } as never }),
        update: (id, data) => prisma.crewTask.update({ where: { id }, data: { ...data, updatedBy: actor } as never }),
        onChange: (action, id, data) => (id ? [prisma.crewTaskEvent.create({ data: { taskId: id, crewId, action, actor, data: data as never } })] : []),
      })
      await invalidateCrewMappingsCache()
      return counts
    },
  }
}

export function crewAgendaEditor(crewId: string): EditorSpec {
  return {
    dataset: `crewAgenda:${crewId}`,
    label: 'Meeting agenda',
    help: 'The steps of the crew call, in order. Link opens from the step name.',
    columns: [
      { key: 'id', label: 'Id', kind: 'text', readOnly: true, hidden: true },
      { key: 'time', label: 'Time', kind: 'text', maxLength: 40 },
      { key: 'step', label: 'Step', kind: 'text', maxLength: 200, required: true },
      { key: 'stepUrl', label: 'Link', kind: 'text', maxLength: 500, placeholder: 'https://...' },
      { key: 'action', label: 'Action', kind: 'text', maxLength: 500 },
      { key: 'lead', label: 'Lead', kind: 'text', maxLength: 120 },
      { key: 'notes', label: 'Notes', kind: 'text', maxLength: 1000 },
    ],
    maxRows: 100,
    validate: (row) => (isHttpUrlOrEmpty(row.stepUrl) ? null : 'link must be a full http(s) address'),
    keyOf: idKey,
    async list() {
      const rows = await prisma.crewAgendaStep.findMany({ where: { crewId, archived: false }, orderBy: { position: 'asc' } })
      return rows.map((a) => ({ id: a.id, time: a.time ?? '', step: a.step, stepUrl: a.stepUrl ?? '', action: a.action ?? '', lead: a.leadName ?? '', notes: a.notes ?? '' }))
    },
    async save(rows, actor) {
      const existing = (await prisma.crewAgendaStep.findMany({ where: { crewId } })) as unknown as Row[]
      return saveCrewRows({
        rows,
        existing,
        labelOf: (r) => text(r.step),
        fields: (r, position) => ({ time: orNull(r.time), step: text(r.step), stepUrl: orNull(r.stepUrl), action: orNull(r.action), leadName: orNull(r.lead), notes: orNull(r.notes), position }),
        create: (data) => prisma.crewAgendaStep.create({ data: { ...data, crewId, updatedBy: actor } as never }),
        update: (id, data) => prisma.crewAgendaStep.update({ where: { id }, data: { ...data, updatedBy: actor } as never }),
      })
    },
  }
}

export function crewGoalsEditor(crewId: string): EditorSpec {
  return {
    dataset: `crewGoals:${crewId}`,
    label: 'Goals',
    help: 'The crew goals, in order.',
    columns: [
      { key: 'id', label: 'Id', kind: 'text', readOnly: true, hidden: true },
      { key: 'priority', label: 'Priority', kind: 'text', maxLength: 40 },
      { key: 'description', label: 'Goal', kind: 'text', maxLength: 500, required: true },
    ],
    maxRows: 100,
    keyOf: idKey,
    async list() {
      const rows = await prisma.crewGoal.findMany({ where: { crewId, archived: false }, orderBy: { position: 'asc' } })
      return rows.map((g) => ({ id: g.id, priority: g.priority ?? '', description: g.description }))
    },
    async save(rows, actor) {
      const existing = (await prisma.crewGoal.findMany({ where: { crewId } })) as unknown as Row[]
      return saveCrewRows({
        rows,
        existing,
        labelOf: (r) => text(r.description),
        fields: (r, position) => ({ priority: orNull(r.priority), description: text(r.description), position }),
        create: (data) => prisma.crewGoal.create({ data: { ...data, crewId, updatedBy: actor } as never }),
        update: (id, data) => prisma.crewGoal.update({ where: { id }, data: { ...data, updatedBy: actor } as never }),
      })
    },
  }
}

/** The crew page editors, and the switch that has to cover the crew before each one is used. */
export const CREW_EDITORS: Record<string, { make: (crewId: string) => EditorSpec | Promise<EditorSpec>; source: 'crewTasks' | 'crewRoles' }> = {
  tasks: { make: crewTasksEditor, source: 'crewTasks' },
  agenda: { make: crewAgendaEditor, source: 'crewTasks' },
  goals: { make: crewGoalsEditor, source: 'crewTasks' },
  roster: { make: async (crewId) => (await import('./crew-roles')).crewRosterEditor(crewId), source: 'crewRoles' },
}
export type CrewEditorKind = keyof typeof CREW_EDITORS
