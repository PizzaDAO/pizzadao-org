/**
 * UnbelievaBoat export snapshots: a normalized, checksummed record of every
 * user's UB balance at freeze time. Written as JSON (source of truth) + CSV
 * (human review) + a manifest holding sha256 of both and, when a signing key
 * is provided, an HMAC-SHA256 signature for the audit trail.
 *
 * Pure functions only (no network, no DB, no fs) so they are unit-testable.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { UbInventoryItem, UbStoreItem, UbUserBalance } from './ub-api'

export const SNAPSHOT_VERSION = 1

export interface SnapshotUser {
  discordId: string
  rank: number | null
  /** Integers as decimal strings so values beyond 2^53 or "Infinity" survive JSON round-trips. */
  cash: string
  bank: string
  total: string
  /** Optional Discord annotations (export --resolve-discord). */
  username?: string | null
  bot?: boolean | null
  inGuild?: boolean | null
  inventory?: Array<{ itemId: string; name: string; quantity: number }>
}

export interface Snapshot {
  version: number
  source: 'unbelievaboat'
  guildId: string
  exportedAt: string
  apiBase: string
  pages: number
  users: SnapshotUser[]
  storeItems?: Array<{ id: string; name: string; price: string; stockRemaining: number | null }>
  totals: { users: number; cash: string; bank: string; total: string }
}

export interface SnapshotManifest {
  version: number
  guildId: string
  exportedAt: string
  users: number
  totals: Snapshot['totals']
  jsonSha256: string
  csvSha256: string
  /** HMAC-SHA256(jsonSha256 + "\n" + csvSha256, key), hex. null when unsigned. */
  hmacSha256: string | null
}

/** Parse an API number/string into a canonical integer string, or a non-finite marker. */
export function normalizeAmount(v: unknown): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : v < 0 ? '-Infinity' : 'NaN'
    return BigInt(Math.trunc(v)).toString()
  }
  if (typeof v === 'bigint') return v.toString()
  const s = String(v ?? '0').trim()
  if (s === '') return '0'
  if (/^-?\d+$/.test(s)) return BigInt(s).toString()
  if (/^-?\d+\.\d+$/.test(s)) return BigInt(s.split('.')[0]).toString()
  if (/^\+?infinity$/i.test(s)) return 'Infinity'
  if (/^-infinity$/i.test(s)) return '-Infinity'
  return 'NaN'
}

export function isFiniteAmount(s: string): boolean {
  return /^-?\d+$/.test(s)
}

function sumAmounts(values: string[]): string {
  let acc = BigInt(0)
  for (const v of values) if (isFiniteAmount(v)) acc += BigInt(v)
  return acc.toString()
}

export function computeTotals(users: SnapshotUser[]): Snapshot['totals'] {
  return {
    users: users.length,
    cash: sumAmounts(users.map((u) => u.cash)),
    bank: sumAmounts(users.map((u) => u.bank)),
    total: sumAmounts(users.map((u) => u.total)),
  }
}

export function buildSnapshot(input: {
  guildId: string
  users: UbUserBalance[]
  pages: number
  exportedAt?: Date
  apiBase: string
  storeItems?: UbStoreItem[]
  inventories?: Map<string, UbInventoryItem[]>
  discord?: Map<string, { username?: string | null; bot?: boolean | null; inGuild?: boolean | null }>
}): Snapshot {
  const users: SnapshotUser[] = input.users
    .map((u) => {
      const cash = normalizeAmount(u.cash)
      const bank = normalizeAmount(u.bank)
      // Recompute total when both parts are finite; keep the API's value otherwise.
      const total =
        isFiniteAmount(cash) && isFiniteAmount(bank)
          ? (BigInt(cash) + BigInt(bank)).toString()
          : normalizeAmount(u.total)
      const rank = u.rank == null || u.rank === '' ? null : Number(u.rank)
      const row: SnapshotUser = {
        discordId: String(u.user_id),
        rank: Number.isFinite(rank) ? rank : null,
        cash,
        bank,
        total,
      }
      const d = input.discord?.get(row.discordId)
      if (d) {
        row.username = d.username ?? null
        row.bot = d.bot ?? null
        row.inGuild = d.inGuild ?? null
      }
      const inv = input.inventories?.get(row.discordId)
      if (inv) row.inventory = inv.map((i) => ({ itemId: String(i.item_id), name: i.name, quantity: Number(i.quantity) }))
      return row
    })
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.discordId.localeCompare(b.discordId))

  return {
    version: SNAPSHOT_VERSION,
    source: 'unbelievaboat',
    guildId: input.guildId,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    apiBase: input.apiBase,
    pages: input.pages,
    users,
    ...(input.storeItems
      ? {
          storeItems: input.storeItems.map((s) => ({
            id: String(s.id),
            name: s.name,
            price: normalizeAmount(s.price ?? 0),
            stockRemaining: s.stock_remaining ?? null,
          })),
        }
      : {}),
    totals: computeTotals(users),
  }
}

/** Stable JSON text: the bytes that get hashed and written to disk. */
export function snapshotToJson(s: Snapshot): string {
  return JSON.stringify(s, null, 2) + '\n'
}

