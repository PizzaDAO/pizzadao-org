/**
 * Imported calls: find the old X live broadcasts in the account's data archive (tweets.js) and in a manual
 * CSV, and read/write the operator's manifest. Pure functions, unit-tested; nothing here touches the network
 * or the database. The manifest lives in the operator work dir, never in the repo.
 */

export interface BroadcastCandidate {
  /** The broadcast id, as it appears in the link. */
  externalId: string
  /** `x-broadcast-<id>`: the call's sessionId and the manifest key. */
  key: string
  /** Canonical replay link. */
  url: string
  /** When the first post linking it was made (UTC ISO); usually just after the stream. A hint: the probe's timestamp wins. */
  postedAt: string | null
  /** Where the candidate came from. */
  origin: 'archive' | 'manual'
}

const ID = '[A-Za-z0-9]{8,32}'
const PATTERNS: RegExp[] = [
  new RegExp(`(?:x|twitter)\\.com/i/broadcasts/(${ID})`, 'i'),
  new RegExp(`(?:pscp|periscope)\\.tv/w/(${ID})`, 'i'),
  new RegExp(`(?:pscp|periscope)\\.tv/[A-Za-z0-9_]{1,50}/(${ID})`, 'i'),
]

/** The broadcast id in an X / Periscope broadcast link, or null. */
export function broadcastIdFromUrl(url: string): string | null {
  for (const re of PATTERNS) {
    const m = re.exec(url)
    if (m) return m[1]
  }
  return null
}

export const broadcastKey = (externalId: string) => `x-broadcast-${externalId}`
export const broadcastUrl = (externalId: string) => `https://x.com/i/broadcasts/${externalId}`

