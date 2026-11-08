/**
 * Pure logic for importing the proposal history (plans/proposals-history-import.md).
 *
 * No I/O and no imports from the app: scripts/proposals/import-history.ts reads the private input files and
 * calls buildImport(), and the tests feed it synthetic data. All inputs are untrusted: every accessor is
 * defensive and a malformed value degrades to "unknown" instead of throwing, except the cross-checks that
 * must stop a dry run (a sheet row on two proposals).
 */

import { DEFAULT_EXPLORERS } from './explorers.ts'

// ------------------------------------------------------------------- shared types

export type HistStatus = 'PASSED' | 'FAILED' | 'UNRESOLVED'
export type OutcomeSource = 'override' | 'votes' | 'votes_era_quorum' | 'sheet'

export interface SeshCounts {
  ayes: number
  nays: number
  abstains: number
  /** How many of the abstains were "needs more discussion" votes. */
  discuss: number
  /** Labels or counts could not be read with confidence: never derive an outcome from this. */
  ambiguous: boolean
  reason?: string
}

export interface EraRule {
  /** First day (YYYY-MM-DD, UTC) the rule applies; the latest era starting on or before a poll's date wins. */
  from: string
  countAbstains: boolean
  requireAyesOverNays: boolean
  /** Each nay raises the ayes+abstains threshold by this much (0 = never). */
  nayRaise?: number
  /** Dollar-tiered quorum, ascending; the first tier whose maxUsd >= amount applies (maxUsd null = everything else). Null = no era quorum. */
  tiers?: Array<{ maxUsd: number | null; ayes: number }> | null
}

// ------------------------------------------------------------------- poll results

const MEDALS = /[\u{1F947}-\u{1F949}]/gu

