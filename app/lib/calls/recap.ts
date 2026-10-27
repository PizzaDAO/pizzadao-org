/**
 * Discord recap of a published call (call-recap). Nothing is posted until an admin publishes the
 * call on /admin/calls; posting is then gated by CALL_RECAP_POST_ENABLED (off by default). The text
 * is built from the stored (reviewed) title / summary / action items. The AI summary is generated
 * from the transcript with redactions applied, but a redaction made AFTER the summary was generated
 * (or last edited by a reviewer) is not reflected in it, so posting is blocked until the summary is
 * regenerated or edited (see redactionsNewerThanSummary).
 *
 * Channel: Community Call -> the announcements channel (same as the pre-call announcement);
 * every other crew -> the crew's `Channel` cell in the Crew Mappings sheet (id, discord.com/channels
 * link or channel name).
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { DEFAULT_ANNOUNCE_CHANNEL_ID } from '@/app/lib/announce/run'
import { getChannel, getGuildChannels, normalizeChannelName } from '@/app/lib/discord-channels'
import { DISCORD_MESSAGE_LIMIT, DiscordPostError, postDiscordMessage } from '@/app/lib/discord-rest'
import { isCrewExcluded, mentionsApac } from '@/app/lib/calls/excluded-crews'
import { SITE_URL } from '@/app/lib/site-url'

export const COMMUNITY_CALL_CREW_ID = 'community_call'
const MAX_BULLETS = 5
const MAX_ACTIONS = 5
const BULLET_CHARS = 220

export function recapPostingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.CALL_RECAP_POST_ENABLED?.trim() ?? '')
}

export interface RecapInput {
  id: string
  title: string | null
  eventName?: string | null
  crewLabel: string | null
  summary: string | null
  actionItems: unknown
  chapters?: unknown
}

const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim()
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

/** 3-6 short bullets: the summary's first sentences, or the chapter titles when the summary is too short to split. */
export function recapBullets(summary: string | null, chapters: unknown): string[] {
  const sentences = oneLine(summary ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && !mentionsApac(s))
  if (sentences.length >= 3) return sentences.slice(0, MAX_BULLETS).map((s) => clip(s, BULLET_CHARS))
  const titles = (Array.isArray(chapters) ? chapters : [])
    .map((c) => (c && typeof c === 'object' && typeof (c as { title?: unknown }).title === 'string' ? oneLine((c as { title: string }).title) : ''))
    .filter((t) => t && !mentionsApac(t))
  if (titles.length >= 3) return titles.slice(0, MAX_BULLETS + 1).map((s) => clip(s, BULLET_CHARS))
  return sentences.slice(0, MAX_BULLETS).map((s) => clip(s, BULLET_CHARS))
}

/** How many summary sentences / chapter titles / action items the Discord text leaves out because they mention APAC (the stored summary is untouched). */
export function recapApacOmissions(rec: Pick<RecapInput, 'summary' | 'actionItems' | 'chapters'>): number {
  const sentences = oneLine(rec.summary ?? '').split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 3 && mentionsApac(s)).length
  const chapters = (Array.isArray(rec.chapters) ? rec.chapters : []).filter((c) => mentionsApac((c as { title?: unknown })?.title as string)).length
  const actions = (Array.isArray(rec.actionItems) ? rec.actionItems : []).filter((a) => {
    const o = a as { text?: unknown; owner?: unknown }
    return mentionsApac(typeof o?.text === 'string' ? o.text : '') || mentionsApac(typeof o?.owner === 'string' ? o.owner : '')
  }).length
  return sentences + chapters + actions
}

/** A recap is never posted for an excluded crew (default: PizzaDAO APAC). */
export function recapCrewExcluded(rec: { crewId?: string | null; crewLabel?: string | null }, env?: Record<string, string | undefined>): boolean {
  return isCrewExcluded({ id: rec.crewId, label: rec.crewLabel }, env)
}

export function recapUrl(id: string, base: string = SITE_URL): string {
  return `${base.replace(/\/$/, '')}/calls/${encodeURIComponent(id)}`
}

