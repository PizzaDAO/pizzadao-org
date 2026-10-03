/**
 * Backfill report math (plans/mission-verification.md §7, decision D7).
 * Used by scripts/missions/backfill.mjs; pure, so it is unit tested.
 *
 * From the per-member dry-run outcomes of checkMany() it builds:
 *   - one CSV row per thing that would happen: a mission newly approved
 *     ("approve"), held for a human release ("hold": L6+, account < 30 days),
 *     a human rejection reopened for review ("reopen", PREVIOUSLY_REJECTED),
 *     a level paid ("pay", with its PEP), an approved role mission that would
 *     be flagged ("flag"), and grandfathered no-proof 'auto' approvals the new
 *     verifier would fail ("legacy_auto_would_fail", information only, D6);
 *   - per-mission and per-level totals, the grand total PEP and the top
 *     recipients.
 *
 * The grand total is what `--apply --confirm-total <PEP>` must repeat.
 */
import type { MemberOutcome, MissionCatalog } from './bulk'

export type BackfillAction = 'approve' | 'hold' | 'reopen' | 'pay' | 'flag' | 'legacy_auto_would_fail'

export interface BackfillRow {
  discordId: string
  memberId: string
  action: BackfillAction
  level: number
  mission: string
  missionId: number | ''
  holdReason: string
  pep: number
  detail: string
}

export interface BackfillSummary {
  members: number
  membersWithChanges: number
  /** Members with something to apply (approve / hold / reopen / pay / flag), in discordId order. */
  applyMembers: string[]
  perMission: Array<{ missionId: number; level: number; index: number; title: string; approve: number; hold: number; reopen: number; flag: number; legacyWouldFail: number }>
  perLevel: Array<{ level: number; members: number; reward: number; pep: number }>
  held: { HIGH_LEVEL: number; NEW_ACCOUNT: number; PREVIOUSLY_REJECTED: number }
  totalPep: number
  top: Array<{ discordId: string; memberId: string; levels: number[]; pep: number }>
  errors: string[]
}

export function backfillRows(outcomes: readonly MemberOutcome[], catalog: MissionCatalog): BackfillRow[] {
  const rows: BackfillRow[] = []
  const title = (id: number) => catalog.byId.get(id)?.title ?? `mission ${id}`
  const level = (id: number) => catalog.byId.get(id)?.level ?? 0
  for (const o of outcomes) {
    const base = { discordId: o.discordId, memberId: o.memberId ?? '' }
    const r = o.report
    if (r) {
      for (const c of r.checks) {
        const detail = c.result.status === 'pass' ? JSON.stringify(c.result.evidence) : ''
        const row = { ...base, level: c.level, mission: c.title, missionId: c.missionId, pep: 0, detail }
        if (c.outcome === 'would_approve') rows.push({ ...row, action: 'approve', holdReason: '' })
        else if (c.outcome === 'would_hold') rows.push({ ...row, action: 'hold', holdReason: c.holdReason ?? '' })
        else if (c.outcome === 'rejected' && c.result.status === 'pass') rows.push({ ...row, action: 'reopen', holdReason: 'PREVIOUSLY_REJECTED' })
      }
      for (const id of r.wouldFlag) {
        const c = r.checks.find((x) => x.missionId === id)
        rows.push({ ...base, action: 'flag', level: level(id), mission: title(id), missionId: id, holdReason: '', pep: 0, detail: c && c.result.status === 'fail' ? c.result.reason : '' })
      }
    }
    for (const p of o.payouts) {
      rows.push({ ...base, action: 'pay', level: p.level, mission: '', missionId: '', holdReason: '', pep: p.reward, detail: '' })
    }
    for (const l of o.legacyWouldFail) {
      rows.push({ ...base, action: 'legacy_auto_would_fail', level: level(l.missionId), mission: title(l.missionId), missionId: l.missionId, holdReason: '', pep: 0, detail: l.reason })
    }
  }
  return rows
}

