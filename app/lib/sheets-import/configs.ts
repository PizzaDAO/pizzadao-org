/**
 * Small config data sets (plans/sheets-cutover.md PR 1): POAP whitelist, NFT collections and the
 * manuals index. Importer, parity check and admin editor for each.
 */
import { prisma } from '@/app/lib/db'
import { SHEET_IDS } from '@/app/lib/sheets/config'
import { fetchGviz } from '@/app/lib/sheets/gviz'
import { getManualLinks } from '@/app/api/lib/google-sheets'
import { fetchAllowedPOAPIdsFromDb, fetchAllowedPOAPIdsFromSheet } from '@/app/lib/poap'
import { getNFTContractsFromDb, getNFTContractsFromSheet, isContractAddress } from '@/app/lib/nft-config'
import { isInternalPath, parseReviewedDate } from '@/app/lib/manuals-freshness'
import { listManualsFromDb, parseManualsTable, type Manual } from '@/app/lib/manuals'
import type { NFTContract } from '@/app/lib/nft-types'
import { compareKeyed, type Importer, type ParityReport, type ParseIssue } from './framework'
import { labelKeys, normalizeLabel } from './plan'
import { isHttpUrlOrEmpty, type EditorRow, type EditorSpec, type SaveCounts } from './editor'

// ---------------------------------------------------------------------------
// POAP whitelist
// ---------------------------------------------------------------------------

type PoapRecord = { position: number; active: boolean }

export function poapRecords(ids: readonly string[]): Array<{ key: string; value: PoapRecord }> {
  return ids.map((id, position) => ({ key: id, value: { position, active: true } }))
}

export const poapImporter: Importer<PoapRecord> = {
  key: 'poapWhitelist',
  async load() {
    const parsed = await fetchAllowedPOAPIdsFromSheet({ fresh: true })
    if (!parsed.found) throw new Error('POAP id column not found in the whitelist sheet')
    return { records: poapRecords(parsed.ids), issues: parsed.badRows.map((row) => ({ row, code: 'not-an-event-id' })) }
  },
  async existing() {
    const rows = await prisma.poapWhitelistEntry.findMany()
    return new Map(rows.map((r) => [r.eventId, { position: r.position, active: r.active }]))
  },
  async apply(plan) {
    await prisma.$transaction(
      [...plan.create, ...plan.update].map((r) =>
        prisma.poapWhitelistEntry.upsert({
          where: { eventId: r.key },
          create: { eventId: r.key, ...r.value, updatedBy: 'sheet-import' },
          update: { ...r.value, updatedBy: 'sheet-import' },
        }),
      ),
    )
  },
}

export async function poapParity(): Promise<ParityReport> {
  const [sheet, db] = await Promise.all([fetchAllowedPOAPIdsFromSheet({ fresh: true }), fetchAllowedPOAPIdsFromDb()])
  const toMap = (ids: string[]) => new Map(ids.map((id) => [id, true]))
  return compareKeyed('poapWhitelist', toMap(sheet.ids), toMap(db))
}

export const poapEditor: EditorSpec = {
  dataset: 'poapWhitelist',
  label: 'POAP event whitelist',
  help: 'One POAP event id per row. Only POAPs from these events show on profiles. Removing a row hides it (it can be added back).',
  columns: [{ key: 'eventId', label: 'Event id', kind: 'text', maxLength: 12, required: true, placeholder: '123456' }],
  maxRows: 5000,
  validate: (row) => (/^\d{1,12}$/.test(String(row.eventId)) && row.eventId !== '0' ? null : 'event id must be a number'),
  keyOf: (row) => String(row.eventId),
  async list() {
    const rows = await prisma.poapWhitelistEntry.findMany({ where: { active: true }, orderBy: { position: 'asc' } })
    return rows.map((r) => ({ eventId: r.eventId }))
  },
  async save(rows, actor) {
    return saveByKey({
      rows,
      keyOf: (r) => String(r.eventId),
      existing: async () => (await prisma.poapWhitelistEntry.findMany()).map((r) => ({ key: r.eventId, active: r.active, value: { position: r.position } })),
      same: (prev, row, position) => prev.active && prev.value.position === position && !!row,
      upsert: (row, position) =>
        prisma.poapWhitelistEntry.upsert({
          where: { eventId: String(row.eventId) },
          create: { eventId: String(row.eventId), position, active: true, updatedBy: actor },
          update: { position, active: true, updatedBy: actor },
        }),
      deactivate: (key) => prisma.poapWhitelistEntry.update({ where: { eventId: key }, data: { active: false, updatedBy: actor } }),
    })
  },
}

