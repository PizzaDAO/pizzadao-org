/**
 * Duplicate-account signals (plans/mission-verification.md §6.2).
 *
 * The economic unit is the discordId, so one person with two Discord accounts
 * could earn every level twice. These signals surface the likely cases to the
 * reviewers. They are FLAGS ONLY: nothing is blocked, held or revoked (D17),
 * and a signal that no longer holds is removed on the next run.
 *
 *   shared_wallet     one wallet address linked to more than one member
 *   shared_x          one X handle on more than one Discord account
 *                     (XAccount.xId itself is unique; handles can be re-used)
 *   shared_telegram   one Telegram username on more than one Discord account
 *   shared_member_id  one members-sheet ID linked to more than one Discord
 *                     account (via X, Telegram, wallets or missions)
 *   sheet_duplicate   one Discord id on more than one members-sheet row
 *                     (the sheet index silently keeps only the last row)
 *
 * Discord account age (< 30 days) is not a signal: it is already a release
 * hold (D9, policy.ts).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { getMembersSheet, membersColumn, memberIdColumn, cellText, MEMBER_COLUMNS } from '../sheets/member-repository'

export type SignalKind = 'shared_wallet' | 'shared_x' | 'shared_telegram' | 'shared_member_id' | 'sheet_duplicate'

export interface AccountSignalData {
  kind: SignalKind
  key: string
  discordIds: string[]
  memberIds: string[]
  detail?: Record<string, unknown>
}

export interface SignalInputs {
  wallets: Array<{ discordId: string | null; memberId: string; walletAddress: string; chainType?: string | null }>
  xAccounts: Array<{ discordId: string; memberId: string | null; xUsername: string }>
  telegram: Array<{ discordId: string; memberId: string | null; username: string | null }>
  completions: Array<{ discordId: string; memberId: string | null }>
  /** One entry per members-sheet row that has a Discord id. */
  sheetRows: Array<{ discordId: string; memberId: string }>
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  shared_wallet: 'Shares a wallet with',
  shared_x: 'Same X handle as',
  shared_telegram: 'Same Telegram username as',
  shared_member_id: 'Same member ID as',
  sheet_duplicate: 'On more than one members-sheet row',
}

const sorted = (s: Iterable<string>) => [...new Set(s)].filter(Boolean).sort()

/** Pure: compute every signal from the raw rows. */
export function computeSignals(input: SignalInputs): AccountSignalData[] {
  const out: AccountSignalData[] = []
  // memberId -> discordIds, from the sheet first (wallet rows often lack a discordId).
  const sheetDiscord = new Map<string, string>()
  for (const r of input.sheetRows) sheetDiscord.set(r.memberId, r.discordId)

  // shared_wallet: one address (EVM case-insensitive) across members.
  const byWallet = new Map<string, { discordIds: Set<string>; memberIds: Set<string> }>()
  for (const w of input.wallets) {
    const addr = w.walletAddress.trim()
    if (!addr) continue
    const key = (w.chainType ?? 'evm') === 'evm' || addr.startsWith('0x') ? addr.toLowerCase() : addr
    const g = byWallet.get(key) ?? { discordIds: new Set(), memberIds: new Set() }
    g.memberIds.add(w.memberId)
    const d = w.discordId ?? sheetDiscord.get(w.memberId)
    if (d) g.discordIds.add(d)
    byWallet.set(key, g)
  }
  for (const [key, g] of byWallet) {
    if (g.memberIds.size > 1 || g.discordIds.size > 1) {
      out.push({ kind: 'shared_wallet', key, discordIds: sorted(g.discordIds), memberIds: sorted(g.memberIds) })
    }
  }

  // shared_x / shared_telegram: the same handle on several Discord accounts.
  const byHandle = (kind: SignalKind, rows: Array<{ discordId: string; memberId: string | null; handle: string | null }>) => {
    const m = new Map<string, { discordIds: Set<string>; memberIds: Set<string> }>()
    for (const r of rows) {
      const h = r.handle?.trim().replace(/^@/, '').toLowerCase()
      if (!h) continue
      const g = m.get(h) ?? { discordIds: new Set(), memberIds: new Set() }
      g.discordIds.add(r.discordId)
      if (r.memberId) g.memberIds.add(r.memberId)
      m.set(h, g)
    }
    for (const [key, g] of m) {
      if (g.discordIds.size > 1) out.push({ kind, key, discordIds: sorted(g.discordIds), memberIds: sorted(g.memberIds) })
    }
  }
  byHandle('shared_x', input.xAccounts.map((r) => ({ discordId: r.discordId, memberId: r.memberId, handle: r.xUsername })))
  byHandle('shared_telegram', input.telegram.map((r) => ({ discordId: r.discordId, memberId: r.memberId, handle: r.username })))

  // shared_member_id: one members-sheet ID used by several Discord accounts.
  const byMember = new Map<string, { discordIds: Set<string>; via: Set<string> }>()
  const link = (memberId: string | null | undefined, discordId: string | null | undefined, via: string) => {
    if (!memberId || !discordId) return
    const g = byMember.get(memberId) ?? { discordIds: new Set(), via: new Set() }
    g.discordIds.add(discordId)
    g.via.add(via)
    byMember.set(memberId, g)
  }
  for (const r of input.xAccounts) link(r.memberId, r.discordId, 'x')
  for (const r of input.telegram) link(r.memberId, r.discordId, 'telegram')
  for (const r of input.wallets) link(r.memberId, r.discordId, 'wallet')
  for (const r of input.completions) link(r.memberId, r.discordId, 'missions')
  for (const r of input.sheetRows) link(r.memberId, r.discordId, 'sheet')
  for (const [key, g] of byMember) {
    if (g.discordIds.size > 1) {
      out.push({ kind: 'shared_member_id', key, discordIds: sorted(g.discordIds), memberIds: [key], detail: { via: sorted(g.via) } })
    }
  }

  // sheet_duplicate: one Discord id on several members-sheet rows.
  const byDiscord = new Map<string, Set<string>>()
  for (const r of input.sheetRows) byDiscord.set(r.discordId, (byDiscord.get(r.discordId) ?? new Set()).add(r.memberId))
  for (const [key, members] of byDiscord) {
    if (members.size > 1) out.push({ kind: 'sheet_duplicate', key, discordIds: [key], memberIds: sorted(members) })
  }

  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))
}

