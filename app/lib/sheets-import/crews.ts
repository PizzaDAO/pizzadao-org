/**
 * The crew registry (plans/sheets-cutover.md PR 3): importer from the Crew Mappings sheet, parity
 * check of getCrewMappings in both modes, and the admin crew editor.
 */
import { prisma } from '@/app/lib/db'
import { crewRowToOption, fetchCrewMappingsFromSheet, fetchCrewsFromDb, invalidateCrewMappingsCache, type CrewMappingExtras, type CrewOption } from '@/app/lib/crew-mappings'
import { norm } from '@/app/lib/strings'
import { compareKeyed, type Importer, type ParityReport } from './framework'
import { EditorError, isHttpUrlOrEmpty, type EditorRow, type EditorSpec } from './editor'
import { saveByKey } from './configs'

export type CrewRecord = {
  label: string
  emoji: string | null
  turtles: string[]
  role: string | null
  channel: string | null
  event: string | null
  callTime: string | null
  callTimeUrl: string | null
  callLength: string | null
  type: string | null
  script: string | null
  legacySheetUrl: string | null
  sortOrder: number
  archived: boolean
}

/** The same slug the app has always used for crew ids. */
export function crewSlug(label: string): string {
  const s = norm(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return s || label.toLowerCase()
}

export function crewRecords(crews: readonly CrewOption[], extras: ReadonlyMap<string, CrewMappingExtras>): Array<{ key: string; value: CrewRecord }> {
  return crews.map((c, i) => ({
    key: c.id,
    value: {
      label: c.label,
      emoji: c.emoji ?? null,
      turtles: [...c.turtles],
      role: c.role ?? null,
      channel: c.channel ?? null,
      event: c.event ?? null,
      callTime: c.callTime ?? null,
      callTimeUrl: c.callTimeUrl ?? null,
      callLength: c.callLength ?? null,
      type: extras.get(c.id)?.type ?? null,
      script: extras.get(c.id)?.script ?? null,
      legacySheetUrl: c.sheet ?? null,
      sortOrder: i,
      archived: false,
    },
  }))
}

const crewFields = (r: CrewRecord & { id?: string }): CrewRecord => ({
  label: r.label,
  emoji: r.emoji,
  turtles: r.turtles ?? [],
  role: r.role,
  channel: r.channel,
  event: r.event,
  callTime: r.callTime,
  callTimeUrl: r.callTimeUrl,
  callLength: r.callLength,
  type: r.type,
  script: r.script,
  legacySheetUrl: r.legacySheetUrl,
  sortOrder: r.sortOrder,
  archived: r.archived,
})

export const crewsImporter: Importer<CrewRecord> = {
  key: 'crews',
  async load() {
    const { crews, extras } = await fetchCrewMappingsFromSheet(true)
    return { records: crewRecords(crews, extras), issues: [] }
  },
  async existing() {
    const rows = await prisma.crew.findMany()
    return new Map(rows.map((r) => [r.id, crewFields(r)]))
  },
  async apply(plan) {
    await prisma.$transaction(
      [...plan.create, ...plan.update].map((r) =>
        prisma.crew.upsert({
          where: { id: r.key },
          create: { id: r.key, ...r.value, updatedBy: 'sheet-import' },
          update: { ...r.value, updatedBy: 'sheet-import' },
        }),
      ),
    )
    await invalidateCrewMappingsCache()
  },
}

/** What getCrewMappings shows per crew, minus tasks (those are compared by the crew tasks check). */
const shown = (c: CrewOption) => ({
  label: c.label,
  turtles: c.turtles,
  role: c.role,
  channel: c.channel,
  event: c.event,
  emoji: c.emoji,
  sheet: c.sheet,
  callTime: c.callTime,
  callTimeUrl: c.callTimeUrl,
  callLength: c.callLength,
})

export async function crewsParity(): Promise<ParityReport> {
  const [sheet, db] = await Promise.all([fetchCrewMappingsFromSheet(true), fetchCrewsFromDb()])
  const order = (list: CrewOption[]) => list.map((c) => c.id).join(',')
  const report = compareKeyed('crews', new Map(sheet.crews.map((c) => [c.id, shown(c)])), new Map(db.map((c) => [c.id, shown(c)])))
  return { ...report, byScope: { orderDiffers: order(sheet.crews) === order(db) ? 0 : 1 } }
}

const splitTurtles = (v: unknown) =>
  String(v ?? '')
    .split(/[,/|]+/)
    .map((x) => norm(x))
    .filter(Boolean)

const orNull = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())

