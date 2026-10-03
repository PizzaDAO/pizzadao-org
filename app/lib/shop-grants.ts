/**
 * Manual item grants: carry UnbelievaBoat store holdings into Inventory.
 * There's no UB token (owner decision), so holdings can't be exported; staff
 * enter them by hand in a CSV (discordId,item,qty) and run
 * scripts/unbelievaboat/grant-items.mjs.
 *
 * Idempotent: each (source, discordId, item) is granted once, keyed by
 * ItemGrant.grantKey. The ItemGrant insert and the Inventory increment commit
 * together, so re-running the CSV (or running it twice at once) can't
 * double-grant. A changed qty for an already granted row is reported as a
 * conflict, never applied. Grants don't touch shop stock or any wallet.
 */
import { prisma } from './db'

/** The four UnbelievaBoat store items (plan §2.3). Prices in PEP. */
export const UB_STORE_ITEMS: ReadonlyArray<{ name: string; price: number; description: string; limited?: boolean }> = [
  { name: 'Global Pizza Party T-shirt', price: 20_240, description: 'Official Global Pizza Party tee.' },
  { name: 'Proof of Pizza', price: 13_370, description: 'Proof you were there for the pizza.' },
  { name: 'Rare Pizza Box', price: 42_069, description: 'A rare PizzaDAO pizza box. Limited stock.', limited: true },
  { name: 'Pizza Sticks', price: 1_337, description: 'Pizza Sticks.' },
]

export const normalizeItemName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface GrantRow {
  line: number
  discordId: string
  item: string
  qty: number
}

/** One CSV line -> trimmed cells. Supports "quoted, cells" and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

/** Parse `discordId,item,qty` (header row optional, # comments allowed). */
export function parseGrantCsv(text: string): { rows: GrantRow[]; errors: string[] } {
  const rows: GrantRow[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const t = raw.trim()
    if (!t || t.startsWith('#')) return
    const cells = splitCsvLine(t)
    if (cells.length !== 3) {
      errors.push(`line ${line}: expected 3 columns (discordId,item,qty)`)
      return
    }
    const [discordId, item, qtyRaw] = cells
    if (line === 1 && /discord/i.test(discordId) && /^q/i.test(qtyRaw)) return // header
    const qty = Number(qtyRaw)
    if (!/^\d{5,25}$/.test(discordId)) errors.push(`line ${line}: bad discordId "${discordId}"`)
    else if (!item) errors.push(`line ${line}: empty item`)
    else if (!Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) errors.push(`line ${line}: qty must be a positive whole number`)
    else rows.push({ line, discordId, item, qty })
  })
  return { rows, errors }
}

export type GrantPlanRow = GrantRow & {
  itemId: number | null
  itemName: string | null
  grantKey: string | null
  status: 'grant' | 'already_granted' | 'conflict' | 'unknown_item' | 'duplicate_in_csv'
  detail?: string
}

export const grantKey = (source: string, discordId: string, itemId: number) => `${source}:${discordId}:${itemId}`

/** Decide what each CSV row would do. Read-only. */
export async function planGrants(rows: readonly GrantRow[], source = 'unbelievaboat'): Promise<GrantPlanRow[]> {
  const items = await prisma.shopItem.findMany({ select: { id: true, name: true } })
  const byName = new Map(items.map((i) => [normalizeItemName(i.name), i]))
  const seen = new Set<string>()
  const keyed = rows.map((r) => {
    const item = byName.get(normalizeItemName(r.item)) ?? null
    return { ...r, itemId: item?.id ?? null, itemName: item?.name ?? null, grantKey: item ? grantKey(source, r.discordId, item.id) : null }
  })
  const keys = keyed.map((k) => k.grantKey).filter((k): k is string => !!k)
  const existing = new Map(
    (await prisma.itemGrant.findMany({ where: { grantKey: { in: keys } } })).map((g) => [g.grantKey, g]),
  )
  return keyed.map((r): GrantPlanRow => {
    if (!r.grantKey) return { ...r, status: 'unknown_item', detail: `no shop item named "${r.item}"` }
    if (seen.has(r.grantKey)) return { ...r, status: 'duplicate_in_csv', detail: 'same member and item listed twice; merge the rows' }
    seen.add(r.grantKey)
    const prev = existing.get(r.grantKey)
    if (!prev) return { ...r, status: 'grant' }
    if (prev.quantity === r.qty) return { ...r, status: 'already_granted' }
    return { ...r, status: 'conflict', detail: `already granted ${prev.quantity}, CSV says ${r.qty}; fix by hand` }
  })
}

/** Apply one planned grant. Returns false if it was already granted (race or re-run). */
export async function applyGrant(row: GrantPlanRow, source = 'unbelievaboat', note?: string): Promise<boolean> {
  if (row.status !== 'grant' || !row.grantKey || row.itemId == null) return false
  const itemId = row.itemId
  return prisma.$transaction(async (tx) => {
    const ins = await tx.itemGrant.createMany({
      data: [{ grantKey: row.grantKey!, source, discordId: row.discordId, itemId, quantity: row.qty, note: note ?? null }],
      skipDuplicates: true,
    })
    if (ins.count !== 1) return false
    await tx.inventory.upsert({
      where: { userId_itemId: { userId: row.discordId, itemId } },
      create: { userId: row.discordId, itemId, quantity: row.qty },
      update: { quantity: { increment: row.qty } },
    })
    return true
  })
}
