// Gap backfill for DiscordActivity: count the messages posted between the one-off history crawl and the
// moment the recorder's live counter began, from the Discord REST API (message ids only, no content kept).
// Driven by scripts/discord/backfill-activity.ts. Rate limit friendly: one request at a time, a small
// pause between requests, the x-ratelimit headers honoured and every 429 waited out.

import type { ActivityBatch, ActivityUserBatch } from "./discord-activity"
import { MAX_BATCH_USERS, MAX_CHANNELS_PER_USER } from "./discord-activity"

const API = "https://discord.com/api/v10"
const DISCORD_EPOCH = BigInt(1420070400000)

export const snowflakeFromMs = (ms: number): string => ((BigInt(ms) - DISCORD_EPOCH) << BigInt(22)).toString()
export const msFromSnowflake = (id: string): number => Number((BigInt(id) >> BigInt(22)) + DISCORD_EPOCH)
const cmpId = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0)

export interface CrawlOptions {
  token: string
  guildId: string
  fromMs: number
  untilMs: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Pause between requests. */
  gapMs?: number
  log?: (msg: string) => void
}

interface ApiChannel {
  id: string
  name?: string
  type: number
  parent_id?: string | null
  last_message_id?: string | null
  thread_metadata?: { archive_timestamp?: string }
}

interface ApiMessage {
  id: string
  type: number
  webhook_id?: string
  author?: { id: string; bot?: boolean; username?: string }
  message_reference?: unknown
}

/** Per-member aggregate, same shape as a live batch entry. */
export type Aggregate = Map<string, ActivityUserBatch>

export interface CrawlStats {
  channels: number
  threads: number
  requests: number
  messagesSeen: number
  counted: number
  skippedChannels: number
  forbidden: number
}

/** Add one message to the aggregate. Bots, webhooks and system messages are not counted. */
export function countMessage(agg: Aggregate, m: ApiMessage, channelName: string, thread: boolean): boolean {
  if (!m.author || m.author.bot || m.webhook_id) return false
  if (m.type !== 0 && m.type !== 19) return false
  const at = msFromSnowflake(m.id)
  const iso = new Date(at).toISOString()
  let u = agg.get(m.author.id)
  if (!u) {
    u = { discordId: m.author.id, authorName: m.author.username ?? null, firstAt: iso, lastAt: iso, days: {}, channels: {}, replies: 0, threads: 0 }
    agg.set(m.author.id, u)
  }
  if (iso < u.firstAt) u.firstAt = iso
  if (iso >= u.lastAt) {
    u.lastAt = iso
    if (m.author.username) u.authorName = m.author.username
  }
  const day = iso.slice(0, 10)
  u.days[day] = (u.days[day] ?? 0) + 1
  if (channelName && (u.channels[channelName] !== undefined || Object.keys(u.channels).length < MAX_CHANNELS_PER_USER)) {
    u.channels[channelName] = (u.channels[channelName] ?? 0) + 1
  }
  if (m.type === 19) u.replies++
  if (thread) u.threads++
  return true
}

