/**
 * Discord recap of a published call (call-recap). Nothing is posted until an admin publishes the
 * call on /admin/calls; posting is then gated by calls.recapPostEnabled (off by default). The text
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
import { DISCORD_MESSAGE_LIMIT, DiscordPostError, editDiscordMessage, postDiscordMessage } from '@/app/lib/discord-rest'
import { EMPTY_POST_FILTER, isCrewExcluded, loadPostFilter, mentionsBlockedTerm, type PostFilter } from '@/app/lib/calls/post-filters'
import { SITE_URL } from '@/app/lib/site-url'
import { savedChannelId } from '@/app/lib/settings/channels'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { settingInt } from '@/app/lib/settings/numbers'
import { importedAllowed, isImportedSource } from '@/app/lib/calls/imported'
import { readEvidence } from '@/app/lib/calls/evidence'
import { enqueueMirror } from '@/app/lib/telegram/city-posts'

export const COMMUNITY_CALL_CREW_ID = 'community_call'

/** How long a recap may be (settings calls.recap*; Discord's 2000-character limit is enforced regardless). */
export interface RecapLimits {
  bullets: number
  actions: number
  chars: number
}

export const DEFAULT_RECAP_LIMITS: RecapLimits = { bullets: 5, actions: 10, chars: 220 }

export function recapLimits(settings?: Settings): RecapLimits {
  return {
    bullets: settingInt('calls.recapMaxBullets', settings),
    actions: settingInt('calls.recapMaxActions', settings),
    chars: settingInt('calls.recapBulletChars', settings),
  }
}

/**
 * Whether recaps are posted: the admin setting `calls.recapPostEnabled`, with CALL_RECAP_POST_ENABLED
 * as the fallback while none is saved and, set to off, a kill switch. Unreadable settings: off.
 */
export function recapPostingEnabled(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  return toggleEnabled('calls.recapPostEnabled', env)
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
export function recapBullets(summary: string | null, chapters: unknown, filter: PostFilter = EMPTY_POST_FILTER, limits: RecapLimits = DEFAULT_RECAP_LIMITS): string[] {
  const sentences = oneLine(summary ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && !mentionsBlockedTerm(s, filter))
  if (sentences.length >= 3) return sentences.slice(0, limits.bullets).map((s) => clip(s, limits.chars))
  const titles = (Array.isArray(chapters) ? chapters : [])
    .map((c) => (c && typeof c === 'object' && typeof (c as { title?: unknown }).title === 'string' ? oneLine((c as { title: string }).title) : ''))
    .filter((t) => t && !mentionsBlockedTerm(t, filter))
  if (titles.length >= 3) return titles.slice(0, limits.bullets + 1).map((s) => clip(s, limits.chars))
  return sentences.slice(0, limits.bullets).map((s) => clip(s, limits.chars))
}

/** How many summary sentences / chapter titles / action items the Discord text leaves out because of the blocked terms (the stored summary is untouched). */
export function recapFilteredCount(rec: Pick<RecapInput, 'summary' | 'actionItems' | 'chapters'>, filter: PostFilter): number {
  const sentences = oneLine(rec.summary ?? '').split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 3 && mentionsBlockedTerm(s, filter)).length
  const chapters = (Array.isArray(rec.chapters) ? rec.chapters : []).filter((c) => mentionsBlockedTerm((c as { title?: unknown })?.title as string, filter)).length
  const actions = (Array.isArray(rec.actionItems) ? rec.actionItems : []).filter((a) => {
    const o = a as { text?: unknown; owner?: unknown; suggestedBy?: unknown }
    return mentionsBlockedTerm(typeof o?.text === 'string' ? o.text : '', filter) || mentionsBlockedTerm(typeof o?.owner === 'string' ? o.owner : '', filter) || mentionsBlockedTerm(typeof o?.suggestedBy === 'string' ? o.suggestedBy : '', filter)
  }).length
  return sentences + chapters + actions
}

/** A recap is never posted for an excluded crew. */
export function recapCrewExcluded(rec: { crewId?: string | null; crewLabel?: string | null }, filter: PostFilter): boolean {
  return isCrewExcluded({ id: rec.crewId, label: rec.crewLabel }, filter)
}

