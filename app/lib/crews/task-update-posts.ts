/**
 * Crew task update digest: when a crew's tasks change on the website (created, moved to Doing or
 * Done, given a lead), Metalhead posts ONE short digest in that crew's Discord channel with a link
 * to the crew page. Driven by /api/cron/crew-task-updates.
 *
 *  - Source: the CrewTaskEvent audit trail (written by every website task edit: the crew-lead
 *    editor, call proposals, claim/give-up). Nothing is queued anywhere else.
 *  - Batching: per crew, at most one post per `crews.taskUpdateDigestMinutes`. The digest lists
 *    everything since the crew's last one (CrewTaskUpdatePost keeps the last event id covered).
 *  - Off by default (crews.taskUpdatePostsEnabled, env kill switch CREWS_TASK_UPDATE_POSTS_ENABLED).
 *    Production only: a preview never posts. While off nothing is claimed, so turning it on starts
 *    with the last digest window, not the whole history.
 *  - No pings (allowed_mentions parse []), embeds suppressed, crews excluded by calls.postFilter
 *    get nothing. The watermark is claimed BEFORE posting; it is released only when Discord
 *    definitely refused, so an unknown outcome never reposts.
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { resolveRecapChannel } from '@/app/lib/calls/recap'
import { isCrewExcluded, loadPostFilter } from '@/app/lib/calls/post-filters'
import { DiscordPostError, postDiscordMessage } from '@/app/lib/discord-rest'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { sliceUnits } from '@/app/lib/display-name'
import { SITE_URL } from '@/app/lib/site-url'

type Env = Record<string, string | undefined>

const ACTIONS = ['create', 'update', 'claim']
/** Events older than this are never reported (a crew that was skipped for days does not get a stale dump). */
const MAX_AGE_MS = 7 * 86_400_000
const MAX_EVENTS = 2000
export const MAX_DIGEST_LINES = 8
const MAX_LABEL_UNITS = 80

export type TaskEventRow = { id: number; taskId: string; crewId: string; action: string; data: unknown; createdAt: Date }
export type TaskNow = { id: string; label: string; leadName: string | null }

export type DigestEntry = { taskId: string; label: string; created: boolean; stage: 'doing' | 'done' | null; lead: string | null }

