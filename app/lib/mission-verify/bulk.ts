/**
 * Bulk verification (plans/mission-verification.md §3.4 "Nightly cron", §7).
 *
 * checkMany(discordIds) runs the engine for a batch of members, with the data
 * the verifiers need fetched once per batch instead of once per member:
 *
 *   - the active missions (once per batch, passed to the engine),
 *   - XAccount, CallAttendance counts and MemberWallet counts (one query each),
 *   - every guild member's roles (one paginated listing per run, not one
 *     Discord call per member); when the listing is incomplete the role
 *     verifiers answer "unknown", which never approves and never flags,
 *   - memberIds from the members sheet (once per run).
 *
 * Each member then goes through runVerifiers(), so every write is the same
 * idempotent, race-safe path the "Check my progress" button uses, and payouts
 * go through settleLevels() -> checkAndAwardLevelReward() (exactly once per
 * level, in level order). Dry runs (MISSION_VERIFIERS_ENABLED off, or a
 * backfill dry run) write nothing; for them checkMany projects what
 * settleLevels WOULD pay.
 */
import { prisma } from '../db'
import { paidLevelOf } from '../missions'
import { getSheetData } from '../sheets/member-repository'
import { runVerifiers, type MissionRow, type RunReport } from './engine'
import { defaultSources } from './sources'
import { getVerifier } from './verifiers'
import type { VerifierSources, VerifyCtx } from './types'

export interface LevelInfo {
  level: number
  reward: number
  /** Every active mission in the level (manual ones too): all must be APPROVED to pay. */
  missionIds: number[]
}

export interface MissionCatalog {
  /** Active missions that have a verifierKey, in (level, index) order. */
  verifierMissions: MissionRow[]
  /** Active levels in order. */
  levels: LevelInfo[]
  /** missionId -> level / title (CSV and summaries). */
  byId: Map<number, { level: number; index: number; title: string; verifierKey: string | null }>
}

/** The active missions, loaded once per run / batch. */
export async function loadMissionCatalog(): Promise<MissionCatalog> {
  const rows = await prisma.mission.findMany({
    where: { isActive: true },
    select: { id: true, level: true, index: true, title: true, reward: true, verifierKey: true, verifierParams: true },
    orderBy: [{ level: 'asc' }, { index: 'asc' }],
  })
  return buildCatalog(rows)
}

export function buildCatalog(
  rows: ReadonlyArray<MissionRow & { reward: number }>,
): MissionCatalog {
  const sorted = [...rows].sort((a, b) => a.level - b.level || a.index - b.index)
  const levels = new Map<number, LevelInfo>()
  for (const m of sorted) {
    const l = levels.get(m.level) ?? { level: m.level, reward: m.reward, missionIds: [] }
    l.missionIds.push(m.id)
    levels.set(m.level, l)
  }
  return {
    verifierMissions: sorted
      .filter((m) => m.verifierKey != null)
      .map(({ id, level, index, title, verifierKey, verifierParams }) => ({ id, level, index, title, verifierKey, verifierParams })),
    levels: [...levels.values()],
    byId: new Map(sorted.map((m) => [m.id, { level: m.level, index: m.index, title: m.title, verifierKey: m.verifierKey }])),
  }
}

/**
 * What settleLevels() would pay: every not-yet-paid level, in order, while
 * all of its missions are approved; stops at the first incomplete level.
 * (A paid level counts as complete; a level with no reward pays nothing.)
 */
export function projectPayouts(levels: readonly LevelInfo[], approved: ReadonlySet<number>, paid: ReadonlySet<number>): LevelInfo[] {
  const out: LevelInfo[] = []
  for (const l of [...levels].sort((a, b) => a.level - b.level)) {
    if (paid.has(l.level)) continue
    if (!l.missionIds.every((id) => approved.has(id))) break
    if (Number.isInteger(l.reward) && l.reward > 0) out.push(l)
  }
  return out
}

// ---------------------------------------------------------------------------
// Who to check
// ---------------------------------------------------------------------------

const SNOWFLAKE = /^\d{15,25}$/

/** Numeric order for Discord ids (the cursor relies on it). */
export function compareDiscordIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/** Sorted, de-duplicated snowflakes strictly after `cursor`. */
export function membersAfter(ids: Iterable<string>, cursor: string | null | undefined): string[] {
  const all = [...new Set([...ids].filter((id) => SNOWFLAKE.test(id)))].sort(compareDiscordIds)
  return cursor ? all.filter((id) => compareDiscordIds(id, cursor) > 0) : all
}

/**
 * Every member a verifier could pass for: anyone with a wallet, an X or
 * Telegram account, attendance, a mission row or an app login, plus the guild
 * members (role verifiers).
 */