export function recapUrl(id: string, base: string = SITE_URL): string {
  return `${base.replace(/\/$/, '')}/calls/${encodeURIComponent(id)}`
}

/** A person the recap may mention: the call's speakers first, then (for action-item names) the members directory. */
export interface RecapPeople {
  speakers: Array<{ discordId: string; displayName: string | null }>
  members: Array<{ discordId: string; name: string }>
}

/** Ids the recap inserted as mentions, with the name each stands for (only these may ever be pinged). */
export type RecapMentions = Map<string, string>

export const MAX_MENTION_USERS = 25
const MENTION_RE = /<@(\d{5,25})>/g
/** Any user / nickname / role mention already in stored text. */
const ANY_MENTION_RE = /<@[!&]?\d+>/g
/** Names that are never mentioned (the bot / the AI), whatever the call's speakers say. */
const NEVER_MENTION = new Set(['metalhead', 'claude', 'pepperoni bot', 'bot'])
/** Placeholder owners that never mean one person. */
const GENERIC_NAMES = new Set(['team', 'everyone', 'everybody', 'tbd', 'tba', 'all', 'anyone', 'someone', 'nobody', 'none', 'unassigned', 'we', 'group', 'crew', 'na', 'n a'])
/** Words that are not accepted as a lone first-name match inside a sentence. */
const STOPWORDS = new Set([...GENERIC_NAMES, 'the', 'pizza', 'will', 'they', 'you', 'dao', 'and', 'for', 'this', 'that', 'new', 'call', 'admin', 'host', 'guest', 'pep', 'community', 'ops', 'mod', 'mods', 'she', 'her', 'his', 'him', 'our', 'with', 'from'])

/** Lower-case letters, digits and single spaces only (emoji, punctuation and decoration dropped). */
export const normalizeName = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()
const isBotName = (n: string) => NEVER_MENTION.has(n) || /\bbot$/.test(n)
/** A normalized name that must never become a mention (bot, placeholder, digits only, or a lone stopword). */
const isUnmentionable = (n: string) => !n || isBotName(n) || GENERIC_NAMES.has(n) || /^\d+$/.test(n) || (!n.includes(' ') && STOPWORDS.has(n))
const firstWord = (n: string) => n.split(' ')[0] ?? ''
const neutralName = (n: string | null | undefined) => oneLine((n ?? '').replace(ANY_MENTION_RE, '@user'))

/** Replace mention markup already present in stored text (a speaker's name when known, else "@user"), so only the code below creates mentions. */
export function neutralizeMentions(text: string, people?: RecapPeople): string {
  return text.replace(ANY_MENTION_RE, (m) => {
    const id = m.match(/\d+/)![0]
    const known = m.startsWith('<@&') ? null : people?.speakers.find((s) => s.discordId === id)?.displayName
    return known ? neutralName(known) || '@user' : '@user'
  })
}

interface Mentionable { id: string; name: string; first: string | null; display: string }

/** Speakers that can be mentioned: a real member id, not a bot or placeholder; first word only when it is a real name word nobody else shares. */
function mentionableSpeakers(people: RecapPeople | undefined): Mentionable[] {
  const rows: Mentionable[] = []
  for (const sp of people?.speakers ?? []) {
    const name = normalizeName(sp.displayName ?? '')
    if (!SNOWFLAKE.test(sp.discordId) || isUnmentionable(name)) continue
    rows.push({ id: sp.discordId, name, first: firstWord(name), display: neutralName(sp.displayName) })
  }
  const count = new Map<string, number>()
  for (const r of rows) count.set(r.first!, (count.get(r.first!) ?? 0) + 1)
  return rows.map((r) => ({ ...r, first: r.first && r.first.length >= 3 && count.get(r.first) === 1 && !STOPWORDS.has(r.first) && !isBotName(r.first) && !/^\d+$/.test(r.first) ? r.first : null }))
}

/**
 * The Discord id a name refers to, or null. The call's speakers first (full name, then a unique first
 * word), then the members directory (exact after normalizing; null when it is ambiguous). Bots,
 * placeholders (Team, Everyone, TBD...) and ambiguous names resolve to null.
 */