/** Doing / Done as the crew page shows them; every other stage change is not worth a post. */
export function stageKind(stage: unknown): 'doing' | 'done' | null {
  const s = String(stage ?? '').trim().toLowerCase()
  if (s === 'done' || s === 'complete' || s === 'completed') return 'done'
  if (s === 'doing' || s === 'now' || s === 'in progress' || s.includes('progress')) return 'doing'
  return null
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Fold a crew's events (oldest first) into one entry per task; tasks nothing worth posting happened to are left out. */
export function summarizeEvents(events: TaskEventRow[], tasks: Map<string, TaskNow>): DigestEntry[] {
  const by = new Map<string, DigestEntry>()
  const order: string[] = []
  for (const e of events) {
    const task = tasks.get(e.taskId)
    if (!task) continue
    const d = rec(e.data)
    const changes = rec(d.changes)
    let stage: 'doing' | 'done' | null = null
    let lead: string | null = null
    let created = false
    if (e.action === 'create') {
      created = true
      stage = stageKind(changes.stage ?? d.stage)
    } else if (e.action === 'update') {
      if (changes.stage !== undefined) stage = stageKind(changes.stage)
      if (changes.leadName || changes.leadMemberId) lead = String(changes.leadName || task.leadName || '').trim() || 'a new lead'
    } else if (e.action === 'claim') {
      lead = task.leadName?.trim() || 'a new lead'
    } else continue
    if (!created && !stage && !lead) continue
    let entry = by.get(e.taskId)
    if (!entry) {
      entry = { taskId: e.taskId, label: task.label, created: false, stage: null, lead: null }
      by.set(e.taskId, entry)
      order.push(e.taskId)
    }
    if (created) entry.created = true
    if (stage) entry.stage = stage
    if (lead) entry.lead = lead
  }
  return order.map((id) => by.get(id)!)
}

const clean = (s: string) => sliceUnits(s.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim(), MAX_LABEL_UNITS)

export function digestLine(e: DigestEntry): string {
  const bits: string[] = []
  if (e.created) bits.push('new')
  if (e.stage) bits.push(e.stage === 'done' ? 'done' : 'doing')
  if (e.lead) bits.push(`lead: ${clean(e.lead)}`)
  return `• ${clean(e.label)} (${bits.join(', ')})`
}

export function digestText(crewLabel: string, crewId: string, entries: DigestEntry[], base: string = SITE_URL): string {
  const shown = entries.slice(0, MAX_DIGEST_LINES)
  const more = entries.length - shown.length
  return [
    `📋 Task updates for ${clean(crewLabel) || crewId}`,
    ...shown.map(digestLine),
    ...(more > 0 ? [`…and ${more} more`] : []),
    `${base}/crew/${encodeURIComponent(crewId)}`,
  ].join('\n')
}

export type CrewDigestOutcome = {
  crewId: string
  status: 'posted' | 'waiting' | 'nothing' | 'excluded' | 'no-channel' | 'already' | 'failed' | 'post-uncertain' | 'error'
  count?: number
}
export type DigestRunResult = { status: 'disabled' | 'no-token' | 'ran'; outcomes: CrewDigestOutcome[] }

export interface DigestDeps {
  now?: Date
  env?: Env
  post?: typeof postDiscordMessage
  resolveChannel?: typeof resolveRecapChannel
}

/** Whether digests are posted: the switch, and never on a preview deploy. */
export async function taskUpdatePostsEnabled(env: Env = process.env): Promise<boolean> {
  if (env.VERCEL_ENV !== 'production') return false
  return toggleEnabled('crews.taskUpdatePostsEnabled', env)
}

export async function runCrewTaskUpdatePosts(deps: DigestDeps = {}): Promise<DigestRunResult> {
  const env = deps.env ?? process.env
  const now = deps.now ?? new Date()
  if (!(await taskUpdatePostsEnabled(env))) return { status: 'disabled', outcomes: [] }
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) return { status: 'no-token', outcomes: [] }

  const settings = await loadSettings()
  const minutes = settings.get('crews.taskUpdateDigestMinutes')
  const intervalMs = minutes * 60_000
  // Throws when the filter cannot be read: better no post than a post to an excluded crew.
  const filter = await loadPostFilter()

  const marks = new Map((await prisma.crewTaskUpdatePost.findMany()).map((m) => [m.crewId, m]))
  const events = (await prisma.crewTaskEvent.findMany({
    where: { action: { in: ACTIONS }, createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) } },
    orderBy: { id: 'asc' },
    take: MAX_EVENTS,
  })) as TaskEventRow[]

  // Events not yet covered, per crew. A crew with no digest yet starts at the last interval.
  const pending = new Map<string, TaskEventRow[]>()
  for (const e of events) {
    const mark = marks.get(e.crewId)
    if (mark ? e.id <= mark.lastEventId : e.createdAt.getTime() < now.getTime() - intervalMs) continue
    const list = pending.get(e.crewId) ?? []
    list.push(e)
    pending.set(e.crewId, list)
  }
  if (pending.size === 0) return { status: 'ran', outcomes: [] }

  const crews = (await getCrewMappings()).crews
  const outcomes: CrewDigestOutcome[] = []
  for (const [crewId, list] of pending) {
    try {
      outcomes.push(await postCrewDigest({ crewId, list, mark: marks.get(crewId) ?? null, crews, filter, intervalMs, now, botToken, deps, env }))
    } catch (err) {
      // One crew's failure must not stop the others.
      console.error('[crew-task-updates] crew failed', crewId, err instanceof Error ? err.message : err)
      outcomes.push({ crewId, status: 'error' })
    }
  }
  return { status: 'ran', outcomes }
}