// ---------------------------------------------------------------------------
// NFT collections
// ---------------------------------------------------------------------------

type NftRecord = { chain: string; address: string; name: string; sortOrder: number | null; description: string | null; position: number; active: boolean }

export const nftKey = (chain: string, address: string) => `${chain.trim().toLowerCase()}:${address.trim().toLowerCase()}`

export function nftRecords(contracts: readonly NFTContract[]): { records: Array<{ key: string; value: NftRecord }>; duplicates: number[] } {
  const records: Array<{ key: string; value: NftRecord }> = []
  const seen = new Set<string>()
  const duplicates: number[] = []
  contracts.forEach((c, i) => {
    const key = nftKey(c.chain, c.address)
    if (seen.has(key)) {
      duplicates.push(i)
      return
    }
    seen.add(key)
    records.push({
      key,
      value: { chain: c.chain, address: c.address, name: c.name, sortOrder: c.order ?? null, description: c.description ?? null, position: records.length, active: true },
    })
  })
  return { records, duplicates }
}

export const nftImporter: Importer<NftRecord> = {
  key: 'nftCollections',
  async load() {
    const parsed = await getNFTContractsFromSheet()
    if (!parsed.found) throw new Error('Chain / contract columns not found in the NFT sheet')
    const { records, duplicates } = nftRecords(parsed.contracts)
    const issues: ParseIssue[] = [
      ...parsed.badRows.map((row) => ({ row, code: 'invalid-chain-or-address' })),
      ...duplicates.map(() => ({ row: 0, code: 'duplicate-contract' })),
    ]
    return { records, issues }
  },
  async existing() {
    const rows = await prisma.nftCollection.findMany()
    return new Map(
      rows.map((r) => [
        nftKey(r.chain, r.addressKey),
        { chain: r.chain, address: r.address, name: r.name, sortOrder: r.sortOrder, description: r.description, position: r.position, active: r.active },
      ]),
    )
  },
  async apply(plan) {
    await prisma.$transaction(
      [...plan.create, ...plan.update].map((r) => {
        const addressKey = r.value.address.toLowerCase()
        return prisma.nftCollection.upsert({
          where: { chain_addressKey: { chain: r.value.chain, addressKey } },
          create: { ...r.value, addressKey, updatedBy: 'sheet-import' },
          update: { ...r.value, updatedBy: 'sheet-import' },
        })
      }),
    )
  },
}

export async function nftParity(): Promise<ParityReport> {
  const [sheet, db] = await Promise.all([getNFTContractsFromSheet(), getNFTContractsFromDb()])
  const toMap = (list: NFTContract[]) => new Map(list.map((c) => [nftKey(c.chain, c.address), c]))
  return compareKeyed('nftCollections', toMap(sheet.contracts), toMap(db))
}

