/**
 * Verify that a member really did a daily job before it pays.
 *
 * A job description is Discord markup ("Share a movie in <#channel> and tag <@user>"). The rules
 * below are derived from it and checked against the member's messages in the named channel (GET
 * only, through the bot; needs the Message Content intent). Jobs naming no channel cannot be
 * checked (see the setting jobs.unverifiableJobsPayOnClick). Fails closed: when Discord cannot be
 * read, nothing pays.
 *
 * Reading: today's messages are fetched oldest to newest with `after=<day start>`, a few pages at
 * most, and shared for ~10 seconds between members (so a busy board does not hammer Discord).
 * Forum and media channels have no messages of their own, so their threads are searched instead.
 * 403/404 from Discord are setup problems (bot cannot see the channel, channel deleted): they are
 * remembered for a few minutes and reported as "can't be checked" rather than as an outage.
 */
import { loadSettings } from './settings'
import { envKillsToggle, resolveToggle } from './settings/toggles'

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_EPOCH = BigInt('1420070400000')
const PAGE = 100
/** Pages of 100 read per channel or thread for one scan. */
export const MAX_PAGES = 10
/** Threads searched per channel, newest activity first. */
const MAX_THREADS = 10
const MESSAGE_CACHE_MS = 10_000
const CHANNEL_TYPE_CACHE_MS = 10 * 60_000
const FAILURE_CACHE_MS = 5 * 60_000
const EMBED_RETRY_MS = 1500
const FORUM_TYPES = [15, 16] // GuildForum, GuildMedia

/** Explicit wording that asks for media. Generic "image", "picture" and "results" are not enough on their own. One place to change the rules. */
export const MEDIA_WORDS = /\b(gifs?|memes?|images?|photos?|screenshots?|pics?|selfies?|videos?|clips?|stickers?|drawings?|art|pfp)\b/i
const MEDIA_CONTENT_TYPE = /^(image|video)\//i
const MEDIA_FILENAME = /\.(gif|png|jpe?g|webp|mp4|mov|webm)$/i
const MEDIA_EMBED_TYPES = ['gifv', 'image', 'video']
const MEDIA_HOSTS = ['tenor.com', 'giphy.com', 'youtube.com', 'youtu.be', 'imgur.com', 'x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com']
const MEDIA_PROVIDERS = ['tenor', 'giphy', 'youtube', 'imgur', 'twitter', 'x']
/** The verbs that make a mentioned user someone the post must tag. */
const TAG_PHRASE = /\b(?:tag|mention|ping)s?\s+((?:<@!?\d{5,25}>(?:\s*(?:,|and|&)\s*)?)+)/gi

export interface JobRequirements {
  channelIds: string[]
  /** Users the job asks to tag (not every user that is merely named in the text). */
  userIds: string[]
  roleIds: string[]
  needsMedia: boolean
}