type Mark = { crewId: string; lastEventId: number; postedAt: Date }

async function postCrewDigest(o: {
  crewId: string
  list: TaskEventRow[]
  mark: Mark | null
  crews: Array<{ id: string; label: string }>
  filter: Awaited<ReturnType<typeof loadPostFilter>>
  intervalMs: number
  now: Date
  botToken: string
  deps: DigestDeps
  env: Env
}): Promise<CrewDigestOutcome> {
  const { crewId, list, mark, now } = o
  const crew = o.crews.find((c) => c.id === crewId)
  if (!crew) return { crewId, status: 'nothing' }
  if (isCrewExcluded(crew, o.filter)) return { crewId, status: 'excluded' }
  if (mark && now.getTime() - mark.postedAt.getTime() < o.intervalMs) return { crewId, status: 'waiting' }

  const tasks = new Map(
    (await prisma.crewTask.findMany({ where: { id: { in: [...new Set(list.map((e) => e.taskId))] }, crewId, archived: false }, select: { id: true, label: true, leadName: true } })).map((t) => [t.id, t as TaskNow]),
  )
  const entries = summarizeEvents(list, tasks)
  const lastEventId = list[list.length - 1].id
  if (entries.length === 0) {
    // Only changes not worth a post (notes, priority, retired tasks): move on without posting.
    await advance(crewId, lastEventId, mark, mark?.postedAt ?? new Date(0))
    return { crewId, status: 'nothing' }
  }

  const channel = await (o.deps.resolveChannel ?? resolveRecapChannel)(crewId, { env: o.env })
  if (!channel) return { crewId, status: 'no-channel' }

  // Claim before posting.
  if (!(await claim(crewId, lastEventId, mark, now))) return { crewId, status: 'already' }
  try {
    await (o.deps.post ?? postDiscordMessage)(
      { kind: 'bot', channelId: channel.channelId, botToken: o.botToken },
      { content: digestText(crew.label, crewId, entries), allowed_mentions: { parse: [] }, flags: 4 /* SUPPRESS_EMBEDS */ },
    )
    return { crewId, status: 'posted', count: entries.length }
  } catch (err) {
    console.error('[crew-task-updates] post failed', crewId, err instanceof Error ? err.message : err)
    if (err instanceof DiscordPostError && err.status >= 400 && err.status < 500) {
      // Discord refused: put the previous watermark back so the next run retries.
      if (mark) await prisma.crewTaskUpdatePost.updateMany({ where: { crewId }, data: { lastEventId: mark.lastEventId, postedAt: mark.postedAt } })
      else await prisma.crewTaskUpdatePost.deleteMany({ where: { crewId } })
      return { crewId, status: 'failed' }
    }
    // The message may have been delivered: keep the claim rather than risk a double post.
    return { crewId, status: 'post-uncertain' }
  }
}

/** Compare-and-set the watermark. False when another run already moved it. */
async function claim(crewId: string, lastEventId: number, mark: Mark | null, now: Date): Promise<boolean> {
  if (!mark) {
    try {
      await prisma.crewTaskUpdatePost.create({ data: { crewId, lastEventId, postedAt: now } })
      return true
    } catch {
      return false // unique violation: a parallel run claimed it first
    }
  }
  const r = await prisma.crewTaskUpdatePost.updateMany({ where: { crewId, lastEventId: mark.lastEventId }, data: { lastEventId, postedAt: now } })
  return r.count === 1
}

async function advance(crewId: string, lastEventId: number, mark: Mark | null, postedAt: Date): Promise<void> {
  if (!mark) {
    await prisma.crewTaskUpdatePost.create({ data: { crewId, lastEventId, postedAt } }).catch(() => {})
    return
  }
  await prisma.crewTaskUpdatePost.updateMany({ where: { crewId, lastEventId: mark.lastEventId }, data: { lastEventId } })
}