export function resolveMentionId(rawName: string, people: RecapPeople | undefined): string | null {
  const name = normalizeName(rawName)
  if (!people || isUnmentionable(name)) return null
  const speakers = mentionableSpeakers(people)
  const full = [...new Set(speakers.filter((s) => s.name === name).map((s) => s.id))]
  if (full.length === 1) return full[0]
  if (full.length > 1) return null
  const byFirst = speakers.filter((s) => s.first === name)
  if (byFirst.length === 1) return byFirst[0].id
  const members = [...new Set(people.members.filter((m) => SNOWFLAKE.test(m.discordId) && normalizeName(m.name) === name).map((m) => m.discordId))]
  return members.length === 1 ? members[0] : null
}

/** Whether an action item's owner and suggester are the same person (same normalized name, or the same resolved Discord id). */
export function sameActionPerson(owner: string, by: string, people?: RecapPeople): boolean {
  const a = normalizeName(owner)
  const b = normalizeName(by)
  if (!a || !b) return false
  if (a === b) return true
  const ia = resolveMentionId(owner, people)
  return !!ia && ia === resolveMentionId(by, people)
}

/** What to show for an id: the speaker's display name, else the member's name. */
function nameFor(id: string, people: RecapPeople | undefined): string {
  return neutralName(people?.speakers.find((s) => s.discordId === id)?.displayName ?? people?.members.find((m) => m.discordId === id)?.name) || 'user'
}

/** Action-item owner / suggestedBy: each name in "Ann, Bob" or "Ann & Bob" becomes a mention when it resolves. */
export function mentionNames(raw: string, people: RecapPeople | undefined, out?: RecapMentions): string {
  if (!people) return raw
  const parts = raw.split(/(\s*(?:,|&|\/|\band\b)\s*)/i)
  return parts.map((part, i) => {
    if (i % 2 === 1) return part
    const id = resolveMentionId(part, people)
    if (!id) return part
    out?.set(id, nameFor(id, people))
    return `<@${id}>`
  }).join('')
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const CAPITAL_START = /^[\p{Lu}\p{Lt}\p{N}]/u

/**
 * Replace the first occurrence per speaker of that speaker's name (or unique first word) in a bullet
 * with a mention. One pass over all speakers, longest name first; whole words only; every matched
 * word must start with a capital so common words ("will", "pizza") are not taken for people.
 */
export function mentionInBullet(text: string, people: RecapPeople | undefined, out?: RecapMentions): string {
  const key = new Map<string, string>() // normalized phrase -> id ('' when two speakers share it)
  const add = (k: string, id: string) => key.set(k, key.has(k) && key.get(k) !== id ? '' : id)
  for (const sp of mentionableSpeakers(people)) {
    add(sp.name, sp.id)
    if (sp.first) add(sp.first, sp.id)
  }
  const phrases = [...key.entries()].filter(([, id]) => id).map(([k]) => k).sort((a, b) => b.length - a.length)
  if (!phrases.length) return text
  // Spaces in a name match any run of non-letters, so "Enzo Pepperoni" also matches "Enzo-Pepperoni".
  const alt = phrases.map((p) => p.split(' ').map(escapeRe).join('[^\\p{L}\\p{N}]+')).join('|')
  const re = new RegExp(`(?<![\\p{L}\\p{N}@<])(?:${alt})(?![\\p{L}\\p{N}>])`, 'giu')
  const done = new Set<string>()
  return text.replace(re, (m) => {
    const words = m.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    if (!words.every((w) => CAPITAL_START.test(w))) return m
    const id = key.get(normalizeName(m))
    if (!id || done.has(id)) return m
    done.add(id)
    out?.set(id, nameFor(id, people))
    return `<@${id}>`
  })
}

/** The unique user ids mentioned in a text. */
export function mentionedIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1]))]
}

/**
 * allowed_mentions for a recap: ping ONLY the ids the recap code inserted itself (never ids that
 * were already in stored text) when on; render them quietly when off.
 */
export function recapAllowedMentions(ids: readonly string[], ping: boolean): { parse: []; users?: string[] } {
  const users = [...new Set(ids)].slice(0, MAX_MENTION_USERS)
  return ping && users.length ? { parse: [], users } : { parse: [] }
}