export const nftEditor: EditorSpec = {
  dataset: 'nftCollections',
  label: 'NFT collections',
  help: 'Collections shown on profiles and the NFT leaderboard. Chain is one of ethereum, base, polygon, zora, optimism. Removing a row hides it.',
  columns: [
    { key: 'chain', label: 'Chain', kind: 'text', maxLength: 20, required: true, placeholder: 'ethereum' },
    { key: 'address', label: 'Contract', kind: 'text', maxLength: 42, required: true, placeholder: '0x...' },
    { key: 'name', label: 'Name', kind: 'text', maxLength: 120 },
    { key: 'sortOrder', label: 'Order', kind: 'int' },
    { key: 'description', label: 'Details', kind: 'text', maxLength: 500 },
  ],
  maxRows: 200,
  validate: (row) => {
    row.chain = String(row.chain).toLowerCase()
    if (!/^[a-z]{2,20}$/.test(String(row.chain))) return 'chain must be a word like ethereum'
    return isContractAddress(String(row.address)) ? null : 'contract must be 0x followed by 40 characters'
  },
  keyOf: (row) => nftKey(String(row.chain), String(row.address)),
  async list() {
    const rows = await prisma.nftCollection.findMany({ where: { active: true }, orderBy: { position: 'asc' } })
    return rows.map((r) => ({ chain: r.chain, address: r.address, name: r.name, sortOrder: r.sortOrder, description: r.description ?? '' }))
  },
  async save(rows, actor) {
    return saveByKey({
      rows,
      keyOf: (r) => nftKey(String(r.chain), String(r.address)),
      existing: async () =>
        (await prisma.nftCollection.findMany()).map((r) => ({
          key: nftKey(r.chain, r.addressKey),
          active: r.active,
          value: { id: r.id, address: r.address, name: r.name, sortOrder: r.sortOrder, description: r.description ?? '', position: r.position },
        })),
      same: (prev, row, position) =>
        prev.active &&
        prev.value.position === position &&
        prev.value.address === row.address &&
        prev.value.name === (row.name || 'Unknown Collection') &&
        prev.value.sortOrder === row.sortOrder &&
        prev.value.description === row.description,
      upsert: (row, position) => {
        const data = {
          chain: String(row.chain),
          address: String(row.address),
          addressKey: String(row.address).toLowerCase(),
          name: String(row.name || 'Unknown Collection'),
          sortOrder: (row.sortOrder as number | null) ?? null,
          description: row.description ? String(row.description) : null,
          position,
          active: true,
          updatedBy: actor,
        }
        return prisma.nftCollection.upsert({ where: { chain_addressKey: { chain: data.chain, addressKey: data.addressKey } }, create: data, update: data })
      },
      deactivate: (_key, prev) => prisma.nftCollection.update({ where: { id: String(prev.id) }, data: { active: false, updatedBy: actor } }),
    })
  },
}

// ---------------------------------------------------------------------------
// Manuals index
// ---------------------------------------------------------------------------

type ManualRecord = Omit<Manual, 'crewId'> & { position: number; active: boolean }

/**
 * One record per manual, in sheet order. The key is the normalized title; a repeated title gets
 * `#2`, `#3`... so every row is kept (the manuals pages address a manual by its position, so a
 * dropped row would move every later one). Repeats are counted; a title with no letters or digits
 * is skipped and counted.
 */
export function manualRecords(manuals: readonly Manual[]): { records: Array<{ key: string; value: ManualRecord }>; duplicates: number } {
  const records: Array<{ key: string; value: ManualRecord }> = []
  const seen = new Map<string, number>()
  let duplicates = 0
  for (const m of manuals) {
    const base = normalizeLabel(m.title)
    if (!base) {
      duplicates++
      continue
    }
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    if (n > 0) duplicates++
    const key = n > 0 ? `${base}#${n + 1}` : base
    const value: ManualRecord = {
      title: m.title,
      url: m.url,
      crew: m.crew,
      status: m.status,
      authorId: m.authorId,
      author: m.author,
      lastUpdated: m.lastUpdated,
      notes: m.notes,
      position: records.length,
      active: true,
    }
    records.push({ key, value })
  }
  return { records, duplicates }
}

async function manualsFromSheet(): Promise<Manual[]> {
  const [gviz, linkMap] = await Promise.all([fetchGviz(SHEET_IDS.manuals, { headers: 1 }, { fresh: true }), getManualLinks(SHEET_IDS.manuals)])
  if (!gviz?.table) throw new Error('No table data in the manuals sheet')
  return parseManualsTable(gviz.table, linkMap)
}