/** Derive what the post must contain from the job description. */
export function parseJobRequirements(description: string): JobRequirements {
  const uniq = (re: RegExp) => [...new Set([...description.matchAll(re)].map((m) => m[1]))]
  const userIds = new Set<string>()
  for (const m of description.matchAll(TAG_PHRASE)) {
    for (const u of m[1].matchAll(/<@!?(\d{5,25})>/g)) userIds.add(u[1])
  }
  // Strip the markup so "<#id>" / "<@id>" do not count as words.
  const words = description.replace(/<[#@][!&]?\d+>/g, ' ')
  return {
    channelIds: uniq(/<#(\d{5,25})>/g),
    userIds: [...userIds],
    roleIds: uniq(/<@&(\d{5,25})>/g),
    needsMedia: MEDIA_WORDS.test(words),
  }
}

export interface DiscordMessage {
  id: string
  channel_id?: string
  timestamp: string
  content?: string
  author?: { id: string }
  mentions?: { id: string }[]
  mention_roles?: string[]
  attachments?: { content_type?: string; filename?: string }[]
  embeds?: { type?: string; url?: string; provider?: { name?: string } }[]
  sticker_items?: { id: string }[]
}

function isMediaHost(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return MEDIA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

function hasMedia(m: DiscordMessage): boolean {
  if ((m.sticker_items ?? []).length > 0) return true
  if ((m.attachments ?? []).some((a) => MEDIA_CONTENT_TYPE.test(a.content_type ?? '') || MEDIA_FILENAME.test(a.filename ?? ''))) return true
  return (m.embeds ?? []).some(
    (e) =>
      MEDIA_EMBED_TYPES.includes(e.type ?? '') ||
      isMediaHost(e.url) ||
      MEDIA_PROVIDERS.includes((e.provider?.name ?? '').toLowerCase()),
  )
}

/** Nothing readable as media yet: embeds can arrive a moment after the message. */
function lacksAnyMediaField(m: DiscordMessage): boolean {
  return (m.attachments ?? []).length === 0 && (m.embeds ?? []).length === 0 && (m.sticker_items ?? []).length === 0
}

function inWindowFromMember(m: DiscordMessage, memberId: string, since: Date): boolean {
  return m.author?.id === memberId && new Date(m.timestamp).getTime() >= since.getTime()
}

function mentionsOk(m: DiscordMessage, req: JobRequirements): boolean {
  const content = m.content ?? ''
  const users = new Set((m.mentions ?? []).map((u) => u.id))
  const roles = new Set(m.mention_roles ?? [])
  return (
    req.userIds.every((id) => users.has(id) || content.includes(`<@${id}>`) || content.includes(`<@!${id}>`)) &&
    req.roleIds.every((id) => roles.has(id) || content.includes(`<@&${id}>`))
  )
}

/** Does this message satisfy the job's rules for this member? Pure. */
export function messageSatisfies(m: DiscordMessage, memberId: string, since: Date, req: JobRequirements): boolean {
  return inWindowFromMember(m, memberId, since) && mentionsOk(m, req) && (!req.needsMedia || hasMedia(m))
}

export type VerifyResult =
  | { ok: true; verified: boolean; messageId?: string; channelId?: string }
  | { ok: false; reason: 'not_found'; channelId: string; channelIds: string[] }
  | { ok: false; reason: 'reused'; channelId: string }
  | { ok: false; reason: 'channel_unavailable'; channelId: string }
  | { ok: false; reason: 'unreachable' }

/** Discord is down, rate limiting us, or answered something unexpected: try again later. */
class Unreachable extends Error {}
/** 403/404: the bot cannot see the channel, or it is gone. Not going to fix itself in a minute. */
class Permanent extends Error {
  constructor(public status: number) {
    super(`status ${status}`)
  }
}

type Sleep = (ms: number) => Promise<void>
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- short-lived caches shared by every member (module level) ----
const channelTypes = new Map<string, { type: number; at: number }>()
const failures = new Map<string, { status: number; at: number }>()
const messageCache = new Map<string, { at: number; value: Promise<DiscordMessage[]> }>()
const threadCache = new Map<string, { at: number; value: Promise<Thread[]> }>()

/** Test hook: forget everything cached. */
export function __resetJobsVerifyCache() {
  channelTypes.clear()
  failures.clear()
  messageCache.clear()
  threadCache.clear()
}

interface Thread {
  id: string
  parent_id?: string
  last_message_id?: string | null
}

interface Ctx {
  token: string
  guildId: string
  fetchImpl: typeof fetch
  sleep: Sleep
  after: bigint
  since: Date
}

async function discordGet<T>(url: string, ctx: Pick<Ctx, 'token' | 'fetchImpl' | 'sleep'>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await ctx.fetchImpl(url, { headers: { Authorization: `Bot ${ctx.token}` } })
    } catch {
      throw new Unreachable('network')
    }
    if (res.status === 429) {
      if (attempt > 0) throw new Unreachable('rate limited')
      let wait = 1
      try {
        wait = Number(((await res.json()) as { retry_after?: number }).retry_after ?? 1)
      } catch {
        // keep the default
      }
      if (!(wait <= 5)) throw new Unreachable('rate limited for too long')
      await ctx.sleep(Math.ceil(wait * 1000))
      continue
    }
    if (res.status === 403 || res.status === 404) throw new Permanent(res.status)
    if (!res.ok) throw new Unreachable(`status ${res.status}`)
    return (await res.json()) as T
  }
}

function dayStartSnowflake(since: Date): bigint {
  return (BigInt(since.getTime()) - DISCORD_EPOCH) * BigInt(4194304)
}

const bigId = (id: string | null | undefined): bigint => {
  try {
    return id ? BigInt(id) : BigInt(0)
  } catch {
    return BigInt(0)
  }
}

function cached<T>(map: Map<string, { at: number; value: Promise<T> }>, key: string, ttl: number, fresh: boolean, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key)
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.value
  const value = load()
  map.set(key, { at: Date.now(), value })
  value.catch(() => {
    if (map.get(key)?.value === value) map.delete(key)
  })
  return value
}

function assertNotFailing(channelId: string) {
  const f = failures.get(channelId)
  if (f && Date.now() - f.at < FAILURE_CACHE_MS) throw new Permanent(f.status)
}

function rememberPermanent(channelId: string, e: unknown) {
  if (e instanceof Permanent && !failures.has(channelId)) {
    console.warn(`[jobs-verify] channel ${channelId} cannot be read (status ${e.status}); check the bot's access`)
  }
  if (e instanceof Permanent) failures.set(channelId, { status: e.status, at: Date.now() })
}

async function channelType(channelId: string, ctx: Ctx): Promise<number> {
  const hit = channelTypes.get(channelId)
  if (hit && Date.now() - hit.at < CHANNEL_TYPE_CACHE_MS) return hit.type
  const c = await discordGet<{ type: number }>(`${DISCORD_API}/channels/${channelId}`, ctx)
  channelTypes.set(channelId, { type: c.type, at: Date.now() })
  return c.type
}

/** Today's messages in a channel or thread, oldest first, via after= paging. */
function messagesToday(channelId: string, ctx: Ctx, fresh: boolean): Promise<DiscordMessage[]> {
  return cached(messageCache, `${channelId}:${ctx.since.getTime()}`, MESSAGE_CACHE_MS, fresh, async () => {
    const out: DiscordMessage[] = []
    let after = ctx.after
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await discordGet<DiscordMessage[]>(`${DISCORD_API}/channels/${channelId}/messages?limit=${PAGE}&after=${after}`, ctx)
      if (!Array.isArray(batch) || batch.length === 0) break
      batch.sort((a, b) => (bigId(a.id) < bigId(b.id) ? -1 : 1))
      out.push(...batch)
      if (batch.length < PAGE) break
      after = bigId(batch[batch.length - 1].id)
    }
    return out
  })
}