/** The Discord message text. Always within Discord's 2000-character limit. */
export function buildRecapText(rec: RecapInput, base: string = SITE_URL): string {
  const title = clip(oneLine(rec.title ?? rec.eventName ?? rec.crewLabel ?? 'Call recap'), 120)
  const bullets = recapBullets(rec.summary, rec.chapters)
  const actions = (Array.isArray(rec.actionItems) ? rec.actionItems : [])
    .map((a) => {
      const o = a as { text?: unknown; owner?: unknown }
      const text = typeof o?.text === 'string' ? oneLine(o.text) : ''
      const owner = typeof o?.owner === 'string' ? oneLine(o.owner) : ''
      return text && !mentionsApac(text) && !mentionsApac(owner) ? `${clip(text, BULLET_CHARS)}${owner ? ` (${clip(owner, 40)})` : ''}` : ''
    })
    .filter(Boolean)
    .slice(0, MAX_ACTIONS)
  const url = recapUrl(rec.id, base)
  const lines = [`**Call recap: ${title}**`]
  if (bullets.length) lines.push('', ...bullets.map((b) => `- ${b}`))
  if (actions.length) lines.push('', '**Action items**', ...actions.map((a) => `- ${a}`))
  lines.push('', `Full summary and transcript: ${url}`)
  let text = lines.join('\n')
  // Safety net: drop trailing bullets until it fits (the link line must survive).
  while (text.length > DISCORD_MESSAGE_LIMIT && lines.length > 3) {
    const at = lines.length - 3
    lines.splice(at, 1)
    text = lines.join('\n')
  }
  return text.length > DISCORD_MESSAGE_LIMIT ? `**Call recap: ${clip(title, 80)}**\n\nFull summary and transcript: ${url}` : text
}

const SNOWFLAKE = /^\d{5,25}$/

