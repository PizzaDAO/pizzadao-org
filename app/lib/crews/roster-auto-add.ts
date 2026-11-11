/**
 * Add regular call attendees to their crew's roster (nightly job).
 *
 * Rule: a signed-up member who attended at least `crews.rosterAutoAddMinCalls` of a crew's last
 * `crews.rosterAutoAddWindowCalls` calls is added to that crew. A "call" is a distinct call date with
 * attendance rows for the crew; a CallAttendance row already means the person passed the attendance
 * threshold (recording rows are only written above it, sheet rows are the sheet's say-so).
 *
 * Three additive pieces per qualifying (crew, member), each only when missing:
 *   cell: the member's Crews cell (updateMemberCrews, the admin roster add, actor "roster-auto-add");
 *   page: a row in the crew page roster (CrewRole table) for crews whose roster reads from the DB;
 *         sheet-sourced crews are skipped and counted. An existing row (even archived) is never touched;
 *   role: the crew's Discord role (single-role PUT), also healing members already on the roster.
 * Never removes anyone, never posts anything. Idempotent: whatever is already there is not touched.
 *
 * Logs and results carry counts only. The dry run response is the one place that lists ids.
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { normalizeCrewId, NON_ROSTER_CREW_IDS } from '@/app/lib/crew-id'
import { fetchAllMembers } from '@/app/lib/sheets/members-list'
import { updateMemberCrews, RosterWritebackError, type UpdateMemberCrewsInput, type UpdateMemberCrewsResult } from '@/app/lib/roster-writeback'
import { writeGuildMember, getBotUserId, listAllGuildMembers, type MemberWrite, type MemberWriteResult } from '@/app/lib/discord'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'

/** Look this far back for attendance; a crew with no calls in this time is dormant and gets nothing. */
export const LOOKBACK_DAYS = 180
const DISCORD_ID = /^\d{17,20}$/
const MAX_RESET_WAIT_MS = 5_000
const ACTOR = 'roster-auto-add'
const AUDIT_REASON = 'Crew roster: added from call attendance'

export interface AttendanceRow {
  discordId: string
  crewId: string
  callDate: Date
}

export interface RosterMember {
  id: string
  name?: string
  discordId: string
  /** Normalized crew ids the member is already on. */
  crews: Set<string>
}

export interface RosterRule {
  minCalls: number
  windowCalls: number
}

export interface PlannedAdd {
  crewId: string
  memberId: string
  discordId: string
  /** Missing from the member's Crews cell. */
  cell: boolean
  /** Missing from the crew page roster (DB-sourced crews only). */
  page: boolean
  /** Missing the crew's Discord role (when the role is known). */
  role: boolean
}

/** Discord ids from a free-text setting (spaces, commas, new lines). */
export function parseExcludeIds(raw: string | null | undefined): Set<string> {
  return new Set(String(raw ?? '').split(/[\s,;]+/).filter((s) => DISCORD_ID.test(s)))
}

/**
 * Pure: who should be added where. Only adds (a member already on a crew is skipped, nobody is ever
 * removed); only members with a member record; only crews that exist (`knownCrews`) and take a roster.
 */
