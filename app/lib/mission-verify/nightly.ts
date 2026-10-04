/**
 * The nightly missions run (GET /api/cron/missions; plans/mission-verification.md §3.4).
 *
 * Once a night it checks every member's automatic missions through
 * checkMany() (bulk data, the idempotent engine, race-safe ordered payouts),
 * re-checks the stateful ones (roles) on APPROVED rows to flag / unflag them
 * (never claw back, D17), and refreshes the duplicate-account signals.
 *
 *   - MISSION_VERIFIERS_ENABLED off: a DRY run. The VerifierRun records what
 *     WOULD be approved, held, flagged and paid; nothing is written to any
 *     completion and nothing is paid. (Duplicate signals are still refreshed:
 *     they are reviewer information only.)
 *   - Time-boxed: each invocation stops before it runs out of budget and the
 *     next cron slot resumes the same run from VerifierRun.cursor. vercel.json
 *     schedules a start slot and a few follow-up slots each night; a slot with
 *     nothing left to do returns at once.
 *   - A run is "tonight's" for 20 hours; a new one starts at most every 12.
 *
 * Discord: when a live run finishes having flagged or held something (or
 * found new duplicate signals), one summary post goes to the review channel
 * (MISSION_REVIEW_CHANNEL_ID, else #work, D11): counts only, no names. A run
 * paying more than MISSIONS_RUN_PEP_ALERT PEP (default 50,000) also posts an
 * alert to PEP_ADMIN_LOG_CHANNEL_ID.
 */
import { resolveChannelId } from '../discord-channels'
import { postDiscordMessage } from '../discord-rest'
import {
  checkMany,
  listCandidateMembers,
  listGuildMemberRoles,
  loadMemberIds,
  loadMissionCatalog,
  membersAfter,
  type BulkContext,
  type MemberOutcome,
  type MissionCatalog,
} from './bulk'
import { missionVerifiersEnabled } from './policy'
import { emptyStats, driveRun, prismaRunStore, type RunRow, type RunStats, type RunStore } from './runs'
import { refreshSignals } from './signals'
import { defaultSources } from './sources'
import { discordRole } from './verifiers'

const HOUR = 3_600_000
export const RUN_WINDOW_MS = 20 * HOUR
export const MIN_GAP_MS = 12 * HOUR

export interface NightlyDeps {
  store: RunStore
  enabled: () => boolean
  clock: () => number
  loadContext: () => Promise<BulkContext>
  listMembers: (ctx: BulkContext) => Promise<string[]>
  processBatch: (ids: string[], ctx: BulkContext, dryRun: boolean) => Promise<MemberOutcome[]>
  refreshSignals: () => Promise<Record<string, unknown>>
  announce: (summary: NightlySummary) => Promise<void>
}

export interface NightlyOptions {
  /** Wall-clock budget for this invocation (default MISSIONS_CRON_BUDGET_MS or 240 s). */
  budgetMs?: number
  /** Members per batch (default MISSIONS_CRON_BATCH or 100). */
  batchSize?: number
  deps?: Partial<NightlyDeps>
}

export type NightlyResult =
  | { status: 'already_ran'; runId: number; finishedAt: string | null }
  | { status: 'busy'; runId: number }
  | { status: 'partial' | 'finished'; runId: number; dryRun: boolean; processed: number; remaining: number; stats: RunStats }