export async function listCandidateMembers(extra: Iterable<string> = []): Promise<string[]> {
  const [users, x, tg, calls, wallets, completions] = await Promise.all([
    prisma.user.findMany({ select: { id: true } }),
    prisma.xAccount.findMany({ select: { discordId: true } }),
    prisma.telegramAccount.findMany({ select: { discordId: true } }),
    prisma.callAttendance.groupBy({ by: ['discordId'] }),
    prisma.memberWallet.findMany({ where: { discordId: { not: null } }, select: { discordId: true }, distinct: ['discordId'] }),
    prisma.missionCompletion.groupBy({ by: ['discordId'] }),
  ])
  return membersAfter(
    [
      ...users.map((u) => u.id),
      ...x.map((r) => r.discordId),
      ...tg.map((r) => r.discordId),
      ...calls.map((r) => r.discordId),
      ...wallets.map((r) => r.discordId as string),
      ...completions.map((r) => r.discordId),
      ...extra,
    ],
    null,
  )
}

/**
 * Every guild member's roles, from one paginated listing (1,000 per page).
 * Returns null unless the WHOLE listing was read: a partial list would look
 * like "role removed" and flag people wrongly.
 */
export async function listGuildMemberRoles(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Map<string, string[]> | null> {
  const guildId = env.DISCORD_GUILD_ID?.trim()
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  if (!guildId || !botToken) return null
  const roles = new Map<string, string[]>()
  let after = '0'
  for (let page = 0; page < 200; page++) {
    let res: Response | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        res = await fetchImpl(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`, {
          headers: { Authorization: `Bot ${botToken}` },
          cache: 'no-store',
        })
      } catch {
        res = null
      }
      if (res?.status !== 429) break
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number }
      await sleep(Math.min(10_000, Math.ceil((body.retry_after ?? 1) * 1000)))
    }
    if (!res?.ok) return null
    const members = (await res.json().catch(() => null)) as Array<{ roles?: string[]; user?: { id: string } }> | null
    if (!Array.isArray(members)) return null
    for (const m of members) if (m.user?.id) roles.set(m.user.id, m.roles ?? [])
    if (members.length < 1000) return roles
    after = members[members.length - 1].user?.id ?? after
  }
  return null // more pages than we are willing to read: treat as incomplete
}

/** discordId -> memberId from the members sheet; null when the sheet can't be read. */
export async function loadMemberIds(): Promise<Map<string, string> | null> {
  try {
    return (await getSheetData()).discordToMember
  } catch (e) {
    console.warn('[missions] members sheet unavailable for the bulk run:', e)
    return null
  }
}

// ---------------------------------------------------------------------------
// One batch
// ---------------------------------------------------------------------------

export interface BulkContext {
  catalog: MissionCatalog
  /** From listGuildMemberRoles(); null = unknown (role verifiers don't decide). */
  guildRoles: Map<string, string[]> | null
  /** From loadMemberIds(); null = unknown. */
  memberIds: Map<string, string> | null
  /** Base sources for what isn't prefetched (Discord messages, guild role names). */
  sources?: VerifierSources
}

export interface BatchData {
  x: Map<string, { xUsername: string }>
  calls: Map<string, { total: number; byCrew: Record<string, number> }>
  wallets: Map<string, number>
  approved: Map<string, Set<number>>
  paidLevels: Map<string, Set<number>>
  legacyAuto: Array<{ discordId: string; missionId: number; evidence: string | null }>
}

/** The per-member data for a batch, one query per table. */
export async function prefetchBatch(discordIds: string[], memberIds: Map<string, string> | null): Promise<BatchData> {
  const members = discordIds.map((d) => memberIds?.get(d)).filter((m): m is string => !!m)
  const [x, calls, wallets, completions, rewards] = await Promise.all([
    prisma.xAccount.findMany({ where: { discordId: { in: discordIds } }, select: { discordId: true, xUsername: true } }),
    prisma.callAttendance.groupBy({ by: ['discordId', 'crewId'], where: { discordId: { in: discordIds } }, _count: { _all: true } }),
    prisma.memberWallet.findMany({
      where: { OR: [{ discordId: { in: discordIds } }, ...(members.length ? [{ memberId: { in: members } }] : [])] },
      select: { id: true, discordId: true, memberId: true },
    }),
    prisma.missionCompletion.findMany({
      where: { discordId: { in: discordIds }, status: 'APPROVED' },
      select: { discordId: true, missionId: true, reviewedBy: true, evidence: true },
    }),
    prisma.transaction.findMany({
      where: { userId: { in: discordIds }, type: 'MISSION_REWARD' },
      select: { userId: true, metadata: true, description: true },
    }),
  ])

  const data: BatchData = { x: new Map(), calls: new Map(), wallets: new Map(), approved: new Map(), paidLevels: new Map(), legacyAuto: [] }
  for (const r of x) data.x.set(r.discordId, { xUsername: r.xUsername })
  for (const r of calls) {
    const c = data.calls.get(r.discordId) ?? { total: 0, byCrew: {} }
    c.byCrew[r.crewId] = r._count._all
    c.total += r._count._all
    data.calls.set(r.discordId, c)
  }
  for (const d of discordIds) {
    const memberId = memberIds?.get(d)
    // Same rule as sources.countWallets: rows on the discordId or the memberId.
    data.wallets.set(d, wallets.filter((w) => w.discordId === d || (!!memberId && w.memberId === memberId)).length)
  }
  for (const c of completions) {
    const s = data.approved.get(c.discordId) ?? new Set<number>()
    s.add(c.missionId)
    data.approved.set(c.discordId, s)
    if (c.reviewedBy === 'auto') data.legacyAuto.push({ discordId: c.discordId, missionId: c.missionId, evidence: c.evidence })
  }
  for (const t of rewards) {
    const level = paidLevelOf(t)
    if (level === null) continue
    const s = data.paidLevels.get(t.userId) ?? new Set<number>()
    s.add(level)
    data.paidLevels.set(t.userId, s)
  }
  return data
}

/** VerifierSources answering from the batch prefetch (and the run's guild listing). */
export function batchSources(base: VerifierSources, data: BatchData, guildRoles: Map<string, string[]> | null): VerifierSources {
  return {
    ...base,
    getXAccount: async (id) => data.x.get(id) ?? null,
    countCallsAttended: async (id) => {
      const c = data.calls.get(id) ?? { total: 0, byCrew: {} }
      return { total: c.total, calls: c.total, byCrew: { ...c.byCrew } }
    },
    // Not in the listing = not in the guild ([]); no listing = unknown (null).
    getMemberRoles: async (id) => (guildRoles ? (guildRoles.get(id) ?? []) : null),
    countWallets: async (id) => data.wallets.get(id) ?? 0,
  }
}

export interface MemberOutcome {
  discordId: string
  memberId: string | null
  report: RunReport | null
  error?: string
  /** Levels this run paid (live) or would pay (dry run), with their rewards. */
  payouts: Array<{ level: number; reward: number }>
  /** Grandfathered no-proof 'auto' approvals the new verifier would fail (D6: information only). */
  legacyWouldFail: Array<{ missionId: number; reason: string }>
}

export interface CheckManyOptions {
  trigger: 'cron' | 'backfill'
  /** Write nothing (forced while MISSION_VERIFIERS_ENABLED is off). */
  dryRun?: boolean
  /** Override MISSION_VERIFIERS_ENABLED (tests; the backfill checks the flag itself). */
  enabled?: boolean
  /** Only these missions (backfill --max-level). */
  missionIds?: number[]
  /** Re-run the verifiers on grandfathered 'auto' approvals (backfill report only). */
  auditLegacy?: boolean
  concurrency?: number
  now?: Date
  ctx: BulkContext
}

/** Run the engine for a batch of members (see the module comment). Never throws for one member. */
export async function checkMany(discordIds: string[], opts: CheckManyOptions): Promise<MemberOutcome[]> {
  const { ctx } = opts
  const data = await prefetchBatch(discordIds, ctx.memberIds)
  const sources = batchSources(ctx.sources ?? defaultSources, data, ctx.guildRoles)
  const now = opts.now ?? new Date()
  const levelReward = new Map(ctx.catalog.levels.map((l) => [l.level, l.reward]))
  const out = new Map<string, MemberOutcome>()

  const one = async (discordId: string) => {
    const memberId = ctx.memberIds?.get(discordId) ?? null
    const o: MemberOutcome = { discordId, memberId, report: null, payouts: [], legacyWouldFail: [] }
    try {
      const report = await runVerifiers(discordId, {
        trigger: opts.trigger,
        dryRun: opts.dryRun,
        ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
        ...(opts.missionIds ? { missionIds: opts.missionIds } : {}),
        memberId,
        now,
        sources,
        missions: ctx.catalog.verifierMissions,
      })
      o.report = report
      if (report.dryRun) {
        const approved = new Set(data.approved.get(discordId) ?? [])
        for (const c of report.checks) if (c.outcome === 'would_approve') approved.add(c.missionId)
        o.payouts = projectPayouts(ctx.catalog.levels, approved, data.paidLevels.get(discordId) ?? new Set()).map((l) => ({
          level: l.level,
          reward: l.reward,
        }))
      } else {
        o.payouts = report.levelsPaid.map((level) => ({ level, reward: levelReward.get(level) ?? 0 }))
      }
    } catch (e) {
      o.error = e instanceof Error ? e.message : String(e)
    }
    out.set(discordId, o)
  }

  const queue = [...discordIds]
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await one(id)
    }),
  )

  if (opts.auditLegacy) {
    for (const row of data.legacyAuto) {
      const m = ctx.catalog.verifierMissions.find((x) => x.id === row.missionId)
      const v = getVerifier(m?.verifierKey)
      const o = out.get(row.discordId)
      if (!m || !v || v.mode !== 'auto' || !o) continue
      try {
        const vctx: VerifyCtx = { discordId: row.discordId, memberId: o.memberId, trigger: opts.trigger, now, evidence: row.evidence, sources, memo: new Map() }
        const r = await v.check(vctx, v.parse(m.verifierParams))
        if (r.status === 'fail') o.legacyWouldFail.push({ missionId: m.id, reason: r.reason })
      } catch {
        /* information only */
      }
    }
  }
  return discordIds.map((d) => out.get(d)!)
}