/** Read the inputs. A members sheet that can't be read just yields no sheet-based signals. */
export async function collectSignalInputs(): Promise<SignalInputs & { sheetOk: boolean }> {
  const [wallets, xAccounts, telegram, completions] = await Promise.all([
    prisma.memberWallet.findMany({ select: { discordId: true, memberId: true, walletAddress: true, chainType: true } }),
    prisma.xAccount.findMany({ select: { discordId: true, memberId: true, xUsername: true } }),
    prisma.telegramAccount.findMany({ select: { discordId: true, memberId: true, username: true } }),
    prisma.missionCompletion.findMany({ where: { memberId: { not: null } }, select: { discordId: true, memberId: true }, distinct: ['discordId', 'memberId'] }),
  ])
  let sheetRows: SignalInputs['sheetRows'] = []
  let sheetOk = false
  try {
    const table = await getMembersSheet()
    const idIdx = memberIdColumn(table)
    const dIdx = membersColumn(table, MEMBER_COLUMNS.discordId)
    if (dIdx !== null) {
      sheetRows = table.rows
        .map((r) => ({ memberId: cellText(r?.c?.[idIdx]), discordId: cellText(r?.c?.[dIdx]) }))
        .filter((r) => r.memberId && /^\d{15,25}$/.test(r.discordId))
      sheetOk = true
    }
  } catch (e) {
    console.warn('[missions] members sheet unavailable for duplicate signals:', e)
  }
  return { wallets, xAccounts, telegram, completions, sheetRows, sheetOk }
}

/**
 * Replace the stored signals with `signals`: upsert the current ones (keeping
 * firstSeenAt), delete those that no longer hold. When the sheet couldn't be
 * read, the sheet-based kinds are left as they are rather than deleted.
 */
export async function syncSignals(signals: AccountSignalData[], opts: { keepKinds?: SignalKind[]; now?: Date } = {}) {
  const now = opts.now ?? new Date()
  const keep = new Set(opts.keepKinds ?? [])
  let created = 0
  for (const s of signals) {
    const existing = await prisma.accountSignal.findUnique({ where: { kind_key: { kind: s.kind, key: s.key } }, select: { id: true } })
    const data = {
      discordIds: s.discordIds,
      memberIds: s.memberIds,
      detail: s.detail ? (s.detail as Prisma.InputJsonValue) : Prisma.DbNull,
      lastSeenAt: now,
    }
    await prisma.accountSignal.upsert({
      where: { kind_key: { kind: s.kind, key: s.key } },
      create: { kind: s.kind, key: s.key, ...data, firstSeenAt: now },
      update: data,
    })
    if (!existing) created++
  }
  const removed = await prisma.accountSignal.deleteMany({
    where: { lastSeenAt: { lt: now }, ...(keep.size ? { kind: { notIn: [...keep] } } : {}) },
  })
  return { total: signals.length, created, removed: removed.count }
}

/** The signals that mention any of these Discord ids (review panel). */
export async function signalsFor(discordIds: string[]): Promise<Map<string, AccountSignalData[]>> {
  const map = new Map<string, AccountSignalData[]>()
  if (!discordIds.length) return map
  const rows = await prisma.accountSignal.findMany({ where: { discordIds: { hasSome: discordIds } }, orderBy: { kind: 'asc' } })
  for (const r of rows) {
    const s: AccountSignalData = {
      kind: r.kind as SignalKind,
      key: r.key,
      discordIds: r.discordIds,
      memberIds: r.memberIds,
      ...(r.detail && typeof r.detail === 'object' && !Array.isArray(r.detail) ? { detail: r.detail as Record<string, unknown> } : {}),
    }
    for (const d of r.discordIds) if (discordIds.includes(d)) map.set(d, [...(map.get(d) ?? []), s])
  }
  return map
}

/** Compute and store the signals (nightly run). Never throws. */
export async function refreshSignals(now = new Date()): Promise<{ total: number; created: number; removed: number; byKind: Record<string, number> } | { error: string }> {
  try {
    const input = await collectSignalInputs()
    const signals = computeSignals(input)
    const res = await syncSignals(signals, { now, keepKinds: input.sheetOk ? [] : ['sheet_duplicate'] })
    const byKind: Record<string, number> = {}
    for (const s of signals) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1
    return { ...res, byKind }
  } catch (e) {
    console.error('[missions] duplicate-account signals failed:', e)
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