export const manualsImporter: Importer<ManualRecord> = {
  key: 'manuals',
  async load() {
    const { records, duplicates } = manualRecords(await manualsFromSheet())
    return { records, issues: Array.from({ length: duplicates }, () => ({ row: 0, code: 'duplicate-title' })) }
  },
  async existing() {
    const rows = await prisma.manual.findMany()
    return new Map(
      rows.map((r) => [
        r.titleKey,
        { title: r.title, url: r.url, crew: r.crew, status: r.status, authorId: r.authorId, author: r.author, lastUpdated: r.lastUpdated, notes: r.notes, position: r.position, active: r.active },
      ]),
    )
  },
  async apply(plan) {
    await prisma.$transaction(
      [...plan.create, ...plan.update].map((r) =>
        prisma.manual.upsert({
          where: { titleKey: r.key },
          create: { titleKey: r.key, ...r.value, updatedBy: 'sheet-import' },
          update: { ...r.value, updatedBy: 'sheet-import' },
        }),
      ),
    )
  },
}

export async function manualsParity(): Promise<ParityReport> {
  const [sheet, db] = await Promise.all([manualsFromSheet(), listManualsFromDb()])
  // Keyed like the importer (repeated titles get #2...), with the position the pages address them by.
  const toMap = (list: Manual[]) => {
    const keys = labelKeys('', list.map((m) => m.title))
    return new Map(list.map((m, i) => [keys[i], { ...m, index: i }]))
  }
  return compareKeyed('manuals', toMap(sheet), toMap(db))
}

/**
 * The stored key for each edited manuals row: a row keeps the key it was listed with while its
 * title still matches it; a new or renamed row gets the normalized title, or `#2`, `#3`... when an
 * earlier row already has that key (two manuals may share a title). Pure.
 */
