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
 *
 * Members with no app account yet (no User row) get a PENDING grant instead:
 * the ItemGrant row is written (same grantKey, so still idempotent) but the
 * Inventory is not touched until they log in / finish onboarding, when
 * creditPendingItemGrants moves every PENDING grant into Inventory in one
 * transaction and marks it CREDITED (exactly once, even across parallel
 * logins). Same idea as PendingPepClaim, but on by default: set
 * ITEM_GRANT_CLAIMS=0 to pause the login credit.
 */
import { prisma } from './db'

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

export type GrantPlanStatus =
  | 'grant' // member has an app account: straight into Inventory
  | 'hold' // no app account yet: held PENDING, credited on first login/onboarding
  | 'already_granted' // same grant already in Inventory
  | 'already_held' // same grant already held PENDING
  | 'conflict'
  | 'unknown_item'
  | 'duplicate_in_csv'
  | 'not_carried_over' // owner decision: this UB item is dropped, never granted

export type GrantPlanRow = GrantRow & {
  itemId: number | null
  itemName: string | null
  isCollectible?: boolean
  grantKey: string | null
  status: GrantPlanStatus
  detail?: string
}

/** UnbelievaBoat items the owner decided NOT to carry over (normalized names). */
export const NOT_CARRIED_OVER = new Set(['chicken'])

export const grantKey = (source: string, discordId: string, itemId: number) => `${source}:${discordId}:${itemId}`

/** Decide what each CSV row would do. Read-only. */
export async function planGrants(rows: readonly GrantRow[], source = 'unbelievaboat'): Promise<GrantPlanRow[]> {
  // Inactive items and collectibles count too: holdings outlive the store.
  const items = await prisma.shopItem.findMany({ select: { id: true, name: true, isCollectible: true } })
  const byName = new Map(items.map((i) => [normalizeItemName(i.name), i]))
  const seen = new Set<string>()
  const keyed = rows.map((r) => {
    const item = byName.get(normalizeItemName(r.item)) ?? null
    return {
      ...r,
      itemId: item?.id ?? null,
      itemName: item?.name ?? null,
      isCollectible: item?.isCollectible ?? false,
      grantKey: item ? grantKey(source, r.discordId, item.id) : null,
    }
  })
  const keys = keyed.map((k) => k.grantKey).filter((k): k is string => !!k)
  const existing = new Map(
    (await prisma.itemGrant.findMany({ where: { grantKey: { in: keys } } })).map((g) => [g.grantKey, g]),
  )
  const ids = [...new Set(rows.map((r) => r.discordId))]
  const withAccount = new Set(
    (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id),
  )
  return keyed.map((r): GrantPlanRow => {
    if (NOT_CARRIED_OVER.has(normalizeItemName(r.item))) {
      return { ...r, grantKey: null, status: 'not_carried_over', detail: 'not carried over (owner decision); skipped' }
    }
    if (!r.grantKey) return { ...r, status: 'unknown_item', detail: `no shop item named "${r.item}"` }
    if (seen.has(r.grantKey)) return { ...r, status: 'duplicate_in_csv', detail: 'same member and item listed twice; merge the rows' }
    seen.add(r.grantKey)
    const prev = existing.get(r.grantKey)
    if (!prev) {
      return withAccount.has(r.discordId)
        ? { ...r, status: 'grant' }
        : { ...r, status: 'hold', detail: 'no app account yet' }
    }
    if (prev.quantity === r.qty) {
      return prev.status === 'PENDING'
        ? { ...r, status: 'already_held', detail: 'still held until they sign up' }
        : { ...r, status: 'already_granted' }
    }
    return { ...r, status: 'conflict', detail: `already granted ${prev.quantity}, CSV says ${r.qty}; fix by hand` }
  })
}

const TAG: Record<GrantPlanStatus, string> = {
  grant: '+',
  hold: '~',
  already_granted: '=',
  already_held: '=',
  conflict: '!',
  unknown_item: '?',
  duplicate_in_csv: '!',
  not_carried_over: '-',
}
const EFFECT: Partial<Record<GrantPlanStatus, string>> = {
  grant: 'GRANT NOW -> inventory',
  hold: 'HOLD PENDING -> credited on first login/onboarding',
}