/** The channel (and guild, when the cell is a link) inside a crew's `Channel` cell, else null. */
export function parseChannelCell(cell: string | null | undefined): { channelId: string; guildId: string | null } | null {
  const raw = (cell ?? '').trim()
  if (!raw) return null
  if (SNOWFLAKE.test(raw)) return { channelId: raw, guildId: null }
  const link = raw.match(/discord(?:app)?\.com\/channels\/(\d{5,25})\/(\d{5,25})/)
  if (link) return { channelId: link[2], guildId: link[1] }
  const mention = raw.match(/^<#(\d{5,25})>$/)
  return mention ? { channelId: mention[1], guildId: null } : null
}

/** Kept for callers that only want the id. */
export const channelIdFromCell = (cell: string | null | undefined): string | null => parseChannelCell(cell)?.channelId ?? null

/** Text (0) and announcement (5) channels only: the only kinds a recap can be posted to. */
const POSTABLE_TYPES = new Set([0, 5])

export interface RecapChannel {
  channelId: string
  label: string
}

export interface RecapDeps {
  crews?: () => Promise<Array<{ id: string; channel?: string }>>
  /** Exact-name lookup among the guild's text/announcement channels. */
  resolveName?: (name: string) => Promise<string | null>
  /** The guild and type of a channel id, or null when it is unknown. */
  lookupChannel?: (id: string) => Promise<{ guildId: string | null; type?: number } | null>
  env?: Record<string, string | undefined>
}

async function defaultResolveName(name: string): Promise<string | null> {
  const channels = await getGuildChannels()
  const want = normalizeChannelName(name)
  if (!channels || !want) return null
  return channels.find((c) => POSTABLE_TYPES.has(c.type) && normalizeChannelName(c.name) === want)?.id ?? null
}

async function defaultLookupChannel(id: string): Promise<{ guildId: string | null; type?: number } | null> {
  const c = await getChannel(id)
  return c && c !== 'unknown' ? { guildId: c.guildId, type: c.type } : null
}

/**
 * Where this call's recap goes, or null when the crew has no usable channel. A sheet cell is
 * untrusted: links must point into our guild, bare ids are verified to be a text/announcement
 * channel of our guild, and names must match a channel name exactly (no suffix guessing).
 */
export async function resolveRecapChannel(crewId: string | null, deps: RecapDeps = {}): Promise<RecapChannel | null> {
  const env = deps.env ?? process.env
  if (crewId === COMMUNITY_CALL_CREW_ID) {
    const id = (env.ANNOUNCE_DISCORD_CHANNEL_ID?.trim() || DEFAULT_ANNOUNCE_CHANNEL_ID).replace(/\D/g, '')
    return id ? { channelId: id, label: '#announcements' } : null
  }
  if (!crewId) return null
  const guild = env.DISCORD_GUILD_ID?.trim()
  if (!guild) return null
  const crews = await (deps.crews ?? (async () => (await getCrewMappings()).crews))()
  const cell = crews.find((c) => c.id === crewId)?.channel
  const parsed = parseChannelCell(cell)
  if (parsed) {
    if (parsed.guildId && parsed.guildId !== guild) return null
    const info = await (deps.lookupChannel ?? defaultLookupChannel)(parsed.channelId)
    if (!info || info.guildId !== guild || (info.type !== undefined && !POSTABLE_TYPES.has(info.type))) return null
    return { channelId: parsed.channelId, label: `#${parsed.channelId}` }
  }
  const name = (cell ?? '').replace(/^#/, '').trim()
  if (!name) return null
  const id = await (deps.resolveName ?? defaultResolveName)(name)
  return id ? { channelId: id, label: `#${name}` } : null
}

/** True when a speaker/line was hidden or restored after the summary was last generated or edited. */
export function redactionsNewerThanSummary(rec: { redactionsUpdatedAt?: Date | null; summaryGeneratedAt?: Date | null; summaryEditedAt?: Date | null }): boolean {
  if (!rec.redactionsUpdatedAt) return false
  const fresh = Math.max(rec.summaryGeneratedAt?.getTime() ?? 0, rec.summaryEditedAt?.getTime() ?? 0)
  return rec.redactionsUpdatedAt.getTime() > fresh
}

export type RecapResult = 'posted' | 'disabled' | 'already-posted' | 'not-published' | 'excluded' | 'stale-redactions' | 'no-channel' | 'no-token' | 'failed'

export interface PostRecapDeps extends RecapDeps {
  post?: typeof postDiscordMessage
  base?: string
}

/**
 * Post the recap of a PUBLISHED call, at most once. The row is claimed (recapPostedAt) before the
 * post. The claim is released only when Discord definitely refused (a 4xx incl. 429: nothing was
 * posted); on a 5xx or network error the message may exist, so the claim stays and the error is
 * recorded for a human to look at.
 */
export async function postCallRecap(id: string, deps: PostRecapDeps = {}): Promise<RecapResult> {
  const env = deps.env ?? process.env
  if (!recapPostingEnabled(env)) return 'disabled'
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) return 'no-token'
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      crewId: true,
      crewLabel: true,
      eventName: true,
      title: true,
      summary: true,
      actionItems: true,
      chapters: true,
      recapPostedAt: true,
      redactionsUpdatedAt: true,
      summaryGeneratedAt: true,
      summaryEditedAt: true,
    },
  })
  if (rec && recapCrewExcluded(rec, env)) return 'excluded'
  if (!rec || rec.status !== 'PUBLISHED' || !rec.summary?.trim()) return 'not-published'
  if (rec.recapPostedAt) return 'already-posted'
  if (redactionsNewerThanSummary(rec)) return 'stale-redactions'
  const channel = await resolveRecapChannel(rec.crewId, deps)
  if (!channel) return 'no-channel'
  const claim = await prisma.callRecording.updateMany({ where: { id, recapPostedAt: null, status: 'PUBLISHED' }, data: { recapPostedAt: new Date(), recapChannelId: channel.channelId, recapError: null } })
  if (claim.count !== 1) return 'already-posted'
  let messageId: string | null
  try {
    const sent = await (deps.post ?? postDiscordMessage)(
      { kind: 'bot', channelId: channel.channelId, botToken },
      { content: buildRecapText(rec, deps.base), allowed_mentions: { parse: [] }, flags: 4 /* SUPPRESS_EMBEDS */ },
    )
    messageId = sent.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[calls/recap] post failed:', msg)
    if (err instanceof DiscordPostError && err.status >= 400 && err.status < 500) {
      await prisma.callRecording.updateMany({ where: { id }, data: { recapPostedAt: null, recapChannelId: null, recapError: msg.slice(0, 300) } })
    } else {
      // Unknown outcome: the message may have been posted. Keep the claim (no automatic repost).
      await prisma.callRecording.updateMany({ where: { id }, data: { recapError: `unknown outcome: ${msg}`.slice(0, 300) } })
    }
    return 'failed'
  }
  // The post succeeded; bookkeeping trouble must never release the claim or look like a failed post.
  if (messageId) await prisma.callRecording.update({ where: { id }, data: { recapMessageId: messageId } }).catch((e) => console.error('[calls/recap] could not store message id:', e instanceof Error ? e.message : e))
  return 'posted'
}