export interface NightlySummary {
  runId: number
  dryRun: boolean
  stats: RunStats
}

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Guild members holding a role some discord_role mission asks for (others can't pass it). */
export async function roleHolders(catalog: MissionCatalog, guildRoles: Map<string, string[]> | null): Promise<string[]> {
  if (!guildRoles) return []
  const wanted = new Set<string>()
  for (const m of catalog.verifierMissions) {
    if (m.verifierKey !== discordRole.key) continue
    try {
      const p = discordRole.parse(m.verifierParams)
      const override = p.roleEnv ? process.env[p.roleEnv]?.trim() : ''
      const ids = override && /^\d{5,25}$/.test(override) ? [override] : p.roleIds
      const names = override && !/^\d{5,25}$/.test(override) ? [override] : override ? [] : p.roleNames
      ids.forEach((id) => wanted.add(id))
      if (names.length) (await defaultSources.resolveRoleIds(names))?.forEach((id) => wanted.add(id))
    } catch {
      /* bad params are reported by the engine */
    }
  }
  if (!wanted.size) return []
  return [...guildRoles].filter(([, roles]) => roles.some((r) => wanted.has(r))).map(([id]) => id)
}

export const defaultNightlyDeps: NightlyDeps = {
  store: prismaRunStore,
  enabled: () => missionVerifiersEnabled(),
  clock: Date.now,
  async loadContext() {
    const [catalog, guildRoles, memberIds] = await Promise.all([loadMissionCatalog(), listGuildMemberRoles(), loadMemberIds()])
    if (!guildRoles) console.warn('[missions] guild member listing unavailable: role missions are not decided (or flagged) this run')
    return { catalog, guildRoles, memberIds }
  },
  async listMembers(ctx) {
    return listCandidateMembers(await roleHolders(ctx.catalog, ctx.guildRoles))
  },
  // The run decided its mode once (deps.enabled); every batch follows it.
  processBatch: (ids, ctx, dryRun) => checkMany(ids, { trigger: 'cron', dryRun, enabled: !dryRun, ctx, concurrency: 4 }),
  refreshSignals: async () => refreshSignals(),
  announce: announceRun,
}

export async function runNightlyMissions(opts: NightlyOptions = {}): Promise<NightlyResult> {
  const d: NightlyDeps = { ...defaultNightlyDeps, ...opts.deps }
  const budgetMs = opts.budgetMs ?? envInt('MISSIONS_CRON_BUDGET_MS', 240_000)
  const batchSize = opts.batchSize ?? envInt('MISSIONS_CRON_BATCH', 100)
  const startedAt = d.clock()
  const now = new Date(startedAt)
  const dryRun = !d.enabled()

  let run: RunRow | null = await d.store.findOpen('nightly', new Date(startedAt - RUN_WINDOW_MS))
  let flipped = false
  if (run && run.dryRun !== dryRun) {
    // The flag was flipped mid-run: close that run, start a fresh one in the new mode.
    run.stats.closedReason = `MISSION_VERIFIERS_ENABLED changed (dryRun ${run.dryRun} -> ${dryRun})`
    await d.store.save(run.id, { stats: run.stats, finishedAt: now, leaseUntil: null })
    run = null
    flipped = true
  }
  if (!run) {
    const last = flipped ? null : await d.store.latest('nightly')
    if (last && last.finishedAt && startedAt - last.startedAt.getTime() < MIN_GAP_MS) {
      return { status: 'already_ran', runId: last.id, finishedAt: last.finishedAt.toISOString() }
    }
    run = await d.store.create('nightly', dryRun, emptyStats())
  }

  if (!(await d.store.claim(run.id, new Date(startedAt + budgetMs + 60_000), now))) {
    return { status: 'busy', runId: run.id }
  }

  if (!run.stats.signals) {
    run.stats.signals = await d.refreshSignals()
    await d.store.save(run.id, { stats: run.stats })
  }

  let members: string[] = []
  let ctx: BulkContext
  try {
    ctx = await d.loadContext()
    members = membersAfter(await d.listMembers(ctx), run.cursor)
  } catch (e) {
    await d.store.save(run.id, { leaseUntil: null })
    throw e
  }
  const remainingBudget = budgetMs - (d.clock() - startedAt)
  const res = await driveRun({
    run,
    store: d.store,
    members,
    processBatch: (ids) => d.processBatch(ids, ctx, dryRun),
    batchSize,
    budgetMs: remainingBudget,
    clock: d.clock,
  })

  if (res.done) {
    await d.announce({ runId: run.id, dryRun, stats: res.run.stats }).catch((e) => console.error('[missions] run summary post failed:', e))
  }
  return {
    status: res.done ? 'finished' : 'partial',
    runId: run.id,
    dryRun,
    processed: res.processed,
    remaining: members.length - res.processed,
    stats: res.run.stats,
  }
}

/** The one Discord post per finished live run (see the module comment). */
export async function announceRun({ runId, dryRun, stats }: NightlySummary): Promise<void> {
  if (dryRun || !missionVerifiersEnabled()) return
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) return
  const signals = stats.signals as { created?: number } | undefined
  const newSignals = signals?.created ?? 0
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, '')
  const alertAt = envInt('MISSIONS_RUN_PEP_ALERT', 50_000)

  if (stats.flagged || stats.held || stats.reopened || newSignals) {
    const channelId = await resolveChannelId('work', 'MISSION_REVIEW_CHANNEL_ID')
    if (channelId) {
      const lines = [
        `🍕 Nightly mission check (run ${runId}): ${stats.members.toLocaleString('en-US')} members checked.`,
        stats.held || stats.reopened ? `• ${stats.held + stats.reopened} auto-verified mission(s) need a reviewer's approval.` : '',
        stats.flagged ? `• ${stats.flagged} approved mission(s) flagged: the member no longer meets them (nothing was taken back).` : '',
        newSignals ? `• ${newSignals} new possible duplicate-account signal(s).` : '',
        `Review: <${appUrl}/missions>`,
      ].filter(Boolean)
      await postDiscordMessage({ kind: 'bot', channelId, botToken }, { content: lines.join('\n'), allowed_mentions: { parse: [] } })
    }
  }
  if (stats.pepPaid > alertAt) {
    const channelId = process.env.PEP_ADMIN_LOG_CHANNEL_ID?.trim()
    if (channelId) {
      await postDiscordMessage(
        { kind: 'bot', channelId, botToken },
        { content: `⚠️ Nightly mission run ${runId} paid ${stats.pepPaid.toLocaleString('en-US')} PEP (alert threshold ${alertAt.toLocaleString('en-US')}). Levels: ${JSON.stringify(stats.levelsPaid)}`, allowed_mentions: { parse: [] } },
      )
    }
  }
}
