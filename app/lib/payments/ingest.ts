/**
 * Read-only ingest of the Work Payment form responses (plans/host-fast-track.md phase 2, D5/D10).
 *
 * - The responses sheet id comes from a DB setting (empty = ingest does nothing). No sheet or
 *   Drive id or URL is in the repo, and nothing is ever written back to the sheet.
 * - Columns are matched by header regex. If a REQUIRED header is missing, or matches more than one
 *   column, the whole run fails closed: nothing is ingested and the reason (a header name, never
 *   row contents) is recorded for the queue banner.
 * - The Discord id typed into the form is only a CLAIM: it is stored as `claimedDiscordId`, the
 *   request has no verified requester, and it is flagged `unverified_requester`.
 * - The payee column is hashed and masked in memory; the raw value is dropped and never stored,
 *   returned or logged. Email columns are ignored entirely.
 * - Idempotent: each response gets a stable `sourceRef` built from the sheet's unformatted
 *   timestamp serial, so display-format or timezone changes cannot re-create old rows.
 * - Only responses at or after the "ingest from" moment (set by the top review role; by default the
 *   moment ingest first ran) are read, so switching ingest on never floods the queue with history.
 * - Money: an amount in any currency other than USD is stored with a USD amount of 0, which blocks
 *   approval until a reviewer enters the dollar value.
 */
import { sha256Hex, hashPayee, maskPayee } from './hash'
import type { PaymentKind } from './types'

export type ColumnKey =
  | 'timestamp' | 'discordId' | 'payee' | 'proposal' | 'currency' | 'amount' | 'title' | 'date' | 'city' | 'kind' | 'description' | 'name'

/** Most specific first: each header is claimed by the first column whose pattern matches it. */
const COLUMN_PATTERNS: Array<[ColumnKey, RegExp]> = [
  ['timestamp', /^time\s*stamp$|^submitted( at| on)?$/i],
  ['discordId', /discord.*\bid\b|\bdiscord user\s*id\b/i],
  ['payee', /wallet|payment (method|details?|info)|bank|paypal|paid to|pay to|payout|crypto address|\baddress\b/i],
  ['proposal', /proposal|poll|\bvote\b|sesh/i],
  ['currency', /currenc/i],
  ['amount', /amount|total|how much|cost|price|\busd\b/i],
  ['title', /\btitle\b|subject|event name|project name/i],
  ['date', /\bdate\b|\bwhen\b/i],
  ['city', /\bcity\b/i],
  ['kind', /type of|category|\bkind\b/i],
  ['description', /descri|what (is|was|are|did)|\bwork\b|reason|purpose|details/i],
  ['name', /\bname\b|discord (user)?name|\bhandle\b/i],
]

export const REQUIRED_COLUMNS: readonly ColumnKey[] = ['timestamp', 'amount', 'description']

export type HeaderMap = Partial<Record<ColumnKey, number>>

export function mapHeaders(headers: readonly string[]): { map: HeaderMap; missing: ColumnKey[]; ambiguous: ColumnKey[] } {
  const map: HeaderMap = {}
  const ambiguous: ColumnKey[] = []
  // Email columns are never read: they must not be claimed by "address" or "name" patterns.
  const used = new Set<number>(headers.flatMap((h, i) => (/e-?mail/i.test(h) ? [i] : [])))
  for (const [key, re] of COLUMN_PATTERNS) {
    const matches = headers.flatMap((h, i) => (!used.has(i) && re.test(h.trim()) ? [i] : []))
    if (matches.length > 0) {
      map[key] = matches[0]
      used.add(matches[0])
      // A required column that two headers could both be means we cannot tell which one is meant.
      if (matches.length > 1 && REQUIRED_COLUMNS.includes(key)) ambiguous.push(key)
    }
  }
  return { map, missing: REQUIRED_COLUMNS.filter((k) => map[k] === undefined), ambiguous }
}

/** Currencies recognised in the amount cell. Stablecoins pegged to the dollar count as USD. */
const USD_LIKE = ['USD', 'USDC', 'USDT', 'DAI']
export const KNOWN_CURRENCIES = [
  'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'NZD', 'BRL', 'ARS', 'COP', 'CLP', 'PEN', 'CHF', 'JPY', 'CNY', 'INR',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'TRY', 'ZAR', 'NGN', 'PHP', 'IDR', 'KRW', 'ETH', 'BTC', 'SOL', 'MATIC',
] as const

/**
 * "$1,234.50", "625 USD", "EUR 40", "12,5" -> amount and currency. Only codes from a known list are
 * read as a currency; a three-letter word that is not on it is ignored. An input like "1.234" can
 * mean one thousand or one point two: it is refused rather than guessed.
 */
