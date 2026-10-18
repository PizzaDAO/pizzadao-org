import { prisma } from './db'
import {
  getBotUserId,
  getGuildInfo,
  listAllGuildMembers,
  sendWelcome,
  writeGuildMember,
  type GuildInfo,
  type GuildMemberRow,
  type MemberWrite,
  type MemberWriteResult,
  type WelcomeResult,
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
/** oregano-41907: the one welcome message (DM and channel post). */
/** At most this many welcomes per run; the rest wait for the next run. */
const WELCOME_MAX_PER_RUN = 20
/** Spacing between channel posts (Discord's per-channel message bucket). */
const WELCOME_CHANNEL_GAP_MS = 1200
export const TRAINEE_WELCOME_TEXT = 'Welcome to PizzaDAO! Grab a name at https://app.pizzadao.org'

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
  welcomed?: number
  welcomeFailed?: number
  dmClosed?: number
  channelFailed?: number
  welcomeDeferred?: number
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
  now: () => number
  /** Runs fn holding the single-flight lock; { busy: true } when someone else has it. */
  withLock: <T>(fn: () => Promise<T>) => Promise<{ busy: true } | { busy: false; value: T }>
  listMembers: () => Promise<GuildMemberRow[]>
  guildInfo: () => Promise<GuildInfo>
  botUserId: () => Promise<string>
  readSignedUp: () => Promise<Map<string, string>>
  completedL2: (ids: string[]) => Promise<Set<string>>
  write: (op: MemberWrite, reason: string) => Promise<MemberWriteResult>
  welcome: (userId: string, text: string, channelId: string | null) => Promise<WelcomeResult>
  /** Which of these ids already have a TraineeWelcome row. */
  welcomedIds: (ids: string[]) => Promise<Set<string>>
  /** Insert the row; false when it already exists (someone else claimed it). */
  claimWelcome: (id: string) => Promise<boolean>
  /** Delete the row so the next run retries (transient failure). */
  releaseWelcome: (id: string) => Promise<void>
  recordWelcome: (id: string, dm: string, channel: string) => Promise<void>
  /** Delete claims with no outcome older than 15 min; returns how many. */
  reclaimStaleWelcomes: () => Promise<number>
}