/** Dry-run / apply report for grant-items.mjs: one line per row, then totals. */
export function formatGrantPlan(plan: readonly GrantPlanRow[]): string[] {
  const count = (s: GrantPlanStatus) => plan.filter((p) => p.status === s).length
  const lines = plan.map((p) => {
    const what = `${p.discordId}  ${p.qty} x ${p.itemName ?? p.item}${p.isCollectible ? ' (collectible)' : ''}`
    const effect = EFFECT[p.status] ? `  ${EFFECT[p.status]}` : ''
    return `  ${TAG[p.status]} line ${p.line}: ${what}  [${p.status}]${effect}${p.detail ? '  (' + p.detail + ')' : ''}`
  })
  lines.push(
    '',
    `Grant now: ${count('grant')}  hold pending signup: ${count('hold')}` +
      `  already granted: ${count('already_granted')}  already held: ${count('already_held')}` +
      `  conflicts: ${count('conflict')}  unknown items: ${count('unknown_item')}  duplicates: ${count('duplicate_in_csv')}` +
      `  not carried over: ${count('not_carried_over')}`,
  )
  return lines
}

/**
 * Apply one planned grant ('grant' or 'hold'). Whether it goes into Inventory
 * now or is held PENDING is decided again inside the transaction (the member
 * may have signed up since the plan was made). Returns 'credited' or 'held',
 * or false if it was already granted (race or re-run).
 */
export async function applyGrant(row: GrantPlanRow, source = 'unbelievaboat', note?: string): Promise<'credited' | 'held' | false> {
  if ((row.status !== 'grant' && row.status !== 'hold') || !row.grantKey || row.itemId == null) return false
  const itemId = row.itemId
  return prisma.$transaction(async (tx) => {
    const hasAccount = !!(await tx.user.findUnique({ where: { id: row.discordId }, select: { id: true } }))
    const ins = await tx.itemGrant.createMany({
      data: [
        {
          grantKey: row.grantKey!,
          source,
          discordId: row.discordId,
          itemId,
          quantity: row.qty,
          note: note ?? null,
          status: hasAccount ? 'CREDITED' : 'PENDING',
          creditedAt: hasAccount ? new Date() : null,
        },
      ],
      skipDuplicates: true,
    })
    if (ins.count !== 1) return false
    if (!hasAccount) return 'held' as const
    await tx.inventory.upsert({
      where: { userId_itemId: { userId: row.discordId, itemId } },
      create: { userId: row.discordId, itemId, quantity: row.qty },
      update: { quantity: { increment: row.qty } },
    })
    return 'credited' as const
  })
}

export interface CreditedItemGrants {
  credited: number
  items: Array<{ grantKey: string; itemId: number; quantity: number }>
}

/**
 * Move every PENDING item grant for this member into Inventory, in one
 * transaction. Each grant is claimed with a conditional PENDING -> CREDITED
 * update, so parallel logins (or a login racing onboarding) credit it exactly
 * once: the loser's update waits on the row lock, then matches nothing.
 * Grants are claimed in id order, so concurrent callers can't deadlock.
 */
export async function creditPendingItemGrants(discordId: string): Promise<CreditedItemGrants> {
  if (!discordId) return { credited: 0, items: [] }
  // Cheap pre-check: almost every login has nothing held.
  if ((await prisma.itemGrant.count({ where: { discordId, status: 'PENDING' } })) === 0) return { credited: 0, items: [] }
  return prisma.$transaction(async (tx) => {
    const pending = await tx.itemGrant.findMany({ where: { discordId, status: 'PENDING' }, orderBy: { id: 'asc' } })
    const out: CreditedItemGrants = { credited: 0, items: [] }
    for (const g of pending) {
      const won = await tx.itemGrant.updateMany({
        where: { id: g.id, status: 'PENDING' },
        data: { status: 'CREDITED', creditedAt: new Date() },
      })
      if (won.count !== 1) continue
      await tx.inventory.upsert({
        where: { userId_itemId: { userId: discordId, itemId: g.itemId } },
        create: { userId: discordId, itemId: g.itemId, quantity: g.quantity },
        update: { quantity: { increment: g.quantity } },
      })
      out.credited++
      out.items.push({ grantKey: g.grantKey, itemId: g.itemId, quantity: g.quantity })
    }
    return out
  })
}

/** On unless ITEM_GRANT_CLAIMS=0 (independent of PEP_MIGRATION_CLAIMS). */
export const itemGrantClaimsEnabled = () => process.env.ITEM_GRANT_CLAIMS !== '0'

/**
 * Login / onboarding hook: credit held item grants. Never throws; a failure
 * (e.g. the migration isn't deployed yet) is logged and the next login retries.
 */
export async function creditPendingItemGrantsOnLogin(discordId: string): Promise<void> {
  if (!itemGrantClaimsEnabled() || !discordId) return
  try {
    const r = await creditPendingItemGrants(discordId)
    if (r.credited) console.log(`[item-grants] credited ${r.credited} held item grant(s) to ${discordId}`)
  } catch (err) {
    console.error('[item-grants] login credit failed (non-blocking):', err)
  }
}
