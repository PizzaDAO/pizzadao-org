import { prisma } from './db'
import {
  getBotUserId,
  getGuildInfo,
  listAllGuildMembers,
  writeGuildMember,
  type GuildInfo,
  type GuildMemberRow,
  type MemberWrite,
  type MemberWriteResult,
} from './discord'
import { completedLevelBy } from './missions'
import { readSignedUpMembers } from './member-registration'
import {
  PIZZA_NOOB_GRADUATE_LEVEL,
  TRAINEE_NICK,
  pizzaNoobCandidates,
  planTraineeNicks,
  resolvePizzaNoobRoleId,
  type PlanMember,
} from './trainee-nick'

/**
 * anchovy-52918 runner: one cron pass that names non-signed-up joiners
 * "Pizza Trainee", gives them Pizza Noob, heals signed-up members who still
 * carry the placeholder, and removes Pizza Noob after missions Level 2.
 * See plans/anchovy-52918.md. No backfill: TRAINEE_NICK_SINCE is required.
 */

const AUDIT_REASON = 'anchovy-52918 trainee nickname'
const GRADUATE_REASON = 'anchovy-52918 completed missions Level 2'
/** Single-flight key (transaction-scoped advisory lock; no table needed). */
const ADVISORY_LOCK_KEY = 742019340
const MAX_RESET_WAIT_MS = 5_000
const MAX_429_WAIT_MS = 15_000
const SAMPLE_SIZE = 20

export type RoleStatus = 'ok' | 'role_unresolved' | 'role_not_assignable'

export interface TraineeNickResult {
  status: 'finished' | 'not_configured' | 'busy' | 'aborted'
  dryRun: boolean
  scanned?: number
  inScope?: number
  alreadyTrainee?: number
  enforced?: number
  nickSet?: number
  roleAdded?: number
  roleRemoved?: number
  roleStatus?: RoleStatus
  pizzaNoobRoleId?: string | null
  healed?: number
  skipped?: { bot: number; owner: number; outranked: number; signedUp: number }
  signedUpCount?: number
  forbidden?: number
  overflow?: number
  planned?: { heal: number; sweep: number; enforce: number }
  samples?: { heal: string[]; sweep: string[]; enforce: string[] }
  stoppedReason?: string | null
}

export interface TraineeNickDeps {
  env: NodeJS.ProcessEnv
  sleep: (ms: number) => Promise<void>
  /** Runs fn holding the single-flight lock; { busy: true } when someone else has it. */
  withLock: <T>(fn: () => Promise<T>) => Promise<{ busy: true } | { busy: false; value: T }>
  listMembers: () => Promise<GuildMemberRow[]>
  guildInfo: () => Promise<GuildInfo>
  botUserId: () => Promise<string>
  readSignedUp: () => Promise<Map<string, string>>
  completedL2: (ids: string[]) => Promise<Set<string>>
  write: (op: MemberWrite, reason: string) => Promise<MemberWriteResult>
}