export function planRosterAdds(input: {
  rows: AttendanceRow[]
  members: RosterMember[]
  knownCrews: ReadonlySet<string>
  excluded: ReadonlySet<string>
  botIds?: ReadonlySet<string>
  rule: RosterRule
  /** Crew id -> member ids already on the crew page roster (archived rows included). Only crews whose roster reads from the DB. */
  pageRosters?: ReadonlyMap<string, ReadonlySet<string>>
  /** Crew id -> Discord role id (absent or null: no role to grant). */
  roleIds?: ReadonlyMap<string, string | null>
  /** Discord id -> role ids held now; null/absent when unknown (then no role is planned). */
  heldRoles?: ReadonlyMap<string, ReadonlySet<string>> | null
}): PlannedAdd[] {
  const { rows, members, knownCrews, excluded, rule } = input
  const pageRosters = input.pageRosters ?? new Map<string, ReadonlySet<string>>()
  const roleIds = input.roleIds ?? new Map<string, string | null>()
  const bots = input.botIds ?? new Set<string>()
  const byDiscord = new Map<string, RosterMember>()
  for (const m of members) if (m.discordId && !byDiscord.has(m.discordId)) byDiscord.set(m.discordId, m)

  // Per crew: day (yyyy-mm-dd) -> who attended.
  const perCrew = new Map<string, Map<string, Set<string>>>()
  for (const r of rows) {
    const crewId = normalizeCrewId(r.crewId)
    if (!crewId || NON_ROSTER_CREW_IDS.has(crewId) || !knownCrews.has(crewId)) continue
    const day = r.callDate.toISOString().slice(0, 10)
    let days = perCrew.get(crewId)
    if (!days) perCrew.set(crewId, (days = new Map()))
    let who = days.get(day)
    if (!who) days.set(day, (who = new Set()))
    who.add(r.discordId)
  }

  const out: PlannedAdd[] = []
  for (const crewId of [...perCrew.keys()].sort()) {
    const days = perCrew.get(crewId)!
    const recent = [...days.keys()].sort().reverse().slice(0, Math.max(1, rule.windowCalls))
    const counts = new Map<string, number>()
    for (const day of recent) for (const id of days.get(day)!) counts.set(id, (counts.get(id) ?? 0) + 1)
    for (const [discordId, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
      if (n < rule.minCalls) continue
      if (excluded.has(discordId) || bots.has(discordId) || discordId.startsWith('UNRESOLVED:')) continue
      const m = byDiscord.get(discordId)
      if (!m) continue
      const cell = !m.crews.has(crewId)
      const page = pageRosters.has(crewId) && !pageRosters.get(crewId)!.has(m.id)
      const roleId = roleIds.get(crewId)
      const held = input.heldRoles?.get(discordId)
      const role = !!roleId && !!held && !held.has(roleId)
      if (cell || page || role) out.push({ crewId, memberId: m.id, discordId, cell, page, role })
    }
  }
  return out
}

export type PerCrew = Record<string, number>
export interface PlanCounts {
  crewsCell: PerCrew
  crewPage: PerCrew
  role: PerCrew
}

/** Counts per crew for each piece, plus the ids: what the dry run returns. */
export function summarizePlan(plan: PlannedAdd[]): { total: number; perCrew: PlanCounts; adds: Array<{ crewId: string; memberId: string; crewsCell: boolean; crewPage: boolean; role: boolean }> } {
  const perCrew: PlanCounts = { crewsCell: {}, crewPage: {}, role: {} }
  for (const p of plan) {
    if (p.cell) perCrew.crewsCell[p.crewId] = (perCrew.crewsCell[p.crewId] ?? 0) + 1
    if (p.page) perCrew.crewPage[p.crewId] = (perCrew.crewPage[p.crewId] ?? 0) + 1
    if (p.role) perCrew.role[p.crewId] = (perCrew.role[p.crewId] ?? 0) + 1
  }
  return {
    total: plan.length,
    perCrew,
    adds: plan.map((p) => ({ crewId: p.crewId, memberId: p.memberId, crewsCell: p.cell, crewPage: p.page, role: p.role })),
  }
}

function roleIdFromMapping(role: unknown): string | null {
  const str = String(role ?? '').trim()
  const m = str.match(/^<@&(\d+)>$/) || str.match(/^(\d+)$/)
  return m ? m[1] : null
}

export interface RosterAutoAddDeps {
  loadRows: (since: Date) => Promise<AttendanceRow[]>
  loadMembers: () => Promise<RosterMember[]>
  loadCrews: () => Promise<Array<{ id: string; role?: string }>>
  botIds: () => Promise<Set<string>>
  /** Crew page roster member ids for the crews whose roster reads from the DB; the other crew ids are listed in `sheetSourced`. */
  loadPageRosters: (crewIds: string[]) => Promise<{ rosters: Map<string, Set<string>>; sheetSourced: string[] }>
  /** Insert a plain roster row; 'exists' when one is already there. */
  addToCrewPage: (input: { crewId: string; memberId: string; name: string; actor: string }) => Promise<'created' | 'exists'>
  /** Discord id -> role ids, or null when the guild member list cannot be read. */
  loadHeldRoles: () => Promise<Map<string, Set<string>> | null>
  updateCrews: (input: UpdateMemberCrewsInput) => Promise<UpdateMemberCrewsResult>
  writeRole: (op: MemberWrite, reason: string) => Promise<MemberWriteResult>
  sleep: (ms: number) => Promise<void>
  now: () => Date
}

export function defaultDeps(): RosterAutoAddDeps {
  return {
    loadRows: async (since) =>
      (
        await prisma.callAttendance.findMany({
          where: { callDate: { gte: since } },
          select: { discordId: true, crewId: true, callDate: true },
        })
      ).map((r) => ({ discordId: r.discordId, crewId: r.crewId, callDate: r.callDate })),
    loadMembers: async () => {
      const all = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true })
      return all
        .filter((m) => m?.id && m.discordId)
        .map((m) => ({
          id: String(m.id),
          name: String(m.name ?? '').trim(),
          discordId: String(m.discordId).trim(),
          crews: new Set((Array.isArray(m.crews) ? m.crews : []).map(normalizeCrewId).filter(Boolean)),
        }))
    },
    loadCrews: async () => (await getCrewMappings()).crews.map((c) => ({ id: c.id, role: (c as { role?: string }).role })),
    botIds: async () => {
      try {
        return new Set([await getBotUserId()])
      } catch {
        return new Set()
      }
    },
    loadPageRosters: async (crewIds) => {
      const { crewRolesFromDb } = await import('@/app/lib/crew-roles')
      if (!(await crewRolesFromDb())) return { rosters: new Map(), sheetSourced: crewIds }
      const rows = await prisma.crewRole.findMany({ where: { crewId: { in: crewIds }, memberId: { not: null } }, select: { crewId: true, memberId: true } })
      const rosters = new Map<string, Set<string>>(crewIds.map((c) => [c, new Set<string>()]))
      for (const r of rows) rosters.get(r.crewId)?.add(String(r.memberId))
      return { rosters, sheetSourced: [] }
    },
    addToCrewPage: async ({ crewId, memberId, name, actor }) => {
      const naturalKey = `id:${memberId}`
      const found = await prisma.crewRole.findUnique({ where: { crewId_naturalKey: { crewId, naturalKey } }, select: { id: true } })
      if (found) return 'exists'
      const last = await prisma.crewRole.aggregate({ where: { crewId }, _max: { position: true } })
      try {
        // A plain member row, as the roster editor saves one: no status, no notes, at the end.
        await prisma.crewRole.create({ data: { crewId, naturalKey, memberId, name, position: (last._max.position ?? -1) + 1, updatedBy: actor } })
        return 'created'
      } catch (e) {
        if ((e as { code?: string })?.code === 'P2002') return 'exists'
        throw e
      }
    },
    loadHeldRoles: async () => {
      try {
        const list = await listAllGuildMembers()
        return new Map(list.map((g) => [g.user.id, new Set(g.roles)] as const))
      } catch {
        return null
      }
    },
    updateCrews: (input) => updateMemberCrews(input),
    writeRole: (op, reason) => writeGuildMember(op, reason),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  }
}