export const crewsEditor: EditorSpec = {
  dataset: 'crews',
  label: 'Crews',
  help: 'The crew registry. A new crew gets its id (used in links, recordings, tasks and rosters) from its name; renaming a crew later only changes its name, never its id. Removing a row archives the crew. Event is text that matches the crew\'s Discord scheduled events. Sheet is the crew\'s own Google Sheet (still used for tasks and roster until those move).',
  columns: [
    { key: 'id', label: 'Id', kind: 'text', readOnly: true },
    { key: 'label', label: 'Crew', kind: 'text', maxLength: 80, required: true },
    { key: 'emoji', label: 'Emoji', kind: 'text', maxLength: 16 },
    { key: 'turtles', label: 'Turtles', kind: 'text', maxLength: 200, placeholder: 'Leonardo, Raphael' },
    { key: 'role', label: 'Role', kind: 'text', maxLength: 100 },
    { key: 'channel', label: 'Channel', kind: 'text', maxLength: 100 },
    { key: 'event', label: 'Event', kind: 'text', maxLength: 120 },
    { key: 'callTime', label: 'Call time', kind: 'text', maxLength: 120 },
    { key: 'callTimeUrl', label: 'Call link', kind: 'text', maxLength: 500 },
    { key: 'callLength', label: 'Call length', kind: 'text', maxLength: 40 },
    { key: 'type', label: 'Type', kind: 'text', maxLength: 40 },
    { key: 'legacySheetUrl', label: 'Sheet', kind: 'text', maxLength: 500 },
  ],
  maxRows: 100,
  validate: (row) => {
    if (!crewSlug(String(row.label))) return 'crew name needs letters or digits'
    if (!isHttpUrlOrEmpty(row.callTimeUrl)) return 'call link must be a full http(s) address'
    if (!isHttpUrlOrEmpty(row.legacySheetUrl)) return 'sheet must be a full http(s) address'
    return null
  },
  // Existing crews keep their id whatever their name; a new row's id comes from its name.
  keyOf: (row) => (row.id ? `id:${row.id}` : `new:${crewSlug(String(row.label))}`),
  async list() {
    const rows = await prisma.crew.findMany({ where: { archived: false }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      emoji: r.emoji ?? '',
      turtles: (r.turtles ?? []).join(', '),
      role: r.role ?? '',
      channel: r.channel ?? '',
      event: r.event ?? '',
      callTime: r.callTime ?? '',
      callTimeUrl: r.callTimeUrl ?? '',
      callLength: r.callLength ?? '',
      type: r.type ?? '',
      legacySheetUrl: r.legacySheetUrl ?? '',
    }))
  },
  async save(rows, actor) {
    const toData = (row: EditorRow, position: number) => ({
      label: norm(String(row.label)),
      emoji: orNull(row.emoji),
      turtles: splitTurtles(row.turtles),
      role: orNull(row.role),
      channel: orNull(row.channel),
      event: orNull(row.event),
      callTime: orNull(row.callTime),
      callTimeUrl: orNull(row.callTimeUrl),
      callLength: orNull(row.callLength),
      type: orNull(row.type),
      legacySheetUrl: orNull(row.legacySheetUrl),
      sortOrder: position,
      archived: false,
    })
    const existingIds = new Set((await prisma.crew.findMany({ select: { id: true } })).map((c) => c.id))
    // The crew id a row writes to: its own id when it has one, else the slug of its name.
    const targetId = (r: EditorRow) => (r.id && existingIds.has(String(r.id)) ? String(r.id) : crewSlug(String(r.label)))
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      const id = targetId(r)
      if (seen.has(id)) throw new EditorError(`Row ${i + 1}: a crew with the id "${id}" is already in the list`)
      seen.add(id)
    })
    const counts = await saveByKey({
      rows,
      keyOf: targetId,
      existing: async () => (await prisma.crew.findMany()).map((r) => ({ key: r.id, active: !r.archived, value: crewFields(r) as unknown as Record<string, unknown> })),
      same: (prev, row, position) => {
        const next = toData(row, position)
        const p = prev.value as unknown as CrewRecord
        return prev.active && (Object.keys(next) as Array<keyof typeof next>).every((k) => JSON.stringify(p[k as keyof CrewRecord] ?? null) === JSON.stringify(next[k] ?? null))
      },
      upsert: (row, position) => {
        const id = targetId(row)
        const data = { ...toData(row, position), updatedBy: actor }
        return prisma.crew.upsert({ where: { id }, create: { id, ...data }, update: data })
      },
      deactivate: (key) => prisma.crew.update({ where: { id: key }, data: { archived: true, updatedBy: actor } }),
    })
    await invalidateCrewMappingsCache()
    return counts
  },
}

export { crewRowToOption }