const CSV_HEADER = ['discord_id', 'rank', 'cash', 'bank', 'total', 'username', 'bot', 'in_guild', 'inventory']

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function snapshotToCsv(s: Snapshot): string {
  const lines = [CSV_HEADER.join(',')]
  for (const u of s.users) {
    lines.push(
      [
        u.discordId,
        u.rank ?? '',
        u.cash,
        u.bank,
        u.total,
        u.username ?? '',
        u.bot == null ? '' : String(u.bot),
        u.inGuild == null ? '' : String(u.inGuild),
        u.inventory?.length ? u.inventory.map((i) => `${i.name} x${i.quantity}`).join('; ') : '',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\n') + '\n'
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let quoted = false
  while (i < text.length) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      quoted = true
      i++
    } else if (c === ',') {
      row.push(field)
      field = ''
      i++
    } else if (c === '\n' || c === '\r') {
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += c
      i++
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Build a Snapshot from a CSV with at least discord_id/user_id plus
 * cash/bank (or total) columns. Used when the owner exports from the UB
 * dashboard instead of the API, or edits a review copy.
 */
export function snapshotFromCsv(text: string, meta: { guildId: string; exportedAt?: string }): Snapshot {
  const [header, ...rows] = parseCsv(text)
  if (!header) throw new Error('CSV is empty')
  const h = header.map((x) => x.trim().toLowerCase().replace(/\s+/g, '_'))
  const col = (...names: string[]) => names.map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1
  const iId = col('discord_id', 'user_id', 'discordid', 'id')
  const iRank = col('rank')
  const iCash = col('cash')
  const iBank = col('bank')
  const iTotal = col('total')
  if (iId < 0) throw new Error('CSV needs a discord_id (or user_id) column')
  if (iCash < 0 && iBank < 0 && iTotal < 0) throw new Error('CSV needs cash/bank or total columns')
  const users: UbUserBalance[] = rows.map((r) => {
    const cash = iCash >= 0 ? r[iCash] : '0'
    const bank = iBank >= 0 ? r[iBank] : iCash < 0 && iTotal >= 0 ? r[iTotal] : '0'
    return { user_id: r[iId].trim(), rank: iRank >= 0 ? r[iRank] : null, cash, bank, total: iTotal >= 0 ? r[iTotal] : '0' }
  })
  return buildSnapshot({
    guildId: meta.guildId,
    users,
    pages: 0,
    exportedAt: meta.exportedAt ? new Date(meta.exportedAt) : new Date(),
    apiBase: 'csv',
  })
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function buildManifest(s: Snapshot, jsonText: string, csvText: string, signingKey?: string | null): SnapshotManifest {
  const jsonSha256 = sha256Hex(jsonText)
  const csvSha256 = sha256Hex(csvText)
  return {
    version: SNAPSHOT_VERSION,
    guildId: s.guildId,
    exportedAt: s.exportedAt,
    users: s.users.length,
    totals: s.totals,
    jsonSha256,
    csvSha256,
    hmacSha256: signingKey ? createHmac('sha256', signingKey).update(`${jsonSha256}\n${csvSha256}`).digest('hex') : null,
  }
}

export interface VerifyResult {
  ok: boolean
  errors: string[]
  signed: boolean
}

/** Check file hashes (and HMAC if a key is given) against a manifest. */
export function verifyManifest(
  manifest: SnapshotManifest,
  jsonText: string,
  csvText: string | null,
  signingKey?: string | null,
): VerifyResult {
  const errors: string[] = []
  if (sha256Hex(jsonText) !== manifest.jsonSha256) errors.push('snapshot JSON sha256 does not match manifest')
  if (csvText !== null && sha256Hex(csvText) !== manifest.csvSha256) errors.push('snapshot CSV sha256 does not match manifest')
  if (signingKey) {
    if (!manifest.hmacSha256) errors.push('manifest is unsigned but a signing key was provided')
    else {
      const expected = createHmac('sha256', signingKey).update(`${manifest.jsonSha256}\n${manifest.csvSha256}`).digest()
      const got = Buffer.from(manifest.hmacSha256, 'hex')
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) errors.push('manifest HMAC signature is invalid')
    }
  }
  return { ok: errors.length === 0, errors, signed: !!manifest.hmacSha256 }
}

/** Validate a parsed snapshot's shape and that its stored totals add up. */
export function validateSnapshot(s: unknown): Snapshot {
  const snap = s as Snapshot
  if (!snap || typeof snap !== 'object') throw new Error('snapshot is not an object')
  if (snap.source !== 'unbelievaboat') throw new Error('snapshot.source must be "unbelievaboat"')
  if (snap.version !== SNAPSHOT_VERSION) throw new Error(`unsupported snapshot version ${snap.version}`)
  if (!/^\d{5,25}$/.test(String(snap.guildId))) throw new Error('snapshot.guildId is not a Discord snowflake')
  if (!Array.isArray(snap.users)) throw new Error('snapshot.users must be an array')
  const seen = new Set<string>()
  for (const u of snap.users) {
    if (!/^\d{5,25}$/.test(u.discordId)) throw new Error(`invalid discordId ${JSON.stringify(u.discordId)}`)
    if (seen.has(u.discordId)) throw new Error(`duplicate discordId ${u.discordId}`)
    seen.add(u.discordId)
  }
  const t = computeTotals(snap.users)
  if (t.cash !== snap.totals.cash || t.bank !== snap.totals.bank || t.total !== snap.totals.total || t.users !== snap.totals.users) {
    throw new Error('snapshot totals do not match its rows (file edited?)')
  }
  return snap
}