export function parseAmount(raw: string | number): { value: number; currency: string } | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 && raw <= 10_000_000 ? { value: raw, currency: 'USD' } : null
  const s = raw.trim()
  if (!s) return null
  let currency = 'USD'
  if (/€/.test(s)) currency = 'EUR'
  else if (/£/.test(s)) currency = 'GBP'
  else {
    const words = (s.toUpperCase().match(/\b[A-Z]{3,5}\b/g) ?? []) as string[]
    const found = words.find((w) => USD_LIKE.includes(w) || (KNOWN_CURRENCIES as readonly string[]).includes(w))
    if (found) currency = USD_LIKE.includes(found) ? 'USD' : found
  }
  const num = s.match(/\d[\d.,\s]*/)
  if (!num) return null
  let n = num[0].replace(/\s/g, '').replace(/[.,]+$/, '')
  if (/^\d{1,3}\.\d{3}$/.test(n)) return null // "1.234": thousands or decimals?
  const lastDot = n.lastIndexOf('.')
  const lastComma = n.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma)
    n = n.slice(0, dec).replace(/[.,]/g, '') + '.' + n.slice(dec + 1)
  } else if (lastComma >= 0) {
    n = /,\d{1,2}$/.test(n) && n.indexOf(',') === lastComma ? n.replace(',', '.') : n.replace(/,/g, '')
  }
  const value = Number(n)
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null
  return { value, currency }
}

/** What the importer stores. Deliberately has no field for a raw payee reference. */
export interface NewPaymentRequest {
  source: 'FORM' | 'APP' | 'REVIEWER'
  sourceRef: string | null
  kind: PaymentKind
  /** Verified requester (signed-in app form only). Always null for form rows. */
  requesterDiscordId: string | null
  /** The id typed into a form. A claim: never used as an identity. */
  claimedDiscordId: string | null
  requesterMemberId: string | null
  requesterLabel: string
  title: string
  description: string
  eventDate: Date | null
  eventCity: string | null
  rsvEventSlug: string | null
  amountUsdCents: number
  currency: string
  amountOriginal: number | null
  payeeHash: string | null
  payeeHint: string | null
  proposalUrl: string | null
  /** In-app proposal that funds the request (set by the app form while proposals are on). */
  proposalId?: string | null
}

const SNOWFLAKE = /^\d{17,20}$/

const clip = (s: string, n: number) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n)

function kindFrom(raw: string): PaymentKind {
  if (/reimburs/i.test(raw)) return 'REIMBURSEMENT'
  if (/event|budget/i.test(raw)) return 'EVENT_BUDGET'
  return 'WORK'
}

/** A sheet cell: unformatted values come back as numbers (dates as serial numbers). */
export type Cell = string | number | boolean | null | undefined

/** Google Sheets serial day number to a Date (UTC; the sheet's own zone is not known here). */
export function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86_400_000))
}