export function manualRowKeys(rows: readonly EditorRow[]): string[] {
  const base = (r: EditorRow) => normalizeLabel(String(r.title ?? ''))
  const kept = rows.map((r) => {
    const k = typeof r.key === 'string' ? r.key : ''
    return k && k.replace(/#\d+$/, '') === base(r) ? k : null
  })
  const taken = new Set(kept.filter((k): k is string => !!k))
  return rows.map((r, i) => {
    const prev = kept[i]
    if (prev) return prev
    const b = base(r)
    let k = b
    for (let n = 2; taken.has(k); n++) k = `${b}#${n}`
    taken.add(k)
    return k
  })
}

/** Row checks for the manuals editor: link, reviewed date (YYYY-MM-DD) and an in-app replacement path. */
export function manualRowProblem(row: EditorRow): string | null {
  if (!isHttpUrlOrEmpty(row.url)) return 'link must be a full http(s) address'
  const reviewed = String(row.reviewedAt ?? '')
  if (reviewed && !parseReviewedDate(reviewed)) return 'last reviewed must be a date like 2026-11-14'
  const by = String(row.supersededBy ?? '')
  if (by && !isInternalPath(by)) return 'replaced by must be a page on this site, like /handbook/host-a-party'
  return null
}

export const manualsEditor: EditorSpec = {
  dataset: 'manuals',
  label: 'Manuals index',
  help: 'The manuals list. Link is the Google Sheet or document that holds the manual itself. Rows show in this order; removing a row hides it.',
  columns: [
    { key: 'key', label: 'Key', kind: 'text', readOnly: true, hidden: true },
    { key: 'title', label: 'Manual', kind: 'text', maxLength: 200, required: true },
    { key: 'url', label: 'Link', kind: 'text', maxLength: 500, placeholder: 'https://...' },
    { key: 'crew', label: 'Crew', kind: 'text', maxLength: 80 },
    { key: 'status', label: 'Status', kind: 'text', maxLength: 40 },
    { key: 'authorId', label: 'Author id', kind: 'text', maxLength: 20 },
    { key: 'author', label: 'Author', kind: 'text', maxLength: 120 },
    { key: 'lastUpdated', label: 'Last updated', kind: 'text', maxLength: 40 },
    { key: 'notes', label: 'Notes', kind: 'text', maxLength: 1000 },
    { key: 'reviewedAt', label: 'Last reviewed', kind: 'text', maxLength: 10, placeholder: 'YYYY-MM-DD' },
    { key: 'supersededBy', label: 'Replaced by (page)', kind: 'text', maxLength: 200, placeholder: '/handbook/...' },
  ],
  maxRows: 500,
  validate: manualRowProblem,
  // Listed rows carry their stored key; new rows get one on save (see manualRowKeys).
  keyOf: (row, index) => (typeof row.key === 'string' && row.key ? `key:${row.key}` : `new:${index}`),
  async list() {
    const rows = await prisma.manual.findMany({ where: { active: true }, orderBy: { position: 'asc' } })
    return rows.map((r) => ({ key: r.titleKey, title: r.title, url: r.url ?? '', crew: r.crew, status: r.status, authorId: r.authorId, author: r.author, lastUpdated: r.lastUpdated, notes: r.notes, reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString().slice(0, 10) : '', supersededBy: r.supersededBy ?? '' }))
  },
  async save(rows, actor) {
    const fields = ['title', 'url', 'crew', 'status', 'authorId', 'author', 'lastUpdated', 'notes', 'reviewedAt', 'supersededBy'] as const
    const keyList = manualRowKeys(rows)
    const keys = new Map(rows.map((r, i) => [r, keyList[i]]))
    return saveByKey({
      rows,
      keyOf: (r) => keys.get(r)!,
      existing: async () =>
        (await prisma.manual.findMany()).map((r) => ({ key: r.titleKey, active: r.active, value: { ...r, url: r.url ?? '', reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString().slice(0, 10) : '', supersededBy: r.supersededBy ?? '' } as Record<string, unknown> })),
      same: (prev, row, position) => prev.active && prev.value.position === position && fields.every((f) => prev.value[f] === row[f]),
      upsert: (row, position) => {
        const data = {
          title: String(row.title),
          url: row.url ? String(row.url) : null,
          crew: String(row.crew ?? ''),
          status: String(row.status ?? ''),
          authorId: String(row.authorId ?? ''),
          author: String(row.author ?? ''),
          lastUpdated: String(row.lastUpdated ?? ''),
          notes: String(row.notes ?? ''),
          reviewedAt: row.reviewedAt ? parseReviewedDate(String(row.reviewedAt)) : null,
          supersededBy: row.supersededBy ? String(row.supersededBy) : null,
          position,
          active: true,
          updatedBy: actor,
        }
        const titleKey = keys.get(row)!
        return prisma.manual.upsert({ where: { titleKey }, create: { titleKey, ...data }, update: data })
      },
      deactivate: (key) => prisma.manual.update({ where: { titleKey: key }, data: { active: false, updatedBy: actor } }),
    })
  },
}

// ---------------------------------------------------------------------------
// Shared save: upsert by key, mark missing rows inactive, in one transaction.
// ---------------------------------------------------------------------------

type Existing<V> = { key: string; active: boolean; value: V }

export async function saveByKey<V extends Record<string, unknown>>(o: {
  rows: EditorRow[]
  keyOf: (row: EditorRow) => string
  existing: () => Promise<Array<Existing<V>>>
  same: (prev: Existing<V>, row: EditorRow, position: number) => boolean
  upsert: (row: EditorRow, position: number) => unknown
  deactivate: (key: string, prev: V) => unknown
}): Promise<SaveCounts> {
  const existing = new Map((await o.existing()).map((e) => [e.key, e]))
  const counts: SaveCounts = { created: 0, updated: 0, deactivated: 0, unchanged: 0 }
  const ops: unknown[] = []
  const keep = new Set<string>()
  o.rows.forEach((row, position) => {
    const key = o.keyOf(row)
    keep.add(key)
    const prev = existing.get(key)
    if (prev && o.same(prev, row, position)) {
      counts.unchanged++
      return
    }
    if (prev) counts.updated++
    else counts.created++
    ops.push(o.upsert(row, position))
  })
  for (const [key, prev] of existing) {
    if (keep.has(key) || !prev.active) continue
    counts.deactivated++
    ops.push(o.deactivate(key, prev.value))
  }
  if (ops.length) await prisma.$transaction(ops as never)
  return counts
}