export function summarizeBackfill(outcomes: readonly MemberOutcome[], catalog: MissionCatalog, topN = 20): BackfillSummary {
  const rows = backfillRows(outcomes, catalog)
  const perMission = new Map<number, BackfillSummary['perMission'][number]>()
  for (const m of catalog.verifierMissions) {
    perMission.set(m.id, { missionId: m.id, level: m.level, index: m.index, title: m.title, approve: 0, hold: 0, reopen: 0, flag: 0, legacyWouldFail: 0 })
  }
  const perLevel = new Map<number, { level: number; members: number; reward: number; pep: number }>()
  const held = { HIGH_LEVEL: 0, NEW_ACCOUNT: 0, PREVIOUSLY_REJECTED: 0 }
  const byMember = new Map<string, { discordId: string; memberId: string; levels: number[]; pep: number }>()
  const changed = new Set<string>()
  const apply = new Set<string>()

  for (const r of rows) {
    changed.add(r.discordId)
    if (r.action !== 'legacy_auto_would_fail') apply.add(r.discordId)
    if (typeof r.missionId === 'number') {
      const pm = perMission.get(r.missionId)
      if (pm) {
        if (r.action === 'approve') pm.approve++
        if (r.action === 'hold') pm.hold++
        if (r.action === 'reopen') pm.reopen++
        if (r.action === 'flag') pm.flag++
        if (r.action === 'legacy_auto_would_fail') pm.legacyWouldFail++
      }
    }
    if (r.action === 'hold' || r.action === 'reopen') {
      if (r.holdReason in held) held[r.holdReason as keyof typeof held]++
    }
    if (r.action === 'pay') {
      const pl = perLevel.get(r.level) ?? { level: r.level, members: 0, reward: r.pep, pep: 0 }
      pl.members++
      pl.pep += r.pep
      perLevel.set(r.level, pl)
      const m = byMember.get(r.discordId) ?? { discordId: r.discordId, memberId: r.memberId, levels: [], pep: 0 }
      m.levels.push(r.level)
      m.pep += r.pep
      byMember.set(r.discordId, m)
    }
  }

  const errors: string[] = []
  for (const o of outcomes) {
    if (o.error) errors.push(`${o.discordId}: ${o.error}`)
    for (const e of o.report?.errors ?? []) errors.push(`${o.discordId}: ${e}`)
  }

  const levels = [...perLevel.values()].sort((a, b) => a.level - b.level)
  return {
    members: outcomes.length,
    membersWithChanges: changed.size,
    applyMembers: outcomes.map((o) => o.discordId).filter((d) => apply.has(d)),
    perMission: [...perMission.values()].sort((a, b) => a.level - b.level || a.index - b.index),
    perLevel: levels,
    held,
    totalPep: levels.reduce((s, l) => s + l.pep, 0),
    top: [...byMember.values()].sort((a, b) => b.pep - a.pep || a.discordId.localeCompare(b.discordId)).slice(0, topN),
    errors,
  }
}

const CSV_COLUMNS: Array<keyof BackfillRow> = ['discordId', 'memberId', 'action', 'level', 'missionId', 'mission', 'holdReason', 'pep', 'detail']

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  // Quote everything that needs it; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows: readonly BackfillRow[]): string {
  return [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
}

/**
 * The --apply guard: the owner must repeat the dry run's total exactly.
 * Returns an error message, or null when it matches.
 */
export function checkConfirmTotal(expectedPep: number, confirm: unknown): string | null {
  if (confirm === undefined || confirm === null || confirm === true || confirm === '') {
    return `--apply needs --confirm-total <PEP>: the dry run's total (${expectedPep}).`
  }
  const raw = String(confirm).replace(/[,_\s]/g, '')
  if (!/^\d+$/.test(raw)) return `--confirm-total must be a whole number of PEP (got "${String(confirm)}").`
  const given = Number(raw)
  if (given !== expectedPep) {
    return `--confirm-total ${given} does not match the dry run's total of ${expectedPep} PEP. Something changed since the dry run you reviewed: run the dry run again, review the new CSV, and confirm the new total.`
  }
  return null
}