/** The moment a response was submitted, from the raw timestamp cell. Null if it cannot be read. */
export function submittedAt(cell: Cell): Date | null {
  if (typeof cell === 'number') return Number.isFinite(cell) && cell > 20000 ? serialToDate(cell) : null
  const t = String(cell ?? '').trim()
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

export type ParsedRow =
  | { ok: true; submittedAt: Date; value: Omit<NewPaymentRequest, 'requesterMemberId'> }
  | { ok: false; reason: 'no_amount' | 'no_description' | 'no_timestamp' }

/** Turn one response row into a request (without member matching). Pure. */
export function parseRow(row: readonly Cell[], map: HeaderMap, sheetId: string, env: NodeJS.ProcessEnv = process.env): ParsedRow {
  const raw = (k: ColumnKey): Cell => (map[k] === undefined ? '' : row[map[k] as number])
  const cell = (k: ColumnKey) => String(raw(k) ?? '').trim()
  const when = submittedAt(raw('timestamp'))
  if (!when) return { ok: false, reason: 'no_timestamp' }
  const amount = parseAmount(typeof raw('amount') === 'number' ? (raw('amount') as number) : cell('amount'))
  if (!amount) return { ok: false, reason: 'no_amount' }
  // A separate currency column wins over a symbol in the amount.
  const currencyCol = cell('currency').toUpperCase()
  let currency = amount.currency
  if (currencyCol) {
    if (USD_LIKE.includes(currencyCol)) currency = 'USD'
    else if ((KNOWN_CURRENCIES as readonly string[]).includes(currencyCol)) currency = currencyCol
    else return { ok: false, reason: 'no_amount' } // an unknown currency is not guessed
  }
  const description = clip(cell('description'), 4000)
  if (!description) return { ok: false, reason: 'no_description' }

  const name = clip(cell('name'), 100)
  const idCell = cell('discordId')
  const claimed = SNOWFLAKE.test(idCell) ? idCell : SNOWFLAKE.test(name) ? name : null
  const label = SNOWFLAKE.test(name) ? 'Form submitter' : name || 'Form submitter'
  const rawPayee = cell('payee')
  const dateStr = cell('date')
  const date = dateStr ? new Date(dateStr) : null
  const proposal = cell('proposal')
  const original = amount.value
  const usd = currency === 'USD'

  return {
    ok: true,
    submittedAt: when,
    value: {
      source: 'FORM',
      sourceRef: 'form:' + sha256Hex(`${sheetId}|${String(raw('timestamp'))}|${name}|${idCell}`).slice(0, 48),
      kind: kindFrom(cell('kind')),
      requesterDiscordId: null,
      claimedDiscordId: claimed,
      requesterLabel: label,
      title: clip(cell('title'), 200) || clip(description, 80),
      description,
      eventDate: date && !Number.isNaN(date.getTime()) ? date : null,
      eventCity: clip(cell('city'), 100) || null,
      rsvEventSlug: null,
      // Not USD: no dollar value is guessed. 0 blocks approval until a reviewer enters it.
      amountUsdCents: usd ? Math.round(original * 100) : 0,
      currency,
      amountOriginal: original,
      payeeHash: rawPayee ? hashPayee(rawPayee, env) : null,
      payeeHint: rawPayee ? maskPayee(rawPayee) : null,
      proposalUrl: /^https:\/\/\S{4,500}$/i.test(proposal) ? proposal : null,
    },
  }
}

export interface IngestStatusInput {
  at: string
  ok: boolean
  error?: string
  warning?: string
  created: number
}

export interface IngestDeps {
  getSheetId: () => Promise<string>
  /** Header row first, then the newest rows. `truncated` = older rows were not read. Read-only. */
  readValues: (sheetId: string) => Promise<{ values: Cell[][]; truncated: boolean }>
  /** The "ingest from" moment, or null if never set. */
  getIngestFrom: () => Promise<Date | null>
  setIngestFrom: (d: Date) => Promise<void>
  findExistingRefs: (refs: string[]) => Promise<Set<string>>
  create: (data: NewPaymentRequest) => Promise<void>
  saveStatus: (s: IngestStatusInput) => Promise<void>
  now?: () => Date
  env?: NodeJS.ProcessEnv
  /** Most new requests created per run (the cron has a time limit). */
  maxNew?: number
}

export interface IngestResult {
  skipped?: 'no_sheet'
  error?: string
  seen: number
  created: number
  invalid: number
  old: number
  truncated?: boolean
}

export const DEFAULT_MAX_NEW = 25

export async function runIngest(deps: IngestDeps): Promise<IngestResult> {
  const nowDate = deps.now?.() ?? new Date()
  const at = nowDate.toISOString()
  const sheetId = await deps.getSheetId()
  if (!sheetId) return { skipped: 'no_sheet', seen: 0, created: 0, invalid: 0, old: 0 }

  let values: Cell[][]
  let truncated = false
  try {
    ;({ values, truncated } = await deps.readValues(sheetId))
  } catch {
    await deps.saveStatus({ at, ok: false, error: 'could not read the responses sheet', created: 0 })
    return { error: 'read_failed', seen: 0, created: 0, invalid: 0, old: 0 }
  }
  const [headers = [], ...rows] = values
  const { map, missing, ambiguous } = mapHeaders(headers.map((h) => String(h ?? '')))
  if (missing.length > 0 || ambiguous.length > 0) {
    const error =
      'ingest paused: ' +
      [missing.length ? `missing header for ${missing.join(', ')}` : '', ambiguous.length ? `more than one column could be ${ambiguous.join(', ')}` : '']
        .filter(Boolean)
        .join('; ')
    await deps.saveStatus({ at, ok: false, error, created: 0 })
    return { error, seen: 0, created: 0, invalid: 0, old: 0 }
  }

  // History from before ingest was switched on is never imported unless the top role moves this back.
  let from = await deps.getIngestFrom()
  if (!from) {
    from = nowDate
    await deps.setIngestFrom(from)
  }

  const parsed: Array<Omit<NewPaymentRequest, 'requesterMemberId'>> = []
  let invalid = 0
  let old = 0
  for (const row of rows) {
    if (row.every((c) => !String(c ?? '').trim())) continue
    const r = parseRow(row, map, sheetId, deps.env)
    if (!r.ok) invalid++
    else if (r.submittedAt.getTime() < from.getTime()) old++
    else parsed.push(r.value)
  }
  const existing = await deps.findExistingRefs(parsed.map((p) => p.sourceRef as string))
  const fresh = parsed.filter((p) => !existing.has(p.sourceRef as string)).slice(0, deps.maxNew ?? DEFAULT_MAX_NEW)
  const warning = truncated ? 'Only the newest rows of the responses sheet were read. Older rows may not have been imported.' : undefined

  let created = 0
  for (const p of fresh) {
    try {
      // No member id from a claim: whatever was typed, a form row has no verified requester.
      await deps.create({ ...p, requesterMemberId: null })
      created++
    } catch (e) {
      // A concurrent run already created it (unique sourceRef): fine. Anything else: stop quietly.
      if (!/unique|P2002/i.test(e instanceof Error ? `${e.name} ${e.message} ${(e as { code?: string }).code ?? ''}` : '')) {
        await deps.saveStatus({ at, ok: false, error: 'could not save a request', warning, created })
        return { error: 'create_failed', seen: parsed.length, created, invalid, old, truncated }
      }
    }
  }
  await deps.saveStatus({ at, ok: true, warning, created })
  return { seen: parsed.length, created, invalid, old, truncated }
}