/** Whether mentions in the recap notify (calls.recapMentionPing; default on, the env kill switch turns it off). */
export function recapMentionPing(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  return toggleEnabled('calls.recapMentionPing', env)
}

/**
 * Speakers of the recording plus the members directory rows for the action-item names the speakers
 * do not cover. Hidden (redacted) speakers and their ids never take part. Imported calls get nobody:
 * their recap shows plain names only.
 */
export async function loadRecapPeople(rec: { id: string; source?: string | null; actionItems: unknown; redactedSpeakerIds?: readonly string[] | null }): Promise<RecapPeople> {
  const none: RecapPeople = { speakers: [], members: [] }
  if (isImportedSource(rec.source)) return none
  const redacted = new Set(rec.redactedSpeakerIds ?? [])
  const hiddenIds = new Set<string>(redacted)
  let speakers: RecapPeople['speakers'] = []
  try {
    const rows = await prisma.callSpeaker.findMany({ where: { recordingId: rec.id }, select: { discordId: true, linkedDiscordId: true, displayName: true } })
    for (const r of rows) if (redacted.has(r.discordId) && r.linkedDiscordId) hiddenIds.add(r.linkedDiscordId)
    speakers = rows.filter((r) => !hiddenIds.has(r.discordId)).map((r) => ({ discordId: r.discordId, displayName: r.displayName }))
  } catch (err) {
    console.error('[calls/recap] speakers unavailable, no mentions:', err instanceof Error ? err.message : err)
    return none
  }
  const base: RecapPeople = { speakers, members: [] }
  const names = new Set<string>()
  for (const a of Array.isArray(rec.actionItems) ? rec.actionItems : []) {
    const o = a as { owner?: unknown; suggestedBy?: unknown }
    for (const v of [o?.owner, o?.suggestedBy]) {
      if (typeof v !== 'string') continue
      for (const part of oneLine(neutralizeMentions(v)).split(/\s*(?:,|&|\/|\band\b)\s*/i)) {
        const n = normalizeName(part)
        if (n && !isUnmentionable(n) && !resolveMentionId(part, base)) names.add(firstWord(n))
      }
    }
  }
  if (!names.size) return base
  try {
    // Candidates by first word (the database cannot normalize); uniqueness is judged on the normalized names in memory.
    const rows = await prisma.member.findMany({
      where: { discordId: { not: null }, mergedInto: null, OR: [...names].slice(0, 40).map((n) => ({ name: { contains: n, mode: 'insensitive' as const } })) },
      select: { discordId: true, name: true },
      take: 400,
    })
    return { speakers, members: rows.filter((m): m is { discordId: string; name: string } => !!m.discordId && !hiddenIds.has(m.discordId)) }
  } catch (err) {
    console.error('[calls/recap] members unavailable, speakers only:', err instanceof Error ? err.message : err)
    return base
  }
}

export interface RecapParts {
  text: string
  /** Ids the recap inserted as mentions and that are still in the final text, with their display names. */
  mentions: RecapMentions
}

/** Stored text with any pre-existing mention markup neutralized (the only mentions are the ones we add). */
function cleanRecapInput(rec: RecapInput, people?: RecapPeople): RecapInput {
  const s = (v: string | null | undefined) => (typeof v === 'string' ? neutralizeMentions(v, people) : v)
  const obj = (v: unknown, fields: string[]) => {
    if (!v || typeof v !== 'object') return v
    const o: Record<string, unknown> = { ...(v as Record<string, unknown>) }
    for (const f of fields) if (typeof o[f] === 'string') o[f] = neutralizeMentions(o[f] as string, people)
    return o
  }
  return {
    ...rec,
    title: s(rec.title) ?? null,
    eventName: s(rec.eventName),
    crewLabel: s(rec.crewLabel) ?? null,
    summary: s(rec.summary) ?? null,
    actionItems: Array.isArray(rec.actionItems) ? rec.actionItems.map((a) => obj(a, ['text', 'owner', 'suggestedBy'])) : rec.actionItems,
    chapters: Array.isArray(rec.chapters) ? rec.chapters.map((c) => obj(c, ['title'])) : rec.chapters,
  }
}

