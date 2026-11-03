/**
 * Crew rosters / roles (plans/sheets-cutover.md PR 5): importer from every crew sheet's roster
 * section, parity check (including the lead set crew-leads.ts grants rights from), and the roster
 * editor for crew leads.
 *
 * Permissions stay exactly as they were: a lead/capo status grants rights only on a row with a
 * member id. Names are never matched to member ids here; rows without an id are reported.
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { extractSheetId, parseCrewSheetRows, type RosterRow } from '@/app/lib/crew-sheet'
import { isLeadStatus } from '@/app/lib/crew-lead-status'
import { loadCrewRosterFromDb } from '@/app/lib/crew-roles'
import { getSheetData } from '@/app/lib/sheets/member-repository'
import { compareKeyed, type Importer, type ParityReport, type ParseIssue } from './framework'
import { normalizeLabel } from './plan'
import { readCrewSheetRows, saveCrewRows, type Row } from './crew-content'
import type { EditorRow, EditorSpec } from './editor'

export type RoleRecord = {
  crewId: string
  naturalKey: string
  memberId: string | null
  name: string
  status: string
  city: string
  org: string
  skills: string
  turtles: string
  telegram: string
  attendance: string
  notes: string
  position: number
  archived: boolean
}

export function roleKey(memberId: string | null | undefined, name: string): string {
  return memberId ? `id:${memberId.trim()}` : `name:${normalizeLabel(name)}`
}

/**
 * Roster records for one crew, one per sheet row, in order. A member id (or name) that repeats gets
 * `#2`, `#3`... so every row the crew page shows is kept; repeated member ids are also reported.
 * Pure.
 */
export function rosterRecords(crewId: string, roster: readonly RosterRow[]): { records: RoleRecord[]; duplicates: number[] } {
  const records: RoleRecord[] = []
  const seen = new Map<string, number>()
  const duplicates: number[] = []
  roster.forEach((m, i) => {
    const base = roleKey(m.id, m.name)
    const n = seen.get(base) ?? 0
    if (n > 0 && m.id) duplicates.push(i + 1)
    const key = n > 0 ? `${base}#${n + 1}` : base
    seen.set(base, n + 1)
    records.push({
      crewId,
      naturalKey: key,
      memberId: m.id ? m.id.trim() : null,
      name: m.name,
      status: m.status,
      city: m.city,
      org: m.org,
      skills: m.skills,
      turtles: m.turtles,
      telegram: m.telegram,
      attendance: m.attendance,
      notes: m.notes,
      position: records.length,
      archived: false,
    })
  })
  return { records, duplicates }
}

const recordKey = (r: { crewId: string; naturalKey: string }) => `${r.crewId}|${r.naturalKey}`