/** `window.YTD.tweets.part0 = [ ... ]` (the archive's JS wrapper) or plain JSON, to the array. Throws on anything else. */
export function parseArchiveJs(text: string): unknown[] {
  const start = text.indexOf('[')
  if (start < 0) throw new Error('not an archive data file (no JSON array found)')
  const parsed: unknown = JSON.parse(text.slice(start))
  if (!Array.isArray(parsed)) throw new Error('not an archive data file (not an array)')
  return parsed
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The archive's `created_at` ("Wed Oct 28 18:32:12 +0000 2020") or an ISO date, to a UTC ISO string; null when unreadable. */
export function parseTweetDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/.exec(v.trim())
  if (m) {
    const mon = MONTHS.indexOf(m[1])
    if (mon < 0) return null
    const sign = m[6][0] === '-' ? -1 : 1
    const offMin = sign * (Number(m[6].slice(1, 3)) * 60 + Number(m[6].slice(3, 5)))
    const ms = Date.UTC(Number(m[7]), mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) - offMin * 60_000
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const LINK = /https?:\/\/[^\s"'<>)]+/g

/** Every link in one archived post: the expanded urls of its entities and any link left in the text. */
function tweetLinks(tw: Record<string, unknown>): string[] {
  const out: string[] = []
  const entities = isObj(tw.entities) ? tw.entities : null
  for (const u of Array.isArray(entities?.urls) ? (entities!.urls as unknown[]) : []) {
    if (!isObj(u)) continue
    for (const k of ['expanded_url', 'url', 'unwound_url']) if (typeof u[k] === 'string') out.push(u[k] as string)
  }
  const text = typeof tw.full_text === 'string' ? tw.full_text : typeof tw.text === 'string' ? tw.text : ''
  out.push(...(text.match(LINK) ?? []))
  return out
}

/**
 * Broadcast links in the archive's `tweets.js` entries (each `{ tweet: {...} }` or the tweet itself),
 * de-duplicated on the broadcast id across every link shape. The earliest post wins `postedAt`.
 */
export function discoverBroadcasts(tweets: unknown[]): BroadcastCandidate[] {
  const byId = new Map<string, BroadcastCandidate>()
  for (const entry of tweets) {
    const tw = isObj(entry) && isObj(entry.tweet) ? entry.tweet : isObj(entry) ? entry : null
    if (!tw) continue
    const postedAt = parseTweetDate(tw.created_at)
    for (const link of tweetLinks(tw)) {
      const id = broadcastIdFromUrl(link)
      if (!id) continue
      const prev = byId.get(id)
      if (!prev) byId.set(id, { externalId: id, key: broadcastKey(id), url: broadcastUrl(id), postedAt, origin: 'archive' })
      else if (postedAt && (!prev.postedAt || postedAt < prev.postedAt)) prev.postedAt = postedAt
    }
  }
  return [...byId.values()].sort((a, b) => (a.postedAt ?? '') < (b.postedAt ?? '') ? -1 : (a.postedAt ?? '') > (b.postedAt ?? '') ? 1 : a.externalId < b.externalId ? -1 : 1)
}

// ---- CSV (manifest and the manual file) ----

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF. Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

/** A cell that a spreadsheet could run as a formula is prefixed with an apostrophe. */
const safeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)
export const csvEscape = (v: string): string => {
  const s = safeCell(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const MANIFEST_COLUMNS = ['key', 'kind', 'url', 'external_id', 'started_at_utc', 'ended_at_utc', 'title', 'event_name', 'crew_id', 'source', 'include', 'notes'] as const
export type ManifestColumn = (typeof MANIFEST_COLUMNS)[number]
export type ManifestRow = Record<ManifestColumn, string>

export const DEFAULT_CREW_ID = 'community_call'

export function emptyManifestRow(): ManifestRow {
  return Object.fromEntries(MANIFEST_COLUMNS.map((c) => [c, ''])) as ManifestRow
}

export function manifestToCsv(rows: ManifestRow[]): string {
  return [MANIFEST_COLUMNS.join(','), ...rows.map((r) => MANIFEST_COLUMNS.map((c) => csvEscape(r[c] ?? '')).join(','))].join('\n') + '\n'
}

export function parseManifest(text: string): ManifestRow[] {
  const [head, ...body] = parseCsv(text)
  if (!head) return []
  const idx = new Map(head.map((h, i) => [h.trim().toLowerCase(), i]))
  if (!idx.has('key')) throw new Error('manifest has no "key" column')
  return body.map((cells) => {
    const r = emptyManifestRow()
    for (const c of MANIFEST_COLUMNS) {
      const i = idx.get(c)
      r[c] = i === undefined ? '' : (cells[i] ?? '').trim()
    }
    return r
  })
}

/**
 * The owner's manual CSV: any of the columns `url`, `external_id`, `started_at_utc`, `title`, `crew_id`, `include`
 * (header row required). A row needs a broadcast link or an id. Returns the rows it could use and the line numbers it could not.
 */
export function parseManualCsv(text: string): { rows: Array<{ candidate: BroadcastCandidate; startedAt: string; title: string; crewId: string; include: string }>; rejected: number[] } {
  const [head, ...body] = parseCsv(text)
  const rows: Array<{ candidate: BroadcastCandidate; startedAt: string; title: string; crewId: string; include: string }> = []
  const rejected: number[] = []
  if (!head) return { rows, rejected }
  const idx = new Map(head.map((h, i) => [h.trim().toLowerCase(), i]))
  const get = (cells: string[], name: string) => {
    const i = idx.get(name)
    return i === undefined ? '' : (cells[i] ?? '').trim()
  }
  body.forEach((cells, n) => {
    const id = broadcastIdFromUrl(get(cells, 'url')) ?? (new RegExp(`^${ID}$`).test(get(cells, 'external_id')) ? get(cells, 'external_id') : null)
    if (!id) {
      rejected.push(n + 2)
      return
    }
    const startedAt = get(cells, 'started_at_utc')
    const iso = startedAt ? parseTweetDate(startedAt) : null
    rows.push({
      candidate: { externalId: id, key: broadcastKey(id), url: broadcastUrl(id), postedAt: iso, origin: 'manual' },
      startedAt: iso ?? '',
      title: get(cells, 'title'),
      crewId: get(cells, 'crew_id') || DEFAULT_CREW_ID,
      include: get(cells, 'include'),
    })
  })
  return { rows, rejected }
}

/**
 * Merge discovered candidates and manual rows into manifest rows, keeping what an existing manifest already
 * says (the owner's include / title / crew edits are never overwritten). New rows start with include empty.
 */
export function buildManifest(existing: ManifestRow[], archive: BroadcastCandidate[], manual: ReturnType<typeof parseManualCsv>['rows']): ManifestRow[] {
  const byKey = new Map(existing.map((r) => [r.key, r]))
  const add = (c: BroadcastCandidate, extra: { startedAt?: string; title?: string; crewId?: string; include?: string }) => {
    const prev = byKey.get(c.key)
    if (prev) {
      // Fill gaps only.
      if (!prev.started_at_utc && (extra.startedAt || c.postedAt)) prev.started_at_utc = extra.startedAt || c.postedAt || ''
      if (!prev.title && extra.title) prev.title = extra.title
      return
    }
    const r = emptyManifestRow()
    r.key = c.key
    r.kind = 'broadcast'
    r.url = c.url
    r.external_id = c.externalId
    r.started_at_utc = extra.startedAt || c.postedAt || ''
    r.title = extra.title ?? ''
    r.crew_id = extra.crewId || DEFAULT_CREW_ID
    r.source = c.origin
    r.include = extra.include ?? ''
    byKey.set(c.key, r)
  }
  for (const c of archive) add(c, {})
  for (const m of manual) add(m.candidate, { startedAt: m.startedAt, title: m.title, crewId: m.crewId, include: m.include })
  return [...byKey.values()]
}