export async function crawlGap(opts: CrawlOptions): Promise<{ aggregate: Aggregate; stats: CrawlStats }> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const gap = opts.gapMs ?? 120
  const log = opts.log ?? (() => undefined)
  const headers = { Authorization: `Bot ${opts.token}` }
  const fromId = snowflakeFromMs(opts.fromMs)
  const untilId = snowflakeFromMs(opts.untilMs)
  const stats: CrawlStats = { channels: 0, threads: 0, requests: 0, messagesSeen: 0, counted: 0, skippedChannels: 0, forbidden: 0 }
  const aggregate: Aggregate = new Map()

  /** GET with 429 handling; null on 403/404 (no access). */
  const get = async <T>(path: string): Promise<T | null> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      stats.requests++
      const res = await doFetch(`${API}${path}`, { headers, cache: "no-store" })
      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as { retry_after?: number }
        await sleep(Math.ceil((j.retry_after ?? 1) * 1000) + 250)
        continue
      }
      if (res.status === 403 || res.status === 404) {
        stats.forbidden++
        return null
      }
      if (res.status >= 500) {
        await sleep(2000 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`Discord ${res.status} on ${path}`)
      const remaining = res.headers.get("x-ratelimit-remaining")
      const reset = Number(res.headers.get("x-ratelimit-reset-after"))
      await sleep(remaining === "0" && Number.isFinite(reset) ? Math.ceil(reset * 1000) + 100 : gap)
      return (await res.json()) as T
    }
    throw new Error(`Discord kept failing on ${path}`)
  }

  const crawlOne = async (id: string, name: string, thread: boolean) => {
    let cursor = fromId
    for (;;) {
      const page = await get<ApiMessage[]>(`/channels/${id}/messages?limit=100&after=${cursor}`)
      if (!page || page.length === 0) return
      let max = cursor
      for (const m of page) {
        if (cmpId(m.id, max) > 0) max = m.id
        stats.messagesSeen++
        if (cmpId(m.id, untilId) >= 0) continue
        if (countMessage(aggregate, m, name, thread)) stats.counted++
      }
      if (cmpId(max, untilId) >= 0 || page.length < 100 || max === cursor) return
      cursor = max
    }
  }

  const hasNewer = (c: ApiChannel) => !c.last_message_id || cmpId(c.last_message_id, fromId) > 0

  const channels = (await get<ApiChannel[]>(`/guilds/${opts.guildId}/channels`)) ?? []
  const names = new Map(channels.map((c) => [c.id, c.name ?? ""]))
  const chatty = channels.filter((c) => [0, 2, 5, 13].includes(c.type))
  const parents = channels.filter((c) => [0, 5, 15, 16].includes(c.type))

  for (const c of chatty) {
    stats.channels++
    if (!hasNewer(c)) {
      stats.skippedChannels++
      continue
    }
    await crawlOne(c.id, c.name ?? "", false)
    log(`#${c.name}: ${stats.counted} counted so far, ${stats.requests} requests`)
  }

  const threads = new Map<string, ApiChannel>()
  const active = await get<{ threads?: ApiChannel[] }>(`/guilds/${opts.guildId}/threads/active`)
  for (const t of active?.threads ?? []) threads.set(t.id, t)
  for (const p of parents) {
    let before: string | null = null
    for (;;) {
      const r: { threads?: ApiChannel[]; has_more?: boolean } | null = await get(
        `/channels/${p.id}/threads/archived/public?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`,
      )
      if (!r?.threads?.length) break
      let oldest = ""
      for (const t of r.threads) {
        threads.set(t.id, t)
        const at = t.thread_metadata?.archive_timestamp
        if (at && (!oldest || at < oldest)) oldest = at
      }
      // Archived before the window: it cannot hold newer messages (a new message un-archives a thread).
      if (!r.has_more || !oldest || Date.parse(oldest) < opts.fromMs) break
      before = oldest
    }
  }
  for (const t of threads.values()) {
    stats.threads++
    if (!hasNewer(t)) {
      stats.skippedChannels++
      continue
    }
    const parent = t.parent_id ? (names.get(t.parent_id) ?? "") : ""
    await crawlOne(t.id, parent, true)
  }
  log(`done: ${stats.counted} messages counted, ${stats.requests} requests`)
  return { aggregate, stats }
}

/** Batches of at most MAX_BATCH_USERS members with stable ids (members sorted), so a resumed apply skips what was applied. */
export function toBatches(agg: Aggregate, idPrefix: string): ActivityBatch[] {
  const users = [...agg.values()].sort((a, b) => cmpId(a.discordId, b.discordId))
  const out: ActivityBatch[] = []
  for (let i = 0; i < users.length; i += MAX_BATCH_USERS) {
    out.push({ batchId: `${idPrefix}-${String(out.length).padStart(4, "0")}`, users: users.slice(i, i + MAX_BATCH_USERS) })
  }
  return out
}