export const crewRolesImporter: Importer<RoleRecord> = {
  key: 'crewRoles',
  async load() {
    const { crews } = await getCrewMappings(true)
    const issues: ParseIssue[] = []
    const records: Array<{ key: string; value: RoleRecord }> = []
    const extra: Record<string, number> = { crews: 0, rows: 0, leadRows: 0, rowsWithoutId: 0, leadRowsWithoutId: 0, idsNotMembers: 0, unreadableSheets: 0 }
    let memberIds: Map<string, number> | null = null
    try {
      memberIds = (await getSheetData()).memberToIdx
    } catch {
      memberIds = null
    }
    for (const crew of crews) {
      const sheetId = crew.sheet ? extractSheetId(crew.sheet) : null
      if (!sheetId) continue
      extra.crews++
      try {
        const { rows, taskLinks, agendaLinks } = await readCrewSheetRows(sheetId)
        const { roster } = parseCrewSheetRows(rows as never[], taskLinks, agendaLinks)
        const { records: recs, duplicates } = rosterRecords(crew.id, roster)
        for (const row of duplicates) issues.push({ row, code: 'duplicate-member-id', scope: crew.id })
        for (const r of recs) {
          extra.rows++
          const lead = isLeadStatus(r.status)
          if (lead) extra.leadRows++
          if (!r.memberId) {
            extra.rowsWithoutId++
            if (lead) {
              // A lead without a member id grants nothing (same as the sheet path): fix before flipping.
              extra.leadRowsWithoutId++
              issues.push({ row: r.position + 1, code: 'lead-without-member-id', scope: crew.id })
            }
          } else if (memberIds && !memberIds.has(r.memberId)) {
            extra.idsNotMembers++
            issues.push({ row: r.position + 1, code: 'id-not-a-member', scope: crew.id })
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
    const rows = await prisma.crewRole.findMany()
    return new Map(
      rows.map((r) => {
        const v: RoleRecord = {
          crewId: r.crewId, naturalKey: r.naturalKey, memberId: r.memberId, name: r.name, status: r.status, city: r.city, org: r.org,
          skills: r.skills, turtles: r.turtles, telegram: r.telegram, attendance: r.attendance, notes: r.notes, position: r.position, archived: r.archived,
        }
        return [recordKey(v), v]
      }),
    )
  },
  async apply(plan, progress) {
    const ops = [...plan.create, ...plan.update].map(({ value }) =>
      prisma.crewRole.upsert({
        where: { crewId_naturalKey: { crewId: value.crewId, naturalKey: value.naturalKey } },
        create: { ...value, updatedBy: 'sheet-import' },
        update: { ...value, updatedBy: 'sheet-import' },
      }),
    )
    // Chunked; progress is logged so a failure part-way shows how far it got.
    for (let i = 0; i < ops.length; i += 100) {
      await prisma.$transaction(ops.slice(i, i + 100))
      progress(Math.min(i + 100, ops.length))
    }
  },
}

/** Per crew: every roster row as the page shows it, and the lead set, sheet vs database. */
export async function crewRolesParity(): Promise<ParityReport> {
  const { crews } = await getCrewMappings(true)
  const sheet = new Map<string, unknown>()
  const db = new Map<string, unknown>()
  const byScope: Record<string, number> = {}
  for (const crew of crews) {
    const sheetId = crew.sheet ? extractSheetId(crew.sheet) : null
    if (!sheetId) continue
    const [rows, dbRoster] = await Promise.all([readCrewSheetRows(sheetId).catch(() => null), loadCrewRosterFromDb(crew.id)])
    const sheetRoster = rows ? parseCrewSheetRows(rows.rows as never[], rows.taskLinks, rows.agendaLinks).roster : []
    const local = { sheet: new Map<string, unknown>(), db: new Map<string, unknown>() }
    const leads = (list: RosterRow[]) => list.filter((m) => !!m.id && isLeadStatus(m.status)).map((m) => m.id).sort().join(',')
    sheetRoster.forEach((m, i) => local.sheet.set(`${crew.id}:${i}`, m))
    dbRoster.forEach((m, i) => local.db.set(`${crew.id}:${i}`, m))
    local.sheet.set(`${crew.id}:leads`, leads(sheetRoster))
    local.db.set(`${crew.id}:leads`, leads(dbRoster))
    const r = compareKeyed(crew.id, local.sheet, local.db)
    byScope[crew.id] = r.mismatches + r.onlyInDb + r.onlyInSheet
    for (const [k, v] of local.sheet) sheet.set(k, v)
    for (const [k, v] of local.db) db.set(k, v)
  }
  return { ...compareKeyed('crewRoles', sheet, db), byScope }
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

export function crewRosterEditor(crewId: string): EditorSpec {
  return {
    dataset: `crewRoster:${crewId}`,
    label: 'Crew roster',
    help: 'Who is in the crew. Status "Lead", "Crew Lead" or "Capo" makes that member a crew lead (they can edit this page and manage bounties), but only with a member id. Removing a row takes the member off the roster.',
    columns: [
      { key: 'id', label: 'Id', kind: 'text', readOnly: true, hidden: true },
      { key: 'memberId', label: 'Member id', kind: 'text', maxLength: 20 },
      { key: 'name', label: 'Name', kind: 'text', maxLength: 120, required: true },
      { key: 'status', label: 'Status', kind: 'text', maxLength: 40 },
      { key: 'city', label: 'City', kind: 'text', maxLength: 120 },
      { key: 'org', label: 'Org', kind: 'text', maxLength: 200 },
      { key: 'skills', label: 'Skills', kind: 'text', maxLength: 300 },
      { key: 'turtles', label: 'Turtles', kind: 'text', maxLength: 200 },
      { key: 'telegram', label: 'Telegram', kind: 'text', maxLength: 80 },
      { key: 'attendance', label: 'Attendance', kind: 'text', maxLength: 40 },
      { key: 'notes', label: 'Notes', kind: 'text', maxLength: 1000 },
    ],
    maxRows: 500,
    validate: (row) => (text(row.memberId) && !/^\d{1,20}$/.test(text(row.memberId)) ? 'member id must be a number' : null),
    keyOf: (row: EditorRow, index: number) => (row.id ? `id:${row.id}` : text(row.memberId) ? `member:${text(row.memberId)}` : `new:${index}`),
    async list() {
      const rows = await prisma.crewRole.findMany({ where: { crewId, archived: false }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
      return rows.map((r) => ({
        id: r.id, memberId: r.memberId ?? '', name: r.name, status: r.status, city: r.city, org: r.org, skills: r.skills,
        turtles: r.turtles, telegram: r.telegram, attendance: r.attendance, notes: r.notes,
      }))
    },
    async save(rows, actor) {
      const existing = (await prisma.crewRole.findMany({ where: { crewId } })) as unknown as Row[]
      return saveCrewRows({
        rows,
        existing,
        labelOf: (r) => roleKey(text(r.memberId) || null, text(r.name)),
        fields: (r, position) => ({
          memberId: text(r.memberId) || null,
          name: text(r.name),
          status: text(r.status),
          city: text(r.city),
          org: text(r.org),
          skills: text(r.skills),
          turtles: text(r.turtles),
          telegram: text(r.telegram),
          attendance: text(r.attendance),
          notes: text(r.notes),
          position,
        }),
        create: (data) => prisma.crewRole.create({ data: { ...data, crewId, updatedBy: actor } as never }),
        update: (id, data) => prisma.crewRole.update({ where: { id }, data: { ...data, updatedBy: actor } as never }),
      })
    },
  }
}