/** The recap text plus which mentions it contains. `mention: false` gives plain names (Telegram). Always within Discord's 2000-character limit. */
export function buildRecapParts(input: RecapInput, base: string = SITE_URL, filter: PostFilter = EMPTY_POST_FILTER, limits: RecapLimits = DEFAULT_RECAP_LIMITS, people?: RecapPeople, mention = true): RecapParts {
  const rec = cleanRecapInput(input, people)
  const who = mention ? people : undefined
  const found: RecapMentions = new Map()
  const title = clip(oneLine(rec.title ?? rec.eventName ?? rec.crewLabel ?? 'Call recap'), 120)
  const bullets = recapBullets(rec.summary, rec.chapters, filter, limits).map((b) => mentionInBullet(b, who, found))
  const actions = (Array.isArray(rec.actionItems) ? rec.actionItems : [])
    .map((a) => {
      const o = a as { text?: unknown; owner?: unknown; suggestedBy?: unknown; done?: unknown; evidence?: unknown }
      const done = o?.done === true
      // Masked links with <> around the URL (no embeds); only on done items. Long URLs are left out to keep the line short.
      const proof = done ? readEvidence(o.evidence).filter((e) => e.url.length <= 200).map((e) => `[${e.label.replace(/[\[\]()<>*_`~|\\]/g, '') || 'link'}](<${e.url}>)`) : []
      const ev = proof.length ? ` — ${proof.join(', ')}` : ''
      const text = typeof o?.text === 'string' ? oneLine(o.text) : ''
      const owner = typeof o?.owner === 'string' ? oneLine(o.owner) : ''
      const by = typeof o?.suggestedBy === 'string' ? oneLine(o.suggestedBy) : ''
      if (!text || mentionsBlockedTerm(text, filter) || mentionsBlockedTerm(owner, filter) || mentionsBlockedTerm(by, filter)) return null
      // One person who both suggested and owns it: say so once instead of "(Ann) — suggested by Ann".
      if (owner && by && sameActionPerson(owner, by, who)) return { done, line: `${clip(text, limits.chars)} — ${mentionNames(clip(owner, 40), who, found)} (suggested, owner)${ev}` }
      return { done, line: `${clip(text, limits.chars)}${owner ? ` (${mentionNames(clip(owner, 40), who, found)})` : ''}${by ? ` — suggested by ${mentionNames(clip(by, 40), who, found)}` : ''}${ev}` }
    })
    .filter((x): x is { done: boolean; line: string } => !!x)
    .slice(0, limits.actions)
  const actionLine = (a: { done: boolean; line: string }) => `${a.done ? '✅' : '-'} ${a.line}`
  const url = recapUrl(rec.id, base)
  const lines = [`**Call recap: ${title}**`]
  if (bullets.length) lines.push('', ...bullets.map((b) => `- ${b}`))
  const tail = ['', `Full summary and transcript: ${url}`]
  if (actions.length) {
    // As many whole action lines as fit under Discord's limit (the "+N more" note and the link line are reserved).
    const head = [...lines, '', '**Action items**']
    const len = (ls: string[]) => ls.join('\n').length
    const moreLine = (n: number) => `+${n} more on the call page`
    let kept = actions.length
    while (kept > 0) {
      const shown = actions.slice(0, kept).map(actionLine)
      const extra = kept < actions.length ? [moreLine(actions.length - kept)] : []
      if (len([...head, ...shown, ...extra, ...tail]) <= DISCORD_MESSAGE_LIMIT) break
      kept--
    }
    if (kept > 0) {
      lines.push('', '**Action items**', ...actions.slice(0, kept).map(actionLine))
      if (kept < actions.length) lines.push(moreLine(actions.length - kept))
    }
  }
  lines.push(...tail)
  let text = lines.join('\n')
  // Safety net: drop trailing bullets until it fits (the link line must survive).
  while (text.length > DISCORD_MESSAGE_LIMIT && lines.length > 3) {
    const at = lines.length - 3
    lines.splice(at, 1)
    text = lines.join('\n')
  }
  if (text.length > DISCORD_MESSAGE_LIMIT) text = `**Call recap: ${clip(title, 80)}**\n\nFull summary and transcript: ${url}`
  // Only ids we inserted and that survived the trimming.
  const mentions: RecapMentions = new Map([...found].filter(([id]) => text.includes(`<@${id}>`)))
  return { text, mentions }
}

/** The Discord message text (mentions of the call's speakers when `people` is given). */
export function buildRecapText(rec: RecapInput, base: string = SITE_URL, filter: PostFilter = EMPTY_POST_FILTER, limits: RecapLimits = DEFAULT_RECAP_LIMITS, people?: RecapPeople): string {
  return buildRecapParts(rec, base, filter, limits, people).text
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
    const id = ((await savedChannelId('discord.announceChannelId')) || env.ANNOUNCE_DISCORD_CHANNEL_ID?.trim() || DEFAULT_ANNOUNCE_CHANNEL_ID).replace(/\D/g, '')
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

export type RecapResult = 'posted' | 'disabled' | 'already-posted' | 'not-published' | 'excluded' | 'stale-redactions' | 'no-channel' | 'no-token' | 'imported' | 'failed'

export interface PostRecapDeps extends RecapDeps {
  post?: typeof postDiscordMessage
  base?: string
}

const RECAP_SELECT = {
  id: true,
  status: true,
  source: true,
  crewId: true,
  crewLabel: true,
  eventName: true,
  title: true,
  summary: true,
  actionItems: true,
  chapters: true,
  recapPostedAt: true,
  recapChannelId: true,
  recapMessageId: true,
  redactedSpeakerIds: true,
  redactionsUpdatedAt: true,
  summaryGeneratedAt: true,
  summaryEditedAt: true,
} as const

/**
 * The recap as Discord text (with mentions of the call's speakers / named members), the plain-name
 * text for the Telegram mirror (no <@id>), and the allowed_mentions to send with the Discord text.
 */
async function renderRecap(rec: RecapInput & { source?: string | null; redactedSpeakerIds?: readonly string[] | null }, filter: PostFilter, deps: PostRecapDeps): Promise<{ content: string; plain: string; allowedMentions: { parse: []; users?: string[] } }> {
  const env = deps.env ?? process.env
  const limits = recapLimits(await loadSettings())
  const people = await loadRecapPeople(rec)
  const parts = buildRecapParts(rec, deps.base, filter, limits, people)
  const plain = buildRecapParts(rec, deps.base, filter, limits, people, false).text
  const ping = await recapMentionPing(env)
  return { content: parts.text, plain, allowedMentions: recapAllowedMentions([...parts.mentions.keys()], ping) }
}

const EDIT_ERROR_PREFIX = 'edit failed: '

export type RepostResult = RecapResult | 'updated' | 'no-message'

/**
 * Re-render the recap of a published call and EDIT the Discord message already posted (the stored
 * recapChannelId / recapMessageId), e.g. after mentions were added or the summary was corrected.
 * Never posts a new message and never re-mirrors to Telegram. Without { edit: true } it is the
 * ordinary once-only post.
 */
export async function repostRecap(recordingId: string, opts: { edit?: boolean } = {}, deps: PostRecapDeps & { edit?: typeof editDiscordMessage } = {}): Promise<RepostResult> {
  if (!opts.edit) return postCallRecap(recordingId, deps)
  const env = deps.env ?? process.env
  if (!(await recapPostingEnabled(env))) return 'disabled'
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) return 'no-token'
  let filter: PostFilter
  try {
    filter = await loadPostFilter()
  } catch (err) {
    console.error('[calls/recap] post filter unavailable, not editing:', err instanceof Error ? err.message : err)
    return 'failed'
  }
  const rec = await prisma.callRecording.findUnique({ where: { id: recordingId }, select: RECAP_SELECT })
  if (!rec || rec.status !== 'PUBLISHED' || !rec.summary?.trim()) return 'not-published'
  if (isImportedSource(rec.source) && !(await importedAllowed('calls.importedRecapPostEnabled', env))) return 'imported'
  if (recapCrewExcluded(rec, filter)) return 'excluded'
  if (redactionsNewerThanSummary(rec)) return 'stale-redactions'
  if (!rec.recapPostedAt || !rec.recapChannelId || !rec.recapMessageId) return 'no-message'
  try {
    const r = await renderRecap(rec, filter, deps)
    await (deps.edit ?? editDiscordMessage)(
      { channelId: rec.recapChannelId, messageId: rec.recapMessageId, botToken },
      { content: r.content, allowed_mentions: r.allowedMentions, flags: 4 /* SUPPRESS_EMBEDS */ },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[calls/recap] edit failed:', msg)
    // Keep an earlier note (e.g. the original post's error); only an edit note is replaced.
    await prisma.callRecording.updateMany({ where: { id: recordingId, OR: [{ recapError: null }, { recapError: { startsWith: EDIT_ERROR_PREFIX } }] }, data: { recapError: `${EDIT_ERROR_PREFIX}${msg}`.slice(0, 300) } })
    return 'failed'
  }
  await prisma.callRecording.updateMany({ where: { id: recordingId, recapError: { startsWith: EDIT_ERROR_PREFIX } }, data: { recapError: null } }).catch(() => {})
  return 'updated'
}

/**
 * Post the recap of a PUBLISHED call, at most once. The row is claimed (recapPostedAt) before the
 * post. The claim is released only when Discord definitely refused (a 4xx incl. 429: nothing was
 * posted); on a 5xx or network error the message may exist, so the claim stays and the error is
 * recorded for a human to look at.
 */
export async function postCallRecap(id: string, deps: PostRecapDeps = {}): Promise<RecapResult> {
  const env = deps.env ?? process.env
  if (!(await recapPostingEnabled(env))) return 'disabled'
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) return 'no-token'
  // Fail-safe: if the filter cannot be read, post nothing rather than an unfiltered recap.
  let filter: PostFilter
  try {
    filter = await loadPostFilter()
  } catch (err) {
    console.error('[calls/recap] post filter unavailable, not posting:', err instanceof Error ? err.message : err)
    return 'failed'
  }
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: RECAP_SELECT })
  // Imported (old X broadcast) calls never post a recap unless calls.importedRecapPostEnabled is on (fail-safe: off).
  if (rec && isImportedSource(rec.source) && !(await importedAllowed('calls.importedRecapPostEnabled', env))) return 'imported'
  if (rec && recapCrewExcluded(rec, filter)) return 'excluded'
  if (!rec || rec.status !== 'PUBLISHED' || !rec.summary?.trim()) return 'not-published'
  if (rec.recapPostedAt) return 'already-posted'
  if (redactionsNewerThanSummary(rec)) return 'stale-redactions'
  const channel = await resolveRecapChannel(rec.crewId, deps)
  if (!channel) return 'no-channel'
  const claim = await prisma.callRecording.updateMany({ where: { id, recapPostedAt: null, status: 'PUBLISHED' }, data: { recapPostedAt: new Date(), recapChannelId: channel.channelId, recapError: null } })
  if (claim.count !== 1) return 'already-posted'
  let messageId: string | null
  let content: string | undefined
  let plain: string | undefined
  try {
    const r = await renderRecap(rec, filter, deps)
    content = r.content
    plain = r.plain
    const sent = await (deps.post ?? postDiscordMessage)(
      { kind: 'bot', channelId: channel.channelId, botToken },
      { content, allowed_mentions: r.allowedMentions, flags: 4 /* SUPPRESS_EMBEDS */ },
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
      // The claim is kept, so Discord may have it: mirror (never when Discord definitely refused).
      if (plain) await enqueueMirror({ kind: 'recap', sourceId: rec.id, crewId: rec.crewId, crewLabel: rec.crewLabel, text: plain }, env)
    }
    return 'failed'
  }
  // Mirror to the mapped city Telegram groups (queued only when switched on; never affects Discord).
  await enqueueMirror({ kind: 'recap', sourceId: rec.id, crewId: rec.crewId, crewLabel: rec.crewLabel, text: plain ?? content }, env)
  // The post succeeded; bookkeeping trouble must never release the claim or look like a failed post.
  if (messageId) await prisma.callRecording.update({ where: { id }, data: { recapMessageId: messageId } }).catch((e) => console.error('[calls/recap] could not store message id:', e instanceof Error ? e.message : e))
  return 'posted'
}