/** Threads under a channel with activity today: newest first, at most MAX_THREADS. Forum channels also list recent archived ones. */
function threadsOf(channelId: string, forum: boolean, ctx: Ctx, fresh: boolean): Promise<Thread[]> {
  return cached(threadCache, `${channelId}:${forum}`, MESSAGE_CACHE_MS, fresh, async () => {
    const all = new Map<string, Thread>()
    try {
      const active = await discordGet<{ threads?: Thread[] }>(`${DISCORD_API}/guilds/${ctx.guildId}/threads/active`, ctx)
      for (const t of active.threads ?? []) if (t.parent_id === channelId) all.set(t.id, t)
    } catch (e) {
      if (forum) throw e // a forum is only its threads
    }
    if (forum) {
      const archived = await discordGet<{ threads?: Thread[] }>(`${DISCORD_API}/channels/${channelId}/threads/archived/public?limit=25`, ctx)
      for (const t of archived.threads ?? []) all.set(t.id, t)
    }
    return [...all.values()]
      .filter((t) => !t.last_message_id || bigId(t.last_message_id) > ctx.after)
      .sort((a, b) => (bigId(a.last_message_id ?? a.id) < bigId(b.last_message_id ?? b.id) ? 1 : -1))
      .slice(0, MAX_THREADS)
  })
}