const defaultDeps = (): TraineeNickDeps => ({
  env: process.env,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
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
  welcome: (userId, text, channelId) => sendWelcome(userId, text, channelId),
  welcomedIds: async (ids) => {
    if (ids.length === 0) return new Set()
    const rows = await prisma.traineeWelcome.findMany({ where: { discordId: { in: ids } }, select: { discordId: true } })
    return new Set(rows.map((r) => r.discordId))
  },
  claimWelcome: async (id) => (await prisma.traineeWelcome.createMany({ data: [{ discordId: id }], skipDuplicates: true })).count === 1,
  releaseWelcome: async (id) => {
    await prisma.traineeWelcome.deleteMany({ where: { discordId: id } })
  },
  recordWelcome: async (id, dm, channel) => {
    await prisma.traineeWelcome.updateMany({ where: { discordId: id }, data: { dm, channel } })
  },
  reclaimStaleWelcomes: async () =>
    (
      await prisma.traineeWelcome.deleteMany({
        where: { dm: null, channel: null, welcomedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      })
    ).count,
})

class BusySignal extends Error {}

const SINCE_FLOOR = Date.parse('2026-10-01T00:00:00Z')

/** Full ISO timestamp, not before the 2026-10-01 floor and not in the future; else null. */
export function parseSince(raw: string | undefined, now = Date.now()): number | null {
  const s = (raw ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null
  const t = Date.parse(s)
  if (!Number.isFinite(t) || t < SINCE_FLOOR || t > now) return null
  return t
}

/** Stop issuing writes after this long so the 115s lock transaction never times out mid-run. */
const WRITE_BUDGET_MS = 60_000
/** Welcomes get their own slice: start a new one only before this (see sendWelcome for the worst case). */
const WELCOME_DEADLINE_MS = 85_000
/** A claim with no recorded outcome older than this was left by a killed run. */
const STALE_CLAIM_MS = 15 * 60_000

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
      welcomed: 0,
      welcomeFailed: 0,
      dmClosed: 0,
      channelFailed: 0,
      welcomeDeferred: 0,
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

    // oregano-41907: welcome each new trainee once (see welcomeStep).
    const welcomeChannelId = (env.TRAINEE_WELCOME_CHANNEL_ID ?? '').trim() || guild.systemChannelId || null

    // 4. Dry run: report only.
    if (dryRun) {
      try {
        const done = await deps.welcomedIds(plan.candidates.map((c) => c.id))
        for (const c of plan.candidates.filter((c) => !done.has(c.id)).slice(0, WELCOME_MAX_PER_RUN)) {
          console.log(`[trainee-nicks] would welcome ${c.id}`)
        }
      } catch (err) {
        console.warn('[trainee-nicks] welcome dry-run lookup failed', (err as Error)?.message)
      }
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
    const writeStart = deps.now()

    const perform = async (op: MemberWrite, reason: string): Promise<Outcome> => {
      if (deps.now() - writeStart > WRITE_BUDGET_MS) {
        stop = "time_budget"
        return "stop"
      }
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
    const nickOk = new Set<string>()
    for (const e of plan.enforce) {
      if (stop) break
      let touched = false
      if (e.setNick) {
        const o = await perform({ kind: 'nick', userId: e.id, nick: TRAINEE_NICK }, AUDIT_REASON)
        if (o === 'ok') {
          result.nickSet!++
          touched = true
          nickOk.add(e.id)
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

    /**
     * Welcome step. Qualifies: in-window, non-signed-up, nick is now the
     * placeholder (already was, or set this run), no TraineeWelcome row. The row
     * is claimed BEFORE sending (at-most-once across overlapping runs/restarts);
     * a transient failure of every leg releases it so the next run retries.
     * Independent of the Pizza Noob role. Never fails the run.
     */
    try {
      // Skip when the stop means Discord is unhealthy for us (429s, 403s, repeated errors);
      // time_budget only means the write loops used their slice, so welcomes still run.
      if (!stop || stop === 'time_budget') await welcomeStep()
    } catch (err) {
      console.warn('[trainee-nicks] welcome step failed', (err as Error)?.message)
    }

    if (stop) {
      result.stoppedReason = stop
      if (stop === 'permission_error') result.status = 'aborted'
    }
    return result

    async function welcomeStep() {
      if (!dryRun) {
        const stale = await deps.reclaimStaleWelcomes()
        if (stale > 0) console.log(`[trainee-nicks] reclaimed ${stale} stale welcome claim(s)`)
      }
      const ready = plan.candidates.filter((c) => !c.setNick || nickOk.has(c.id)).map((c) => c.id)
      const done = await deps.welcomedIds(ready)
      const due = ready.filter((id) => !done.has(id))
      let lastChannelPost = -Infinity
      let sent = 0
      for (const id of due) {
        if (sent >= WELCOME_MAX_PER_RUN) {
          result.welcomeDeferred! += due.length - sent
          break
        }
        if (deps.now() - writeStart >= WELCOME_DEADLINE_MS) {
          // Not claimed, so the next run handles them.
          result.welcomeDeferred! += due.length - sent
          console.warn(`[trainee-nicks] time budget spent; ${due.length - sent} welcome(s) deferred`)
          break
        }
        let claimed = false
        try {
          claimed = await deps.claimWelcome(id)
        } catch (err) {
          console.warn(`[trainee-nicks] welcome claim failed for ${id}`, (err as Error)?.message)
          result.welcomeFailed!++
          continue
        }
        if (!claimed) continue
        sent++
        if (welcomeChannelId) {
          const wait = WELCOME_CHANNEL_GAP_MS - (deps.now() - lastChannelPost)
          if (wait > 0) await deps.sleep(wait)
          lastChannelPost = deps.now()
        }
        try {
          const w = await deps.welcome(id, TRAINEE_WELCOME_TEXT, welcomeChannelId)
          const delivered = w.dm === 'sent' || w.channel === 'sent'
          if (w.dm === 'closed') {
            result.dmClosed!++
            console.log(`[trainee-nicks] DMs closed for ${id}`)
          }
          if (w.channel === 'failed') result.channelFailed!++
          if (delivered) result.welcomed!++
          else result.welcomeFailed!++
          if (!delivered && w.transient) {
            await deps.releaseWelcome(id)
          } else {
            // Always non-null, so a finished row is never reclaimed as stale.
            await deps.recordWelcome(id, w.dm || 'none', w.channel || 'none').catch(() => {})
          }
          if (w.rateLimited) {
            // A 429 we could not ride out: back off for the rest of this run.
            result.welcomeDeferred! += due.length - sent
            console.warn(`[trainee-nicks] welcome rate limited; ${due.length - sent} welcome(s) deferred`)
            break
          }
        } catch (err) {
          result.welcomeFailed!++
          console.warn(`[trainee-nicks] welcome failed for ${id}`, (err as Error)?.message)
          await deps.releaseWelcome(id).catch(() => {})
        }
      }
    }
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