export interface RosterAutoAddResult {
  dryRun: boolean
  /** True when the switch is off (or this is a preview) and the run only counted. */
  switchOff: boolean
  planned: number
  perCrew: PlanCounts
  /** Crews whose page roster is sheet-sourced and so was left alone. */
  pageSkippedSheetCrews?: number
  added?: number
  pageAdded?: number
  alreadyThere?: number
  failed?: number
  roleGranted?: number
  roleSkipped?: number
  roleFailed?: number
  deferred?: number
  stoppedReason?: string | null
  /** Only on a dry run: the planned adds as ids. */
  adds?: ReturnType<typeof summarizePlan>['adds']
}

export async function runRosterAutoAdd(
  opts: { dryRun?: boolean; env?: NodeJS.ProcessEnv } = {},
  deps: RosterAutoAddDeps = defaultDeps(),
): Promise<RosterAutoAddResult> {
  const env = opts.env ?? process.env
  const settings = await loadSettings()
  const on = await toggleEnabled('crews.rosterAutoAddEnabled', env)
  const dryRun = !!opts.dryRun || !on

  const rule: RosterRule = {
    minCalls: settings.get('crews.rosterAutoAddMinCalls'),
    windowCalls: settings.get('crews.rosterAutoAddWindowCalls'),
  }
  const maxPerRun = settings.get('crews.rosterAutoAddMaxPerRun')
  const excluded = parseExcludeIds(settings.get('crews.rosterAutoAddExcludeIds'))
  // Tolerated when a deploy has the shared attendance exclusion list (calls.attendanceExcludeIds).
  try {
    const shared = (settings as unknown as { get: (k: string) => unknown }).get('calls.attendanceExcludeIds')
    if (typeof shared === 'string') for (const id of parseExcludeIds(shared)) excluded.add(id)
  } catch {
    /* the setting does not exist here */
  }

  const crews = await deps.loadCrews()
  const known = new Set(crews.map((c) => normalizeCrewId(c.id)).filter(Boolean))
  const roleByCrew = new Map(crews.map((c) => [normalizeCrewId(c.id), roleIdFromMapping(c.role)] as const))
  const since = new Date(deps.now().getTime() - LOOKBACK_DAYS * 86_400_000)
  const { rosters, sheetSourced } = await deps.loadPageRosters([...known].filter((c) => !NON_ROSTER_CREW_IDS.has(c)))
  const nameOf = new Map<string, string>()

  const members = await deps.loadMembers()
  for (const m of members) nameOf.set(m.id, m.name ?? '')
  const plan = planRosterAdds({
    rows: await deps.loadRows(since),
    members,
    knownCrews: known,
    excluded,
    botIds: await deps.botIds(),
    rule,
    pageRosters: rosters,
    roleIds: roleByCrew,
    heldRoles: await deps.loadHeldRoles(),
  })
  const summary = summarizePlan(plan)
  const base = { dryRun, switchOff: !on, planned: summary.total, perCrew: summary.perCrew, pageSkippedSheetCrews: sheetSourced.length }
  if (dryRun) return { ...base, ...(opts.dryRun ? { adds: summary.adds } : {}) }

  const todo = plan.slice(0, maxPerRun)
  let added = 0
  let pageAdded = 0
  let alreadyThere = 0
  let failed = 0
  let roleGranted = 0
  let roleSkipped = 0
  let roleFailed = 0
  let stoppedReason: string | null = null
  let done = 0
  let rateLimited = false

  for (const p of todo) {
    done++
    if (p.cell) {
      try {
        // Preview first, then apply against what the preview saw (the write-back's own two-step).
        const preview = await deps.updateCrews({ memberId: p.memberId, crewId: p.crewId, action: 'add', mode: 'dry-run', actor: ACTOR })
        if (!preview.changed) alreadyThere++
        else {
          const res = await deps.updateCrews({ memberId: p.memberId, crewId: p.crewId, action: 'add', mode: 'apply', expectedBefore: preview.before, actor: ACTOR })
          if (res.applied) added++
          else alreadyThere++
        }
      } catch (e) {
        // 409 = the cell changed under us: the next run re-plans it. Anything else is counted too.
        failed++
        if (!(e instanceof RosterWritebackError)) console.error('[crews/roster-auto-add] write failed:', e instanceof Error ? e.message : e)
        continue
      }
    }

    if (p.page) {
      try {
        if ((await deps.addToCrewPage({ crewId: p.crewId, memberId: p.memberId, name: nameOf.get(p.memberId) || p.memberId, actor: ACTOR })) === 'created') pageAdded++
      } catch (e) {
        failed++
        console.error('[crews/roster-auto-add] page roster write failed:', e instanceof Error ? e.message : e)
      }
    }

    if (!p.role || rateLimited) continue
    const roleId = roleByCrew.get(p.crewId)
    if (!roleId) {
      roleSkipped++
      continue
    }
    try {
      let r = await deps.writeRole({ kind: 'addRole', userId: p.discordId, roleId }, AUDIT_REASON)
      if (r.status === 429) {
        if (r.blocked || (r.retryAfterMs ?? Infinity) > 15_000) {
          roleFailed++
          rateLimited = true
          stoppedReason = 'discord rate limited'
          continue
        }
        await deps.sleep(r.retryAfterMs ?? 1000)
        r = await deps.writeRole({ kind: 'addRole', userId: p.discordId, roleId }, AUDIT_REASON)
      }
      if (r.status >= 200 && r.status < 300) roleGranted++
      else {
        // A failed grant is retried tomorrow: the role is still missing then.
        roleFailed++
        if (r.status === 429) {
          rateLimited = true
          stoppedReason = 'discord rate limited'
          continue
        }
      }
      // Respect Discord's bucket: wait out an exhausted one (short waits only).
      if (r.remaining === 0 && r.resetAfterMs) await deps.sleep(Math.min(r.resetAfterMs, MAX_RESET_WAIT_MS))
    } catch {
      roleFailed++
    }
  }

  return { ...base, added, pageAdded, alreadyThere, failed, roleGranted, roleSkipped, roleFailed, deferred: plan.length - done, stoppedReason }
}