const defaultDeps = (): TraineeNickDeps => ({
  env: process.env,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  withLock: async (fn) => {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS locked`
          if (!rows?.[0]?.locked) throw new BusySignal()
          return { busy: false as const, value: await fn() }
        },
        { timeout: 115_000, maxWait: 5_000 },
      )
    } catch (e) {
      if (e instanceof BusySignal) return { busy: true as const }
      throw e
    }
  },
  listMembers: () => listAllGuildMembers(),
  guildInfo: () => getGuildInfo(),
  botUserId: () => getBotUserId(),
  readSignedUp: () => readSignedUpMembers(),
  completedL2: (ids) => completedLevelBy(ids, PIZZA_NOOB_GRADUATE_LEVEL),
  write: (op, reason) => writeGuildMember(op, reason),
})

class BusySignal extends Error {}

function parseSince(raw: string | undefined): number | null {
  const t = raw ? Date.parse(raw) : NaN
  return Number.isFinite(t) ? t : null
}

function intEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

type Outcome = 'ok' | 'skip' | 'forbidden' | 'stop'

export async function runTraineeNicks(opts: {
  dryRun: boolean
  deps?: Partial<TraineeNickDeps>
}): Promise<TraineeNickResult> {
  const deps = { ...defaultDeps(), ...opts.deps }
  const { env } = deps
  const dryRun = opts.dryRun

  // 1. Config. Without SINCE there is no scope, so never run (no backfill).
  const sinceParsed = parseSince(env.TRAINEE_NICK_SINCE)
  if (sinceParsed === null) return { status: 'not_configured', dryRun }
  const since: number = sinceParsed
  const max = intEnv(env.TRAINEE_NICK_MAX_PER_RUN, 50)
  const minSignedUp = intEnv(env.TRAINEE_NICK_MIN_SIGNED_UP, 100)

  // 2. Single-flight.
  const locked = await deps.withLock(() => runLocked())
  if (locked.busy) return { status: 'busy', dryRun }
  return locked.value

  async function runLocked(): Promise<TraineeNickResult> {
    // 3. Guild reads first, the live roster last.
    const [rawMembers, guild, botId] = await Promise.all([deps.listMembers(), deps.guildInfo(), deps.botUserId()])
    const bot = rawMembers.find((m) => m.user.id === botId)
    if (!bot) return { status: 'aborted', dryRun, scanned: rawMembers.length, stoppedReason: 'bot_member_missing' }

    const positions = new Map(guild.roles.map((r) => [r.id, r.position]))
    const botTopPosition = Math.max(0, ...bot.roles.map((r) => positions.get(r) ?? 0))
    const members: PlanMember[] = rawMembers.map((m) => ({
      id: m.user.id,
      nick: m.nick ?? null,
      roles: m.roles,
      joinedAt: m.joined_at ?? null,
      bot: !!m.user.bot,
    }))

    // Pizza Noob: resolve, and check it is something the bot can assign.
    const pizzaNoobRoleId = resolvePizzaNoobRoleId(guild.roles, env.PIZZA_NOOB_ROLE_ID)
    const roleObj = guild.roles.find((r) => r.id === pizzaNoobRoleId)
    let roleStatus: RoleStatus = 'ok'
    if (!pizzaNoobRoleId) roleStatus = 'role_unresolved'
    else if (!roleObj || roleObj.managed || roleObj.position >= botTopPosition) roleStatus = 'role_not_assignable'
    const roleAssignable = roleStatus === 'ok'
    if (roleStatus !== 'ok') console.warn(`[trainee-nicks] ${roleStatus}; skipping the Pizza Noob step`)

    let signedUp: Map<string, string>
    try {
      signedUp = await deps.readSignedUp()
    } catch (e) {
      console.error('[trainee-nicks] roster read failed', (e as Error)?.message)
      return { status: 'aborted', dryRun, scanned: members.length, stoppedReason: 'roster_read_failed' }
    }
    if (signedUp.size < minSignedUp) {
      return { status: 'aborted', dryRun, scanned: members.length, signedUpCount: signedUp.size, stoppedReason: 'roster_too_small' }
    }

    const base = {
      members,
      signedUp,
      ownerId: guild.ownerId,
      botTopPosition,
      rolePositions: positions,
      since,
      pizzaNoobRoleId,
      roleAssignable,
    }
    // Fail closed: if the L2 lookup fails nobody gets the role added or removed.
    let completedL2: Set<string> | null = null
    try {
      completedL2 = await deps.completedL2(pizzaNoobCandidates(base))
    } catch (e) {
      console.error('[trainee-nicks] L2 lookup failed', (e as Error)?.message)
    }
    const plan = planTraineeNicks({ ...base, max, completedL2 })

    const result: TraineeNickResult = {
      status: 'finished',
      dryRun,
      scanned: members.length,
      inScope: plan.inScope,
      alreadyTrainee: plan.alreadyTrainee,
      enforced: 0,
      nickSet: 0,
      roleAdded: 0,
      roleRemoved: 0,
      roleStatus,
      pizzaNoobRoleId,
      healed: 0,
      skipped: plan.skipped,
      signedUpCount: signedUp.size,
      forbidden: 0,
      overflow: plan.overflow,
      planned: { heal: plan.heal.length, sweep: plan.sweep.length, enforce: plan.enforce.length },
      stoppedReason: completedL2 === null && roleAssignable ? 'l2_lookup_failed' : null,
    }

    // 4. Dry run: report only.
    if (dryRun) {
      result.samples = {
        heal: plan.heal.slice(0, SAMPLE_SIZE).map((h) => h.id),
        sweep: plan.sweep.slice(0, SAMPLE_SIZE).map((h) => h.id),
        enforce: plan.enforce.slice(0, SAMPLE_SIZE).map((h) => h.id),
      }
      return result
    }

    // 5. Writes, one at a time.
    let forbiddenStreak = 0
    let errorStreak = 0
    let stop = null as string | null

    const perform = async (op: MemberWrite, reason: string): Promise<Outcome> => {
      let res = await deps.write(op, reason)
      if (res.status === 429) {
        if (res.blocked || res.retryAfterMs === null || res.retryAfterMs > MAX_429_WAIT_MS) {
          stop = 'rate_limited'
          return 'stop'
        }
        await deps.sleep(res.retryAfterMs)
        res = await deps.write(op, reason)
        if (res.status === 429) {
          stop = 'rate_limited'
          return 'stop'
        }
      }
      if (res.status === 403) {
        result.forbidden!++
        console.warn(`[trainee-nicks] 403 for ${op.userId} (${op.kind})`)
        if (++forbiddenStreak >= 3) {
          stop = 'permission_error'
          return 'stop'
        }
        return 'forbidden'
      }
      if (res.status === 404) return 'skip'
      if (res.status < 200 || res.status >= 300) {
        console.warn(`[trainee-nicks] ${res.status} for ${op.userId} (${op.kind})`)
        if (++errorStreak >= 3) {
          stop = 'discord_errors'
          return 'stop'
        }
        return 'skip'
      }
      forbiddenStreak = 0
      errorStreak = 0
      if (res.remaining === 0 && res.resetAfterMs !== null) {
        if (res.resetAfterMs <= MAX_RESET_WAIT_MS) await deps.sleep(res.resetAfterMs)
        else stop = 'rate_limit_reset_long'
      }
      return 'ok'
    }

    for (const h of plan.heal) {
      if (stop) break
      if ((await perform({ kind: 'nick', userId: h.id, nick: h.nick }, AUDIT_REASON)) === 'ok') {
        result.healed!++
        result.nickSet!++
      }
    }
    for (const s of plan.sweep) {
      if (stop) break
      if ((await perform({ kind: 'removeRole', userId: s.id, roleId: pizzaNoobRoleId! }, GRADUATE_REASON)) === 'ok') {
        result.roleRemoved!++
      }
    }
    for (const e of plan.enforce) {
      if (stop) break
      let touched = false
      if (e.setNick) {
        const o = await perform({ kind: 'nick', userId: e.id, nick: TRAINEE_NICK }, AUDIT_REASON)
        if (o === 'ok') {
          result.nickSet!++
          touched = true
        } else if (o !== 'stop') {
          continue // 403/404/error: skip the role for this member too
        }
        if (stop) break
      }
      if (e.addRole) {
        const o = await perform({ kind: 'addRole', userId: e.id, roleId: pizzaNoobRoleId! }, AUDIT_REASON)
        if (o === 'ok') {
          result.roleAdded!++
          touched = true
        }
      }
      if (touched) result.enforced!++
    }

    if (stop) {
      result.stoppedReason = stop
      if (stop === 'permission_error') result.status = 'aborted'
    }
    return result
  }
}

/**
 * Hook for the missions Level 2 payout: remove Pizza Noob from this member.
 * Dry-run until TRAINEE_NICK_ENABLED=true. Never throws; on any problem it
 * logs and returns, and the 10-minute sweep retries.
 */
export async function removePizzaNoobOnGraduate(
  discordId: string,
  overrides: {
    env?: NodeJS.ProcessEnv
    fetchMember?: (id: string) => Promise<{ status: number; member?: { roles: string[]; joined_at?: string | null } }>
    guildInfo?: () => Promise<GuildInfo>
    write?: (op: MemberWrite, reason: string) => Promise<MemberWriteResult>
  } = {},
): Promise<'removed' | 'skipped'> {
  const env = overrides.env ?? process.env
  try {
    const since = parseSince(env.TRAINEE_NICK_SINCE)
    if (since === null) return 'skipped'

    const guild = await (overrides.guildInfo ?? getGuildInfo)()
    const roleId = resolvePizzaNoobRoleId(guild.roles, env.PIZZA_NOOB_ROLE_ID)
    if (!roleId) return 'skipped'

    const fetchMember = overrides.fetchMember ?? defaultFetchMember
    const got = await fetchMember(discordId)
    if (got.status !== 200 || !got.member) return 'skipped'
    if (!got.member.roles.includes(roleId)) return 'skipped'
    const joined = got.member.joined_at ? Date.parse(got.member.joined_at) : NaN
    if (!Number.isFinite(joined) || joined < since) return 'skipped'

    if (env.TRAINEE_NICK_ENABLED !== 'true') {
      console.log(`[trainee-nicks] would remove Pizza Noob from ${discordId}`)
      return 'skipped'
    }
    const res = await (overrides.write ?? writeGuildMember)({ kind: 'removeRole', userId: discordId, roleId }, GRADUATE_REASON)
    if (res.status >= 200 && res.status < 300) return 'removed'
    console.warn(`[trainee-nicks] graduate removal for ${discordId} got ${res.status}; the sweep will retry`)
    return 'skipped'
  } catch (e) {
    console.warn('[trainee-nicks] graduate removal failed', (e as Error)?.message)
    return 'skipped'
  }
}

async function defaultFetchMember(id: string) {
  const guildId = process.env.DISCORD_GUILD_ID
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!guildId || !botToken) return { status: 0 }
  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${id}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!r.ok) return { status: r.status }
  return { status: 200, member: (await r.json()) as { roles: string[]; joined_at?: string | null } }
}
