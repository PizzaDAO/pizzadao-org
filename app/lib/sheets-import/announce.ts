/**
 * Community Call announcement (plans/sheets-cutover.md PR 8): importer from the announcement sheet's
 * block, parity check of the block the runner reads, and the specials editor for announcers.
 */
import { prisma } from '@/app/lib/db'
import { SHEET_IDS } from '@/app/lib/sheets/config'
import { createAnnounceSheetIO, type AnnounceBlock } from '@/app/lib/announce/sheet'
import { createAnnounceDbIO } from '@/app/lib/announce/db'
import { compareKeyed, type Importer, type ParityReport } from './framework'
import { labelKeys, normalizeLabel } from './plan'
import { isHttpUrlOrEmpty, type EditorRow, type EditorSpec, type SaveCounts } from './editor'

const STATE_KEY = '__state__'

export type AnnounceRecord =
  | { kind: 'state'; sendValue: string; lastSentValue: string }
  | { kind: 'special'; text: string; url: string | null; crew: string; status: string; position: number; archived: boolean }

/** Records for the block. Pure. */
export function announceRecords(block: AnnounceBlock): Array<{ key: string; value: AnnounceRecord }> {
  const keys = labelKeys('', block.specials.map((s) => s.text)).map((k) => k.slice(1))
  return [
    { key: STATE_KEY, value: { kind: 'state', sendValue: block.sendValue, lastSentValue: block.lastSentValue } },
    ...block.specials.map((s, i) => ({
      key: keys[i],
      value: { kind: 'special' as const, text: s.text, url: s.url, crew: s.crew, status: s.status, position: i, archived: false },
    })),
  ]
}

export const announceImporter: Importer<AnnounceRecord> = {
  key: 'announce',
  async load() {
    const block = await createAnnounceSheetIO(SHEET_IDS.announce).readBlock()
    return { records: announceRecords(block), issues: [], extra: { specials: block.specials.length } }
  },
  async existing() {
    const [state, rows] = await Promise.all([prisma.announceState.findUnique({ where: { id: 1 } }), prisma.announcement.findMany()])
    const map = new Map<string, AnnounceRecord>()
    if (state) map.set(STATE_KEY, { kind: 'state', sendValue: state.sendValue, lastSentValue: state.lastSentValue })
    for (const r of rows) map.set(r.naturalKey, { kind: 'special', text: r.text, url: r.url, crew: r.crew, status: r.status, position: r.position, archived: r.archived })
    return map
  },
  // Specials removed from the sheet are archived on apply (hidden from the announcement, kept in
  // the table), so the database matches the sheet before the switch.
  actsOnOrphans: true,
  async apply(plan) {
    const orphanSpecials = plan.orphans.filter((k) => k !== STATE_KEY)
    const ops: unknown[] = [...plan.create, ...plan.update].map(({ key, value }) => {
      if (value.kind === 'state') {
        const data = { sendValue: value.sendValue, lastSentValue: value.lastSentValue, updatedBy: 'sheet-import' }
        return prisma.announceState.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data })
      }
      const { kind: _k, ...data } = value
      return prisma.announcement.upsert({ where: { naturalKey: key }, create: { naturalKey: key, ...data, updatedBy: 'sheet-import' }, update: { ...data, updatedBy: 'sheet-import' } })
    })
    if (orphanSpecials.length) {
      ops.push(prisma.announcement.updateMany({ where: { naturalKey: { in: orphanSpecials }, archived: false }, data: { archived: true, updatedBy: 'sheet-import' } }))
    }
    if (ops.length) await prisma.$transaction(ops as never)
  },
}

export async function announceParity(): Promise<ParityReport> {
  const [sheet, db] = await Promise.all([createAnnounceSheetIO(SHEET_IDS.announce).readBlock(), createAnnounceDbIO().readBlock()])
  const keyed = (b: AnnounceBlock) => {
    const m = new Map<string, unknown>([[STATE_KEY, { sendValue: b.sendValue, lastSentValue: b.lastSentValue }]])
    b.specials.forEach((s, i) => m.set(`special:${i}`, s))
    return m
  }
  return compareKeyed('announce', keyed(sheet), keyed(db))
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

export const announceEditor: EditorSpec = {
  dataset: 'announce',
  label: 'Community Call announcement',
  help: 'The specials listed in the Community Call announcement, in order. Status works like the sheet did (for example To Do / Done). Removing a row hides it.',
  columns: [
    { key: 'id', label: 'Id', kind: 'text', readOnly: true, hidden: true },
    { key: 'text', label: 'Announcement', kind: 'text', maxLength: 500, required: true },
    { key: 'url', label: 'Link', kind: 'text', maxLength: 500, placeholder: 'https://...' },
    { key: 'status', label: 'Status', kind: 'text', maxLength: 40 },
    { key: 'crew', label: 'Crew', kind: 'text', maxLength: 80 },
  ],
  maxRows: 100,
  validate: (row) => (isHttpUrlOrEmpty(row.url) ? null : 'link must be a full http(s) address'),
  keyOf: (row: EditorRow, index: number) => (row.id ? `id:${row.id}` : `new:${index}`),
  async list() {
    const rows = await prisma.announcement.findMany({ where: { archived: false }, orderBy: { position: 'asc' } })
    return rows.map((r) => ({ id: r.id, text: r.text, url: r.url ?? '', status: r.status, crew: r.crew }))
  },
  async save(rows, actor): Promise<SaveCounts> {
    const existing = await prisma.announcement.findMany()
    const byId = new Map(existing.map((r) => [r.id, r]))
    const taken = new Set(existing.map((r) => r.naturalKey))
    const counts: SaveCounts = { created: 0, updated: 0, deactivated: 0, unchanged: 0 }
    const ops: unknown[] = []
    const kept = new Set<string>()
    rows.forEach((row, position) => {
      const data = { text: text(row.text), url: text(row.url) || null, status: text(row.status), crew: text(row.crew), position, archived: false, updatedBy: actor }
      const prev = row.id ? byId.get(String(row.id)) : undefined
      if (prev) {
        kept.add(prev.id)
        if (!prev.archived && prev.text === data.text && prev.url === data.url && prev.status === data.status && prev.crew === data.crew && prev.position === position) {
          counts.unchanged++
          return
        }
        counts.updated++
        ops.push(prisma.announcement.update({ where: { id: prev.id }, data }))
      } else {
        counts.created++
        let key = normalizeLabel(data.text) || 'item'
        for (let n = 2; taken.has(key); n++) key = `${normalizeLabel(data.text) || 'item'}#${n}`
        taken.add(key)
        ops.push(prisma.announcement.create({ data: { naturalKey: key, ...data } }))
      }
    })
    for (const r of existing) {
      if (kept.has(r.id) || r.archived) continue
      counts.deactivated++
      ops.push(prisma.announcement.update({ where: { id: r.id }, data: { archived: true, updatedBy: actor } }))
    }
    if (ops.length) await prisma.$transaction(ops as never)
    return counts
  },
}