/** Lower-case label text without medals, emoji, custom emoji markup or punctuation. */
export function normalizeLabel(name: string): string {
  return String(name ?? '')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(MEDALS, ' ')
    .replace(/[^\p{L}\p{N}\s’']/gu, ' ')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

type LabelKind = 'aye' | 'nay' | 'abstain' | 'discuss' | 'empty' | 'unknown'

/** "not DAO it" is checked before "DAO it". */
export function classifyLabel(name: string): LabelKind {
  const l = normalizeLabel(name)
  if (!l) return 'empty'
  if (/\bnot dao\b|\bnot dao it\b|^nay\b|^nah\b|^no\b|\bnay$/.test(l)) return 'nay'
  if (/needs? more discussion|\bdiscuss/.test(l)) return 'discuss'
  if (/^abstain\b|\babstain$/.test(l)) return 'abstain'
  if (/\bdao it\b|^aye\b|\baye$|^yah\b|^yes\b|^yea\b|^lfg\b/.test(l)) return 'aye'
  return 'unknown'
}

function countOf(value: unknown): number | null {
  const m = /\((\d{1,6})\)\s*$/.exec(String(value ?? '').trim()) ?? /\((\d{1,6})\)/.exec(String(value ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Read a sesh results embed ({fields: [{name, value}]}). "Needs more discussion" adds to the abstains. A single
 * empty emoji-only label with no aye present counts as the aye. Anything else odd is flagged ambiguous.
 */
export function parseSeshResults(embed: { fields?: Array<{ name?: unknown; value?: unknown }> } | null | undefined): SeshCounts {
  const out: SeshCounts = { ayes: 0, nays: 0, abstains: 0, discuss: 0, ambiguous: false }
  const fields = Array.isArray(embed?.fields) ? embed!.fields! : []
  if (fields.length === 0) return { ...out, ambiguous: true, reason: 'no result fields' }
  const rows = fields.map((f) => ({ kind: classifyLabel(String(f?.name ?? '')), n: countOf(f?.value) }))
  if (rows.some((r) => r.n == null)) return { ...out, ambiguous: true, reason: 'unreadable count' }
  const empties = rows.filter((r) => r.kind === 'empty')
  const hasAye = rows.some((r) => r.kind === 'aye')
  if (empties.length > 1 || (empties.length === 1 && hasAye)) return { ...out, ambiguous: true, reason: 'unlabelled options' }
  if (rows.some((r) => r.kind === 'unknown')) return { ...out, ambiguous: true, reason: 'unknown option label' }
  if (rows.filter((r) => r.kind === 'aye').length > 1 || rows.filter((r) => r.kind === 'nay').length > 1) return { ...out, ambiguous: true, reason: 'duplicate option' }
  for (const r of rows) {
    const n = r.n as number
    if (r.kind === 'aye' || r.kind === 'empty') out.ayes += n
    else if (r.kind === 'nay') out.nays += n
    else if (r.kind === 'abstain') out.abstains += n
    else if (r.kind === 'discuss') {
      out.abstains += n
      out.discuss += n
    }
  }
  return out
}

/** The first line of a sesh description is a "Detailed Results" link; drop it and trim. */
export function cleanBody(description: unknown, max = 8000): string {
  let s = String(description ?? '').replace(/\r\n/g, '\n')
  s = s.replace(/^\s*\*{0,2}\[Detailed Results\]\([^)]*\)\*{0,2}\s*\n?/i, '')
  s = s.trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** A poll title without the sesh decoration ("📊  Title *results*"). */
export function cleanTitle(title: unknown): string {
  return String(title ?? '')
    .replace(/\*results\*\s*$/i, '')
    .replace(/^[^\p{L}\p{N}<@$"'‘“(\[]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ------------------------------------------------------------------- quorum, amounts, eras

/** A quorum from a free-text field ("15", "20 Votes", "25 Ayes + Abstain") or a description line ("Quorum: 20"). */
export function parseQuorum(text: unknown): number | null {
  const s = String(text ?? '')
  const labelled = /quorum\W{0,6}(\d{1,3})\b/i.exec(s) ?? /(?:ayes?\s*\+?\s*abstains?\s*needed)\W{0,6}(\d{1,3})\b/i.exec(s)
  if (labelled) return Number(labelled[1])
  const lead = /^\s*(\d{1,3})\b/.exec(s)
  return lead ? Number(lead[1]) : null
}

export interface ParsedAmount {
  usd: number | null
  /** The text as written, kept when it is not a plain dollar figure. */
  raw: string | null
}

const USD_UNITS = /^(?:usd|usdc|usdt|dai|\$)?$/i

/** A sheet cell ("$1,330") or a description line ("Grant Request: 625 USDC"). Non-USD amounts keep only the raw text. */
export function parseAmount(text: unknown): ParsedAmount {
  const s = String(text ?? '').trim()
  if (!s) return { usd: null, raw: null }
  const m = /(\$)?\s*([\d]{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(usdc|usdt|usd|dai|eth|ether|[a-z]{2,10})?/i.exec(s)
  if (!m) return { usd: null, raw: s }
  const unit = m[4] ?? ''
  const value = Number(`${m[2].replace(/,/g, '')}${m[3] ?? ''}`)
  const isUsd = !!m[1] || /^(usdc|usdt|usd|dai)$/i.test(unit)
  if (!isUsd && !USD_UNITS.test(unit)) return { usd: null, raw: s }
  if (!Number.isFinite(value)) return { usd: null, raw: s }
  return { usd: value, raw: null }
}

const toDay = (d: string): string => d.slice(0, 10)

/** The era in force on `date` (YYYY-MM-DD), else the earliest era. */
export function eraFor(date: string, eras: EraRule[]): EraRule {
  const sorted = [...eras].sort((a, b) => a.from.localeCompare(b.from))
  let hit = sorted[0]
  for (const e of sorted) if (e.from <= toDay(date)) hit = e
  return hit ?? { from: '0000-00-00', countAbstains: true, requireAyesOverNays: true }
}

/** The quorum that era required for this amount, or null when it has no dollar tiers or the amount is unknown. */
export function eraQuorum(date: string, amountUsd: number | null, eras: EraRule[], kind: 'FUNDING' | 'GENERAL' = 'FUNDING'): number | null {
  const e = eraFor(date, eras)
  const tiers = e.tiers
  if (!tiers || tiers.length === 0) return null
  if (amountUsd == null) {
    if (kind === 'GENERAL') return tiers[0].ayes
    return null
  }
  for (const t of tiers) if (t.maxUsd == null || amountUsd <= t.maxUsd) return t.ayes
  return null
}

/** The pass rule of an era applied to counts and a base quorum. */
export function passes(c: { ayes: number; nays: number; abstains: number }, quorum: number, era: EraRule): boolean {
  const threshold = quorum + (era.nayRaise ?? 0) * c.nays
  const sum = c.ayes + (era.countAbstains ? c.abstains : 0)
  return sum >= threshold && (!era.requireAyesOverNays || c.ayes > c.nays)
}

export interface OutcomeInput {
  override?: HistStatus | null
  counts: SeshCounts | null
  ended: boolean
  statedQuorum: number | null
  sheetStatus: HistStatus | null
  eraQuorum: number | null
  era: EraRule
}

export interface Outcome {
  status: HistStatus
  source: OutcomeSource | null
  /** Counts with the stated quorum disagree with the sheet (the sheet wins unless an override rules). */
  conflict: boolean
  derived: HistStatus | null
}

/**
 * Override > counts with the stated quorum (when the sheet agrees or is silent) > sheet > counts with the era
 * quorum > unresolved. Counts of an unended or ambiguous poll are never used. Where counts with a stated quorum
 * and the sheet disagree, the sheet wins and the row is flagged as a conflict.
 */
export function deriveOutcome(i: OutcomeInput): Outcome {
  const usable = !!i.counts && !i.counts.ambiguous && i.ended
  const stated = usable && i.statedQuorum != null ? (passes(i.counts!, i.statedQuorum, i.era) ? 'PASSED' : 'FAILED') : null
  const era = usable && i.statedQuorum == null && i.eraQuorum != null ? (passes(i.counts!, i.eraQuorum, i.era) ? 'PASSED' : 'FAILED') : null
  const derived: HistStatus | null = stated ?? era
  if (i.override) return { status: i.override, source: 'override', conflict: false, derived }
  if (stated && i.sheetStatus) {
    return stated === i.sheetStatus
      ? { status: stated, source: 'votes', conflict: false, derived }
      : { status: i.sheetStatus, source: 'sheet', conflict: true, derived }
  }
  if (stated) return { status: stated, source: 'votes', conflict: false, derived }
  if (i.sheetStatus) return { status: i.sheetStatus, source: 'sheet', conflict: !!era && era !== i.sheetStatus, derived }
  if (era) return { status: era, source: 'votes_era_quorum', conflict: false, derived }
  return { status: 'UNRESOLVED', source: null, conflict: false, derived }
}

// ------------------------------------------------------------------- sheet cells and dates

export function sheetStatusOf(cell: unknown): HistStatus | null {
  const s = String(cell ?? '').trim().toLowerCase()
  if (s === 'paid' || s === 'passed' || s === 'retro complete') return 'PASSED'
  if (s === 'failed') return 'FAILED'
  return null
}

/** US M/D/YY or M/D/YYYY -> YYYY-MM-DD, or null when it is not a real date. */
export function parseUsDate(text: unknown): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/.exec(String(text ?? ''))
  if (!m) return null
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const mo = Number(m[1])
  const d = Number(m[2])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

// ------------------------------------------------------------------- finance lines

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface PaymentInput {
  paidAt: string | null
  amount: string | null
  asset: string | null
  chain: string | null
  usdCents: number | null
  txHash: string | null
  offchainRef: string | null
  note: string | null
  source: 'finance_match' | 'discord_thread' | 'sheet' | 'override'
  sourceKey: string
  /** The chain is missing or not a known explorer key: the hash shows without a link; listed in the review. */
  chainAssumed?: boolean
}

export interface FinanceLine {
  title: string
  dateProposed: string
  message: string | null
  confidence: Confidence
  note: string
  /** The finance file says only part of the amount was paid. */
  partial: boolean
  payments: PaymentInput[]
  raw: unknown
}

const TX = /^0x[0-9a-fA-F]{64}$/

export const messageIdOf = (url: unknown): string | null => {
  const m = /\/(\d{15,25})\/?(?:[?#].*)?$/.exec(String(url ?? '').trim())
  return m ? m[1] : null
}

const dayOrNull = (d: unknown): string | null => (/^\d{4}-\d{2}-\d{2}/.test(String(d ?? '')) ? String(d).slice(0, 10) : null)

/** One finance JSON line -> payments with a confidence rating. Never throws on odd input. */
export function parsePayment(line: unknown): FinanceLine {
  const o = (line && typeof line === 'object' ? line : {}) as Record<string, unknown>
  const note = String(o.note ?? '')
  const conf = /^\s*confidence\s+(high|medium|low)\b/i.exec(note)
  const confidence: Confidence = conf ? (conf[1].toLowerCase() as Confidence) : 'none'
  const list = Array.isArray(o.payments) ? (o.payments as unknown[]) : []
  const payments: PaymentInput[] = []
  list.forEach((p, idx) => {
    const r = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    const ref = String(r['txHash or ref'] ?? r.txHash ?? r.ref ?? '').trim()
    const isTx = TX.test(ref)
    const usd = typeof r.usd === 'number' && Number.isFinite(r.usd) ? Math.round(r.usd * 100) : typeof r.usd === 'string' && r.usd.trim() && Number.isFinite(Number(r.usd)) ? Math.round(Number(r.usd) * 100) : null
    const amount = r.amount != null && String(r.amount).trim() !== '' && Number.isFinite(Number(r.amount)) ? String(r.amount).trim() : null
    // The finance file names the chain of an on-chain leg; an unknown or missing one stays unlinked (and is warned about).
    const legChain = typeof r.chain === 'string' && /^[a-z][a-z0-9_-]{0,30}$/.test(r.chain.trim().toLowerCase()) ? r.chain.trim().toLowerCase() : null
    const method = typeof r.method === 'string' && /^[a-z][a-z0-9 _-]{0,30}$/i.test(r.method.trim()) ? r.method.trim().toLowerCase() : null
    const offRef = !isTx ? [method, ref].filter(Boolean).join(': ').slice(0, 200) : ''
    payments.push({
      paidAt: dayOrNull(r.date),
      amount,
      asset: r.asset ? String(r.asset).slice(0, 20) : null,
      chain: isTx ? legChain : null,
      usdCents: usd,
      txHash: isTx ? ref.toLowerCase() : null,
      offchainRef: offRef || null,
      note: r.payee ? String(r.payee).slice(0, 300) : null,
      source: 'finance_match',
      // Stable across re-runs: the chain and hash, or the method and reference. The amount only helps when there is no reference.
      sourceKey: isTx ? `finance:tx:${legChain ?? ''}:${ref.toLowerCase()}:${r.asset ? String(r.asset).slice(0, 20) : ''}` : offRef ? `finance:off:${offRef.slice(0, 120)}:${dayOrNull(r.date) ?? ''}:${r.asset ? String(r.asset).slice(0, 20) : ''}` : `finance:off::${dayOrNull(r.date) ?? ''}:${amount ?? ''}:${r.asset ? String(r.asset).slice(0, 20) : ''}:${idx}`,
      chainAssumed: isTx && (!legChain || !Object.prototype.hasOwnProperty.call(DEFAULT_EXPLORERS, legChain)),
    })
  })
  return { title: String(o.title ?? ''), dateProposed: String(o.dateProposed ?? ''), message: messageIdOf(o.discordMessage), confidence, note, partial: String(o.paid ?? '').toLowerCase() === 'partial', payments, raw: line }
}

// ------------------------------------------------------------------- inputs

export interface ImportInputs {
  /** inventory.json -> proposals[] */
  inventory: Array<Record<string, unknown>>
  /** inventory.json -> preSheetCandidates[] */
  early: Array<Record<string, unknown>>
  /** Raw sesh messages (proposals-raw.json). */
  raw: Array<Record<string, unknown>>
  /** Raw channel messages for the early posts (discord messages with id, content, timestamp, reactions, author). */
  earlyMessages: Array<Record<string, unknown>>
  /** The sheet as a table; row 1 is the header, data rows are 2..n (row numbers as in the sheet). */
  sheet: string[][]
  eras: EraRule[]
  finance: unknown[]
  overrides: Record<string, RowOverride>
  /** Members for proposer matching: Discord id and the name as the members sheet has it. */
  members?: Array<{ discordId: string; name: string }>
  guildId: string
  channelId: string
  sheetUrl?: string | null
}

export interface RowOverride {
  outcome?: HistStatus
  paid?: boolean
  sheetRows?: number[]
  proposerDiscordId?: string | null
  amountUsd?: number | null
  title?: string
  exclude?: boolean
  mergeInto?: string
  resubmissionOf?: string
  /** Finance lines whose Discord message id is listed here are attached to this row instead of the poll they name. */
  financeFrom?: string[]
  /** txHash (lower case) -> chain key, for payments whose chain the finance file does not say. */
  paymentChains?: Record<string, string>
  payments?: Array<Partial<PaymentInput> & { sourceKey?: string }>
  links?: Array<{ kind: string; url?: string | null; label?: string | null; sourceKey?: string }>
  note?: string
}

export interface LinkInput {
  kind: 'discord_poll' | 'discord_thread' | 'sheet' | 'doc' | 'other'
  url: string | null
  label: string | null
  sourceKey: string
}

export interface ImportRow {
  importKey: string
  title: string
  body: string
  kind: 'FUNDING' | 'GENERAL'
  status: HistStatus
  amountUsdCents: number | null
  eventDate: string | null
  city: string | null
  proposerDiscordId: string | null
  proposerLabel: string | null
  opensAt: string | null
  closesAt: string | null
  closedAt: string | null
  ayesNeeded: number | null
  countAbstains: boolean
  requireAyesOverNays: boolean
  ayes: number
  nays: number
  abstains: number
  votesRecorded: boolean
  outcomeSource: OutcomeSource | null
  paidOverride: boolean | null
  historical: Record<string, unknown>
  links: LinkInput[]
  payments: PaymentInput[]
}

export interface ReviewItem {
  key: string
  title: string
  date: string | null
  detail: string
}

export interface Review {
  unresolved: ReviewItem[]
  conflicts: ReviewItem[]
  unendedOrAmbiguous: ReviewItem[]
  nonUsdAmounts: ReviewItem[]
  unmatchedProposers: ReviewItem[]
  /** Payments on a proposal that did not pass, or with an assumed chain / unparsed amount. */
  paymentWarnings: ReviewItem[]
  mediumPayments: ReviewItem[]
  lowPayments: ReviewItem[]
  unmatchedFinance: ReviewItem[]
  reattachedSheetRows: ReviewItem[]
  noQuorum: ReviewItem[]
}

export interface ImportResult {
  rows: ImportRow[]
  review: Review
  errors: string[]
}

// ------------------------------------------------------------------- helpers

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const normTitle = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const discordUrl = (g: string, c: string, m: string) => `https://discord.com/channels/${g}/${c}/${m}`

function isoOrNull(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

interface SheetRowData {
  row: number
  date: string | null
  dateRaw: string
  eventDateRaw: string
  status: HistStatus | null
  statusRaw: string
  member: string
  title: string
  location: string
  amountRaw: string
  amountUsd: number | null
  link: string
  tweet: string
  notes: string
}

function readSheet(table: string[][]): Map<number, SheetRowData> {
  const out = new Map<number, SheetRowData>()
  table.forEach((r, idx) => {
    const row = idx + 1
    if (row < 2 || !Array.isArray(r)) return
    const c = (n: number) => str(r[n]).trim()
    const amount = parseAmount(c(6))
    out.set(row, {
      row,
      date: parseUsDate(c(0)),
      dateRaw: c(0),
      eventDateRaw: c(1),
      status: sheetStatusOf(c(2)),
      statusRaw: c(2),
      member: c(3),
      title: c(4),
      location: c(5),
      amountRaw: c(6),
      amountUsd: amount.usd,
      link: c(8),
      tweet: c(9),
      notes: c(10),
    })
  })
  return out
}

function eraKey(date: string): string {
  return date.slice(0, 10)
}

export function cleanUrl(u: string): string | null {
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.hostname.endsWith('discordapp.com') || url.hostname.endsWith('discordapp.net')) url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

function embedOf(m: Record<string, unknown>): Record<string, unknown> {
  return rec(arr(m.embeds)[0])
}

/** The proposer mentioned in the poll description, only when it is unambiguous. */
export function mentionedProposer(description: string): string | null {
  const memberLine = /member\W{0,6}([^\n]*)/i.exec(description)
  const fromLine = memberLine ? new Set(Array.from(memberLine[1].matchAll(/<@!?(\d{15,25})>/g), (x) => x[1])) : new Set<string>()
  if (fromLine.size === 1) return [...fromLine][0]
  const all = new Set(Array.from(description.matchAll(/<@!?(\d{15,25})>/g), (x) => x[1]))
  return all.size === 1 ? [...all][0] : null
}

function memberLineName(description: string): string | null {
  const m = /member\W{0,6}([^\n<@]{2,60})/i.exec(description)
  const v = m ? m[1].replace(/[*_`]/g, '').trim() : ''
  return v || null
}

function uniqueMatch<T>(list: T[], pick: (x: T) => string, name: string): T | null {
  const n = name.trim().toLowerCase()
  if (!n) return null
  const hits = list.filter((x) => pick(x).trim().toLowerCase() === n)
  return hits.length === 1 ? hits[0] : null
}

// ------------------------------------------------------------------- the build

export function buildImport(inp: ImportInputs): ImportResult {
  const errors: string[] = []
  const review: Review = {
    unresolved: [], conflicts: [], unendedOrAmbiguous: [], nonUsdAmounts: [], unmatchedProposers: [], paymentWarnings: [],
    mediumPayments: [], lowPayments: [], unmatchedFinance: [], reattachedSheetRows: [], noQuorum: [],
  }
  const sheet = readSheet(inp.sheet)
  const overrides = inp.overrides ?? {}
  const members = (inp.members ?? []).filter((m) => m && m.discordId && m.name)

  // Inventory entries by Discord message id (the inventory's own sheet linking is only a default).
  const invByMsg = new Map<string, Record<string, unknown>>()
  for (const e of inp.inventory) for (const u of arr(e.discordMessages)) { const id = messageIdOf(u); if (id) invByMsg.set(id, e) }

  // Sheet rows claimed by an override win over the inventory.
  const owner = new Map<number, string>()
  for (const [key, o] of Object.entries(overrides)) {
    for (const r of arr<number>(o?.sheetRows)) {
      if (!sheet.has(r)) errors.push(`override ${key}: sheet row ${r} does not exist`)
      if (owner.has(r) && owner.get(r) !== key) errors.push(`sheet row ${r} is claimed by two overrides (${owner.get(r)} and ${key})`)
      owner.set(r, key)
    }
  }

  const attached = new Map<number, string>() // sheet row -> importKey
  const rowsByKey = new Map<string, ImportRow>()
  const ctxByKey = new Map<string, { messageId: string | null; sheetRows: number[]; inv: Record<string, unknown> | null }>()

  const attach = (key: string, rows: number[]) => {
    for (const r of rows) {
      if (attached.has(r) && attached.get(r) !== key) errors.push(`sheet row ${r} is attached to two proposals (${attached.get(r)} and ${key})`)
      attached.set(r, key)
    }
  }

  // ---- 1. one row per sesh poll
  const polls = [...inp.raw].sort((a, b) => str(a.id).localeCompare(str(b.id), 'en', { numeric: true }))
  for (const m of polls) {
    const id = str(m.id)
    if (!/^\d{15,25}$/.test(id)) continue
    const key = `discord:${id}`
    const o = overrides[key] ?? {}
    if (o.exclude || o.mergeInto) continue
    const inv = invByMsg.get(id) ?? null
    const embed = embedOf(m)
    const desc = str(embed.description)
    const invRows = arr<number>(inv?.sheetRows).filter((r) => sheet.has(r) && !(owner.has(r) && owner.get(r) !== key))
    const sheetRows = o.sheetRows !== undefined ? arr<number>(o.sheetRows) : invRows
    attach(key, sheetRows)
    ctxByKey.set(key, { messageId: id, sheetRows, inv })
    const sd = sheetRows.map((r) => sheet.get(r)).filter(Boolean) as SheetRowData[]
    const first = sd[0] ?? null

    const counts = parseSeshResults(embed)
    const footer = str(rec(embed.footer).text)
    const ended = /results\s*\*?\s*$/i.test(str(embed.title)) || /poll has ended/i.test(footer)
    const opensAt = isoOrNull(m.timestamp)
    const closedAt = ended ? (isoOrNull(m.edited_timestamp) ?? opensAt) : opensAt
    const date = (opensAt ?? first?.date ?? str(inv?.dateProposed)).slice(0, 10)
    const title = o.title ?? (str(inv?.title) || cleanTitle(embed.title))
    const sheetAmount = sd.map((s) => s.amountUsd).find((a) => a != null && a > 0) ?? null
    const invAmount = typeof inv?.amountUsd === 'number' && inv.amountUsd > 0 ? (inv.amountUsd as number) : null
    const textAmount = parseAmount(/(?:grant request|comp\/cost|cost|amount|requesting|request)\W{0,6}([^\n]{1,40})/i.exec(desc)?.[1] ?? '')
    const amountUsd = o.amountUsd !== undefined ? o.amountUsd : (sheetAmount ?? invAmount ?? textAmount.usd)
    const amountRawText = str(inv?.amountRaw) || (amountUsd == null ? (textAmount.raw ?? first?.amountRaw ?? '') : '')
    const kind: 'FUNDING' | 'GENERAL' = amountUsd != null && amountUsd > 0 ? 'FUNDING' : 'GENERAL'
    const era = eraFor(date, inp.eras)
    const statedQuorum = parseQuorum(inv?.quorum) ?? parseQuorum(desc)
    const eraQ = eraQuorum(date, amountUsd, inp.eras, kind)
    const sheetStatus = sd.map((s) => s.status).find((s) => s != null) ?? sheetStatusOfInventory(inv)
    const usable = ended && !counts.ambiguous
    const out = deriveOutcome({ override: o.outcome ?? null, counts, ended, statedQuorum, sheetStatus, eraQuorum: eraQ, era })

    // Proposer: override > inventory/embed mention > members sheet name > guild nick/global name/username.
    const written = first?.member || str(inv?.proposer) || memberLineName(desc) || ''
    const mentionedIds = arr<Record<string, unknown>>(m.mentions)
    let proposerId: string | null = o.proposerDiscordId !== undefined ? o.proposerDiscordId : (str(inv?.proposerDiscordId) || mentionedProposer(desc))
    if (!proposerId && written) {
      proposerId = uniqueMatch(members, (x) => x.name, written)?.discordId ?? null
      if (!proposerId) {
        const hit = uniqueMatch(mentionedIds, (x) => str(x.global_name), written) ?? uniqueMatch(mentionedIds, (x) => str(x.username), written)
        proposerId = hit ? str(hit.id) || null : null
      }
    }
    const proposerLabel = proposerId ? null : written && written.toLowerCase() !== 'pizzadao' ? written : written || null
    if (!proposerId && !written) review.unmatchedProposers.push({ key, title, date, detail: 'no proposer name found' })
    else if (!proposerId) review.unmatchedProposers.push({ key, title, date, detail: `name as written: ${written}` })

    const eventDateRaw = first?.eventDateRaw || str(inv?.eventDate)
    const eventDate = parseUsDate(eventDateRaw)
    const threadId = str(rec(m.thread).id)
    const links: LinkInput[] = [{ kind: 'discord_poll', url: discordUrl(inp.guildId, inp.channelId, id), label: 'Discord poll', sourceKey: `poll:${id}` }]
    if (threadId && Number(rec(m.thread).message_count ?? 0) > 0) {
      links.push({ kind: 'discord_thread', url: discordUrl(inp.guildId, threadId, ''), label: 'Discord thread', sourceKey: `thread:${threadId}` })
      links[1].url = `https://discord.com/channels/${inp.guildId}/${threadId}`
    }
    for (const s of sd) addSheetLinks(links, s, inp.sheetUrl ?? null)

    const row: ImportRow = {
      importKey: key,
      title: title.slice(0, 200) || '(untitled)',
      body: cleanBody(desc),
      kind,
      status: out.status,
      amountUsdCents: amountUsd == null ? null : Math.round(amountUsd * 100),
      eventDate,
      city: (first?.location || str(inv?.cityOrEvent) || null)?.trim().slice(0, 100) || null,
      proposerDiscordId: proposerId,
      proposerLabel,
      opensAt,
      closesAt: closedAt,
      closedAt,
      ayesNeeded: statedQuorum ?? eraQ,
      countAbstains: era.countAbstains,
      requireAyesOverNays: era.requireAyesOverNays,
      ayes: usable ? counts.ayes : 0,
      nays: usable ? counts.nays : 0,
      abstains: usable ? counts.abstains : 0,
      votesRecorded: usable,
      outcomeSource: out.source,
      paidOverride: o.paid ?? null,
      historical: compact({
        amountRaw: amountRawText || null,
        quorumStated: statedQuorum,
        sheetStatus: first?.statusRaw || str(inv?.sheetStatus) || null,
        eventDateRaw: eventDateRaw || null,
        discussVotes: usable && counts.discuss ? counts.discuss : null,
        nayRaise: era.nayRaise ?? null,
        notes: o.note ?? (sd.map((s) => s.notes).filter(Boolean).join('\n') || null),
        derived: out.derived,
      }),
      links,
      payments: [],
    }
    rowsByKey.set(key, row)

    const item = { key, title, date, detail: '' }
    if (!usable) review.unendedOrAmbiguous.push({ ...item, detail: !ended ? 'poll not ended' : `ambiguous results: ${counts.reason ?? ''}` })
    if (out.conflict) review.conflicts.push({ ...item, detail: `counts say ${out.derived ?? '?'}, sheet says ${sheetStatus}; used ${out.status}` })
    if (out.status === 'UNRESOLVED') review.unresolved.push({ ...item, detail: usable ? `no quorum${eraQ == null ? ' and no era quorum' : ''}` : 'poll not usable' })
    if (statedQuorum == null && usable) review.noQuorum.push({ ...item, detail: eraQ == null ? 'no stated quorum, no era quorum' : `era quorum ${eraQ}` })
    if (amountRawText && amountUsd == null) review.nonUsdAmounts.push({ ...item, detail: amountRawText })
    else if (str(inv?.amountRaw) && !/^\$?[\d,.]+$/.test(str(inv?.amountRaw).trim())) review.nonUsdAmounts.push({ ...item, detail: `${str(inv?.amountRaw)} (USD ${amountUsd})` })
    if (o.sheetRows !== undefined) review.reattachedSheetRows.push({ ...item, detail: `sheet rows ${JSON.stringify(sheetRows)} (override; inventory had ${JSON.stringify(arr(inv?.sheetRows))})` })
  }

  // ---- 2. sheet rows left over
  for (const [r, s] of sheet) {
    if (attached.has(r) || !s.title) continue
    const key = `sheet:${r}`
    const o = overrides[key] ?? {}
    if (o.exclude || o.mergeInto) continue
    attach(key, [r])
    ctxByKey.set(key, { messageId: messageIdOf(s.link), sheetRows: [r], inv: null })
    const title = o.title ?? s.title
    const status = o.outcome ?? s.status ?? 'UNRESOLVED'
    const amountUsd = o.amountUsd !== undefined ? o.amountUsd : s.amountUsd != null && s.amountUsd > 0 ? s.amountUsd : null
    const links: LinkInput[] = []
    const mid = messageIdOf(s.link)
    if (mid) links.push({ kind: 'other', url: cleanUrl(s.link), label: 'Discord message (from the sheet)', sourceKey: `sheetlink:${mid}` })
    addSheetLinks(links, s, inp.sheetUrl ?? null)
    const when = s.date ? `${s.date}T00:00:00.000Z` : null
    const written = s.member
    const proposerId = o.proposerDiscordId !== undefined ? o.proposerDiscordId : (written ? uniqueMatch(members, (x) => x.name, written)?.discordId ?? null : null)
    const row: ImportRow = {
      importKey: key, title: title.slice(0, 200), body: s.notes && !/^https?:/i.test(s.notes) ? s.notes.slice(0, 8000) : '',
      kind: amountUsd != null ? 'FUNDING' : 'GENERAL', status,
      amountUsdCents: amountUsd == null ? null : Math.round(amountUsd * 100),
      eventDate: parseUsDate(s.eventDateRaw), city: s.location.slice(0, 100) || null,
      proposerDiscordId: proposerId, proposerLabel: proposerId ? null : written || null,
      opensAt: when, closesAt: when, closedAt: when, ayesNeeded: null,
      countAbstains: eraFor(s.date ?? '2022-01-01', inp.eras).countAbstains, requireAyesOverNays: eraFor(s.date ?? '2022-01-01', inp.eras).requireAyesOverNays,
      ayes: 0, nays: 0, abstains: 0, votesRecorded: false, outcomeSource: o.outcome ? 'override' : s.status ? 'sheet' : null, paidOverride: o.paid ?? null,
      historical: compact({ amountRaw: s.amountRaw && amountUsd == null ? s.amountRaw : null, sheetStatus: s.statusRaw || null, eventDateRaw: s.eventDateRaw || null, notes: o.note ?? (s.notes || null) }),
      links, payments: [],
    }
    rowsByKey.set(key, row)
    const item = { key, title, date: s.date, detail: '' }
    if (status === 'UNRESOLVED') review.unresolved.push({ ...item, detail: 'sheet-only row without a usable status' })
    if (!proposerId) review.unmatchedProposers.push({ key, title, date: s.date, detail: written ? `name as written: ${written}` : 'no proposer name found' })
  }

  // ---- 3. the early posts (reactions, never votes)
  const earlyById = new Map(inp.earlyMessages.map((m) => [str(m.id), m]))
  for (const c of inp.early) {
    const id = messageIdOf(arr(c.discordMessages)[0])
    if (!id) continue
    const key = `early:${id}`
    const o = overrides[key] ?? {}
    if (o.exclude) continue
    const m = rec(earlyById.get(id))
    const when = isoOrNull(m.timestamp) ?? (str(c.dateProposed) ? `${str(c.dateProposed).slice(0, 10)}T00:00:00.000Z` : null)
    const reactions = arr<Record<string, unknown>>(m.reactions)
      .map((r) => ({ emoji: str(rec(r.emoji).name), count: Number(r.count) || 0 }))
      .filter((r) => r.emoji && r.count > 0)
      .slice(0, 12)
    const body = str(m.content) || arr<string>(c.notes).join('\n')
    const row: ImportRow = {
      importKey: key, title: (o.title ?? (str(c.title) || 'Early proposal')).slice(0, 200), body: body.slice(0, 8000),
      kind: 'GENERAL', status: o.outcome ?? 'UNRESOLVED', amountUsdCents: null, eventDate: null, city: null,
      proposerDiscordId: o.proposerDiscordId !== undefined ? o.proposerDiscordId : (str(c.proposerDiscordId) || str(rec(m.author).id) || null),
      proposerLabel: str(c.proposer) || str(rec(m.author).global_name) || str(rec(m.author).username) || null,
      opensAt: when, closesAt: when, closedAt: when, ayesNeeded: null,
      countAbstains: eraFor(when ?? '2021-01-01', inp.eras).countAbstains, requireAyesOverNays: eraFor(when ?? '2021-01-01', inp.eras).requireAyesOverNays,
      ayes: 0, nays: 0, abstains: 0, votesRecorded: false, outcomeSource: o.outcome ? 'override' : null, paidOverride: o.paid ?? null,
      historical: compact({ reactions, notes: o.note ?? null }),
      links: [{ kind: 'discord_poll', url: discordUrl(inp.guildId, inp.channelId, id), label: 'Discord post', sourceKey: `poll:${id}` }],
      payments: [],
    }
    rowsByKey.set(key, row)
    ctxByKey.set(key, { messageId: id, sheetRows: [], inv: c })
  }

  // ---- 4. overrides: mergeInto (extra links onto the target), extra links, resubmissions
  for (const [key, o] of Object.entries(overrides)) {
    if (o.mergeInto) {
      const target = rowsByKey.get(o.mergeInto)
      if (!target) { errors.push(`override ${key}: mergeInto ${o.mergeInto} is not an imported row`); continue }
      const mid = key.startsWith('discord:') ? key.slice(8) : null
      if (mid) target.links.push({ kind: 'other', url: discordUrl(inp.guildId, inp.channelId, mid), label: 'Merged poll', sourceKey: `merged:${mid}` })
      for (const r of key.startsWith('sheet:') ? [Number(key.slice(6))] : arr<number>(o.sheetRows)) {
        const s = sheet.get(r)
        if (s) addSheetLinks(target.links, s, inp.sheetUrl ?? null)
      }
    }
    const row = rowsByKey.get(key)
    if (!row) continue
    for (const l of arr<NonNullable<RowOverride['links']>[number]>(o.links)) {
      const url = l.url ? cleanUrl(l.url) : null
      const kind = (['discord_poll', 'discord_thread', 'sheet', 'doc', 'other'].includes(l.kind) ? l.kind : 'other') as LinkInput['kind']
      row.links.push({ kind, url, label: l.label ?? null, sourceKey: l.sourceKey ?? `override:${kind}:${url ?? l.label ?? row.links.length}` })
    }
  }

  // Resubmissions: an override, else the same title as an earlier row.
  const byTitle = new Map<string, ImportRow[]>()
  for (const r of [...rowsByKey.values()].sort((a, b) => (a.opensAt ?? '').localeCompare(b.opensAt ?? ''))) {
    const t = normTitle(r.title)
    const prior = byTitle.get(t) ?? []
    const o = overrides[r.importKey]
    const of = o?.resubmissionOf ?? (t.length >= 8 && prior.length > 0 ? prior[prior.length - 1].importKey : null)
    if (of && of !== r.importKey && rowsByKey.has(of)) {
      r.historical.resubmissionOf = of
      const earlier = rowsByKey.get(of)!
      const pollUrl = earlier.links.find((l) => l.kind === 'discord_poll')?.url ?? null
      r.links.push({ kind: 'other', url: pollUrl, label: 'Earlier attempt', sourceKey: `resub:${of}` })
    }
    byTitle.set(t, [...prior, r])
  }

  // ---- 5. payments: finance file (high confidence only), thread/override payments, sheet "Paid" fallback
  const lines = inp.finance.map(parsePayment)
  const keyByMsg = new Map<string, string>()
  for (const [key, c] of ctxByKey) if (c.messageId && !keyByMsg.has(c.messageId)) keyByMsg.set(c.messageId, key)
  const keysByTitleDate = new Map<string, string[]>()
  for (const r of rowsByKey.values()) {
    const k = `${normTitle(r.title)}|${(r.opensAt ?? '').slice(0, 10)}`
    keysByTitleDate.set(k, [...(keysByTitleDate.get(k) ?? []), r.importKey])
  }
  const redirect = new Map<string, string>()
  for (const [k, o] of Object.entries(overrides)) for (const m of arr<string>(o?.financeFrom)) redirect.set(m, k)
  for (const line of lines) {
    let key: string | null = line.message ? (redirect.get(line.message) ?? keyByMsg.get(line.message) ?? null) : null
    if (key && !rowsByKey.has(key)) key = null
    if (!key) {
      const hits = keysByTitleDate.get(`${normTitle(line.title)}|${line.dateProposed.slice(0, 10)}`) ?? []
      if (hits.length === 1) key = hits[0]
    }
    const item = { key: key ?? '', title: line.title, date: line.dateProposed || null, detail: '' }
    if (line.payments.length === 0) continue
    if (!key) { review.unmatchedFinance.push({ ...item, detail: `${line.payments.length} payment(s), confidence ${line.confidence}` }); continue }
    const row = rowsByKey.get(key)!
    if (line.confidence === 'medium') { review.mediumPayments.push({ ...item, detail: `${line.payments.map(fmtPayment).join('; ')} | ${line.note.slice(0, 200)}` }); continue }
    if (line.confidence !== 'high') { review.lowPayments.push({ ...item, detail: `confidence ${line.confidence}: ${line.payments.map(fmtPayment).join('; ')}` }); continue }
    if (line.partial) row.historical.partlyPaid = true
    for (const p of line.payments) {
      row.payments.push(p)
      if (p.chainAssumed) review.paymentWarnings.push({ ...item, detail: `${p.chain ? `unknown chain ${p.chain}` : 'no chain'} for ${p.txHash?.slice(0, 12)}: shown without an explorer link` })
      if (p.usdCents == null) review.paymentWarnings.push({ ...item, detail: `payment without a USD value, shown as its own line and left out of USD totals (${fmtPayment(p)})` })
    }
    if (row.status !== 'PASSED') review.paymentWarnings.push({ ...item, detail: `payment on a ${row.status} proposal` })
  }
  for (const [key, o] of Object.entries(overrides)) {
    const row = rowsByKey.get(key)
    if (!row) continue
    arr<NonNullable<RowOverride['payments']>[number]>(o.payments).forEach((p, i) => {
      const tx = p.txHash && TX.test(p.txHash) ? p.txHash.toLowerCase() : null
      row.payments.push({
        paidAt: p.paidAt ?? null, amount: p.amount ?? null, asset: p.asset ?? null, chain: tx && typeof p.chain === 'string' && /^[a-z][a-z0-9_-]{0,30}$/.test(p.chain) ? p.chain : null, chainAssumed: !!tx && !(typeof p.chain === 'string' && Object.prototype.hasOwnProperty.call(DEFAULT_EXPLORERS, p.chain)),
        usdCents: p.usdCents ?? null, txHash: tx, offchainRef: p.offchainRef ?? null, note: p.note ?? null,
        source: p.source === 'discord_thread' ? 'discord_thread' : 'override', sourceKey: p.sourceKey ?? `override:${tx ?? p.offchainRef ?? 'x'}:${i}`,
      })
    })
  }
  for (const [key, o] of Object.entries(overrides)) {
    const row = rowsByKey.get(key)
    if (!row || !o.paymentChains) continue
    for (const p of row.payments) {
      const c = p.txHash ? o.paymentChains[p.txHash.toLowerCase()] : undefined
      if (c) { p.chain = c; p.chainAssumed = false }
    }
  }
  // Override payments (and overridden chains): a missing or unknown chain shows the hash without a link, with a warning.
  for (const row of rowsByKey.values()) {
    for (const p of row.payments) {
      if (p.source !== 'finance_match' && p.txHash && (!p.chain || !Object.prototype.hasOwnProperty.call(DEFAULT_EXPLORERS, p.chain))) {
        review.paymentWarnings.push({ key: row.importKey, title: row.title, date: (row.opensAt ?? '').slice(0, 10) || null, detail: `${p.chain ? `unknown chain ${p.chain}` : 'no chain'} for ${p.txHash.slice(0, 12)}: shown without an explorer link` })
      }
    }
  }
  // Dedupe payments per proposal by sourceKey (a key the finance file and an override both name stays once).
  for (const row of rowsByKey.values()) {
    const seen = new Set<string>()
    row.payments = row.payments.filter((p) => (seen.has(p.sourceKey) ? false : (seen.add(p.sourceKey), true)))
    const ctx = ctxByKey.get(row.importKey)
    const sheetPaid = (ctx?.sheetRows ?? []).some((r) => sheet.get(r)?.statusRaw.toLowerCase() === 'paid')
    const wantsPaid = row.paidOverride === true || (row.paidOverride == null && sheetPaid && row.status === 'PASSED')
    if (wantsPaid && row.payments.length === 0) {
      row.payments.push({
        paidAt: null, amount: null, asset: null, chain: null, usdCents: null, txHash: null,
        offchainRef: null, note: row.paidOverride === true ? 'Recorded as paid' : 'Recorded as paid in the sheet',
        source: row.paidOverride === true ? 'override' : 'sheet', sourceKey: `sheet:paid:${row.importKey}`,
      })
    }
  }

  // ---- 6. cross-checks
  for (const [r, key] of attached) {
    if (owner.has(r) && owner.get(r) !== key) errors.push(`sheet row ${r} attached to ${key} but its override points to ${owner.get(r)}`)
  }
  const seenKeys = new Set<string>()
  const rows = [...rowsByKey.values()].sort((a, b) => (a.opensAt ?? '').localeCompare(b.opensAt ?? '') || a.importKey.localeCompare(b.importKey))
  for (const r of rows) {
    if (seenKeys.has(r.importKey)) errors.push(`duplicate importKey ${r.importKey}`)
    seenKeys.add(r.importKey)
    if (r.status !== 'UNRESOLVED' && r.outcomeSource == null) errors.push(`${r.importKey}: a resolved row without an outcome source`)
  }
  void eraKey
  return { rows, review, errors }
}

// ------------------------------------------------------------------- small utilities

function sheetStatusOfInventory(inv: Record<string, unknown> | null): HistStatus | null {
  return sheetStatusOf(inv?.sheetStatus)
}

function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)))
}

function addSheetLinks(links: LinkInput[], s: SheetRowData, sheetUrl: string | null): void {
  links.push({ kind: 'sheet', url: sheetUrl, label: `Sheet row ${s.row}${s.statusRaw ? ` (${s.statusRaw})` : ''}`, sourceKey: `sheet:${s.row}` })
  const note = /^https?:\/\/\S+$/i.test(s.notes) ? cleanUrl(s.notes) : null
  if (note) links.push({ kind: 'doc', url: note, label: 'Sheet note', sourceKey: `sheetnote:${s.row}` })
  const tweet = /^https?:\/\/\S+$/i.test(s.tweet) ? cleanUrl(s.tweet) : null
  if (tweet) links.push({ kind: 'other', url: tweet, label: 'Post', sourceKey: `tweet:${s.row}` })
}

export function fmtPayment(p: PaymentInput): string {
  return `${p.amount ?? '?'} ${p.asset ?? ''} ${p.usdCents != null ? `($${(p.usdCents / 100).toFixed(2)})` : ''} ${p.txHash ? p.txHash.slice(0, 12) : p.offchainRef ?? ''}`.replace(/\s+/g, ' ').trim()
}

/** Totals for the dry run: by status, outcome source, paid, year, proposer match, and the payment total. */
export function summarize(rows: ImportRow[]) {
  const by = (f: (r: ImportRow) => string) => {
    const m: Record<string, number> = {}
    for (const r of rows) m[f(r)] = (m[f(r)] ?? 0) + 1
    return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)))
  }
  const paidCents = rows.reduce((n, r) => n + r.payments.reduce((x, p) => x + (p.usdCents ?? 0), 0), 0)
  return {
    rows: rows.length,
    byStatus: by((r) => r.status),
    byOutcomeSource: by((r) => r.outcomeSource ?? 'none'),
    byPaid: by((r) => (r.paidOverride ?? r.payments.length > 0 ? 'paid' : 'not paid')),
    byYear: by((r) => (r.opensAt ?? '').slice(0, 4) || 'unknown'),
    byProposerMatch: by((r) => (r.proposerDiscordId ? 'matched' : r.proposerLabel ? 'label only' : 'none')),
    byKeyKind: by((r) => r.importKey.split(':')[0]),
    paymentCount: rows.reduce((n, r) => n + r.payments.length, 0),
    paymentUsdTotal: paidCents / 100,
  }
}

/** Keys present in the database for a proposal but not in the newly built set: re-runs delete these so they converge. */
export function staleKeys(existing: readonly string[], built: readonly string[]): string[] {
  const keep = new Set(built)
  return existing.filter((k) => !keep.has(k))
}