export interface VerifyOptions {
  memberId: string
  description: string
  since: Date
  /** Posts that already paid a job today; they cannot pay another. */
  usedMessageIds?: Iterable<string>
  fetchImpl?: typeof fetch
  sleep?: Sleep
}

interface Scan {
  found?: DiscordMessage & { where: string }
  usedMatch: boolean
  mediaMaybeLate: boolean
  permanent: number
}

/** Check the member's post for a job. Never throws; Discord problems give { reason: 'unreachable' }. */
export async function verifyJobPost(opts: VerifyOptions): Promise<VerifyResult> {
  const req = parseJobRequirements(opts.description)
  if (req.channelIds.length === 0) return { ok: true, verified: false }

  const token = process.env.DISCORD_BOT_TOKEN
  const guildId = process.env.DISCORD_GUILD_ID
  if (!token || !guildId) return { ok: false, reason: 'unreachable' }
  const ctx: Ctx = {
    token,
    guildId,
    fetchImpl: opts.fetchImpl ?? fetch,
    sleep: opts.sleep ?? realSleep,
    after: dayStartSnowflake(opts.since),
    since: opts.since,
  }
  const used = new Set(opts.usedMessageIds ?? [])

  const scan = async (fresh: boolean): Promise<Scan> => {
    const s: Scan = { usedMatch: false, mediaMaybeLate: false, permanent: 0 }
    for (const channelId of req.channelIds) {
      let targets: string[]
      try {
        assertNotFailing(channelId)
        const forum = FORUM_TYPES.includes(await channelType(channelId, ctx))
        const threads = await threadsOf(channelId, forum, ctx, fresh)
        targets = [...(forum ? [] : [channelId]), ...threads.map((t) => t.id)]
        if (!forum) assertNotFailing(channelId)
      } catch (e) {
        if (e instanceof Permanent) {
          rememberPermanent(channelId, e)
          s.permanent++
          continue
        }
        throw e
      }
      for (const target of targets) {
        let messages: DiscordMessage[]
        try {
          messages = await messagesToday(target, ctx, fresh)
        } catch (e) {
          if (e instanceof Permanent) {
            // The channel itself unreadable is a setup problem; one odd thread is not.
            if (target === channelId) {
              rememberPermanent(channelId, e)
              s.permanent++
            }
            continue
          }
          throw e
        }
        for (const m of messages) {
          if (messageSatisfies(m, opts.memberId, opts.since, req)) {
            if (used.has(m.id)) s.usedMatch = true
            else if (!s.found) s.found = { ...m, where: target }
          } else if (req.needsMedia && inWindowFromMember(m, opts.memberId, opts.since) && mentionsOk(m, req) && lacksAnyMediaField(m)) {
            s.mediaMaybeLate = true
          }
        }
        if (s.found) return s
      }
    }
    return s
  }

  try {
    let s = await scan(false)
    if (!s.found && s.mediaMaybeLate) {
      // Embeds can arrive a moment after the message: look once more, uncached.
      await ctx.sleep(EMBED_RETRY_MS)
      s = await scan(true)
    }
    if (s.found) return { ok: true, verified: true, messageId: s.found.id, channelId: s.found.where }
    if (s.usedMatch) return { ok: false, reason: 'reused', channelId: req.channelIds[0] }
    if (s.permanent >= req.channelIds.length) return { ok: false, reason: 'channel_unavailable', channelId: req.channelIds[0] }
    return { ok: false, reason: 'not_found', channelId: req.channelIds[0], channelIds: req.channelIds }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

/** Verification is ON unless the env var kills it or the saved setting is off. An unreadable setting keeps it ON. */
export async function verifyPostsEnabled(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (envKillsToggle(env.JOBS_VERIFY_POSTS)) return false
  const settings = await loadSettings()
  if (settings.readFailed || settings.invalidKeys.includes('jobs.verifyPosts')) return true
  return resolveToggle('jobs.verifyPosts', settings, env)
}

/** Whether jobs that name no channel pay on click (an unreadable setting means no). */
export async function unverifiablePayOnClick(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  return resolveToggle('jobs.unverifiableJobsPayOnClick', await loadSettings(), env)
}
