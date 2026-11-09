/**
 * Verify that a member really did a daily job before it pays.
 *
 * A job description is Discord markup ("Share a movie in <#channel> and tag <@user>"). The rules
 * below are derived from it and checked against the member's recent messages in the named channel
 * (GET only, through the bot). Jobs naming no channel cannot be checked (see the setting
 * jobs.unverifiableJobsPayOnClick). Fails closed: when Discord cannot be read, nothing pays.
 */
import { loadSettings } from './settings'
import { envKillsToggle, resolveToggle } from './settings/toggles'

const DISCORD_API = 'https://discord.com/api/v10'
/** Most messages read per channel (and per thread) for one check. */
export const MAX_MESSAGES = 300
const PAGE = 100
const MAX_THREADS = 5

/** The wording that asks for media, and what counts as media. One place to change the rules. */
export const MEDIA_WORDS = /\b(gifs?|images?|screenshots?|photos?|pictures?|videos?|results?)\b/i
const MEDIA_CONTENT_TYPE = /^(image|video)\//i
const MEDIA_FILENAME = /\.(gif|png|jpe?g|webp|mp4|mov|webm)$/i
const MEDIA_EMBED_TYPES = ['gifv', 'image', 'video']

export interface JobRequirements {
  channelIds: string[]
  userIds: string[]
  roleIds: string[]
  needsMedia: boolean
}

/** Derive what the post must contain from the job description. */
export function parseJobRequirements(description: string): JobRequirements {
  const uniq = (re: RegExp) => [...new Set([...description.matchAll(re)].map((m) => m[1]))]
  // Strip the markup so "<#id>" / "<@id>" do not count as words.
  const words = description.replace(/<[#@][!&]?\d+>/g, ' ')
  return {
    channelIds: uniq(/<#(\d{5,25})>/g),
    userIds: uniq(/<@!?(\d{5,25})>/g),
    roleIds: uniq(/<@&(\d{5,25})>/g),
    needsMedia: MEDIA_WORDS.test(words),
  }
}

export interface DiscordMessage {
  id: string
  channel_id?: string
  timestamp: string
  author?: { id: string }
  mentions?: { id: string }[]
  mention_roles?: string[]
  attachments?: { content_type?: string; filename?: string }[]
  embeds?: { type?: string }[]
}

function hasMedia(m: DiscordMessage): boolean {
  const att = (m.attachments ?? []).some(
    (a) => MEDIA_CONTENT_TYPE.test(a.content_type ?? '') || MEDIA_FILENAME.test(a.filename ?? ''),
  )
  return att || (m.embeds ?? []).some((e) => MEDIA_EMBED_TYPES.includes(e.type ?? ''))
}

/** Does this message satisfy the job's rules for this member? Pure. */
export function messageSatisfies(m: DiscordMessage, memberId: string, since: Date, req: JobRequirements): boolean {
  if (m.author?.id !== memberId) return false
  if (new Date(m.timestamp).getTime() < since.getTime()) return false
  const mentioned = new Set((m.mentions ?? []).map((u) => u.id))
  if (!req.userIds.every((id) => mentioned.has(id))) return false
  const roles = new Set(m.mention_roles ?? [])
  if (!req.roleIds.every((id) => roles.has(id))) return false
  if (req.needsMedia && !hasMedia(m)) return false
  return true
}

export type VerifyResult =
  | { ok: true; verified: boolean; messageId?: string; channelId?: string }
  | { ok: false; reason: 'not_found'; channelId: string; channelIds: string[] }
  | { ok: false; reason: 'unreachable' }

class Unreachable extends Error {}

async function getJson<T>(url: string, token: string, fetchImpl: typeof fetch): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bot ${token}` } })
  } catch {
    throw new Unreachable('network')
  }
  if (!res.ok) throw new Unreachable(`status ${res.status}`)
  return (await res.json()) as T
}

/** Page back through one channel (or thread) until a match, the window start or the cap. */
async function findInChannel(
  channelId: string,
  token: string,
  fetchImpl: typeof fetch,
  memberId: string,
  since: Date,
  req: JobRequirements,
): Promise<DiscordMessage | null> {
  let before: string | undefined
  let seen = 0
  while (seen < MAX_MESSAGES) {
    const qs = `limit=${PAGE}${before ? `&before=${before}` : ''}`
    const page = await getJson<DiscordMessage[]>(`${DISCORD_API}/channels/${channelId}/messages?${qs}`, token, fetchImpl)
    if (!Array.isArray(page) || page.length === 0) return null
    for (const m of page) {
      if (messageSatisfies(m, memberId, since, req)) return m
    }
    seen += page.length
    const oldest = page[page.length - 1]
    if (page.length < PAGE || new Date(oldest.timestamp).getTime() < since.getTime()) return null
    before = oldest.id
  }
  return null
}

export interface VerifyOptions {
  memberId: string
  description: string
  since: Date
  fetchImpl?: typeof fetch
}

/** Check the member's post for a job. Never throws; Discord problems give { reason: 'unreachable' }. */
export async function verifyJobPost(opts: VerifyOptions): Promise<VerifyResult> {
  const req = parseJobRequirements(opts.description)
  if (req.channelIds.length === 0) return { ok: true, verified: false }

  const token = process.env.DISCORD_BOT_TOKEN
  const guildId = process.env.DISCORD_GUILD_ID
  if (!token || !guildId) return { ok: false, reason: 'unreachable' }
  const fetchImpl = opts.fetchImpl ?? fetch

  try {
    let threads: { id: string; parent_id?: string }[] = []
    try {
      const active = await getJson<{ threads?: { id: string; parent_id?: string }[] }>(
        `${DISCORD_API}/guilds/${guildId}/threads/active`,
        token,
        fetchImpl,
      )
      threads = active.threads ?? []
    } catch {
      // Threads are best effort; the channel itself decides reachability below.
    }
    for (const channelId of req.channelIds) {
      const targets = [
        channelId,
        ...threads.filter((t) => t.parent_id === channelId).slice(0, MAX_THREADS).map((t) => t.id),
      ]
      for (const target of targets) {
        const found = await findInChannel(target, token, fetchImpl, opts.memberId, opts.since, req)
        if (found) return { ok: true, verified: true, messageId: found.id, channelId: target }
      }
    }
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
