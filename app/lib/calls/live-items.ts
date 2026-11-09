/**
 * Action items confirmed during a call (plans/post-call-agenda-updates.md, options A and C): the
 * pure parts. The recorder sends speech chunks and prefixed chat lines to
 * POST /api/calls/recorder/live-chunk (live-run.ts); the app answers with the confirmation to post
 * in the call chat. After the call the stored items are merged into the recording's action items.
 *
 * Everything is off by default (calls.liveActionItemsEnabled, calls.chatActionItemsEnabled, and an
 * empty crew allowlist). No filter values or crew names live here: they are DB settings.
 */
import { z } from 'zod'
import type { Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { normalizeCrewId } from '@/app/lib/crew-id'
import type { TranscriptSegment } from './ingest-schema'
import { cleanSuggestedBy } from './summarize'

const SNOWFLAKE = /^\d{5,25}$/
const SESSION_ID = /^[A-Za-z0-9_-]{6,80}$/
/** R2 key of a live segment: `calls/<sessionId>/live/<userId>/<startMs>.ogg` (checked against the session id in code). */
const LIVE_KEY = /^calls\/[A-Za-z0-9_-]{6,80}\/live\/\d{5,25}\/\d{1,10}\.ogg$/
const MAX_CALL_MS = 24 * 3600 * 1000

/** Body of POST /api/calls/recorder/live-chunk. Keep in sync with recorder/src/live-items.ts. */
export const liveRequestSchema = z.object({
  sessionId: z.string().regex(SESSION_ID),
  eventId: z.string().regex(SNOWFLAKE).nullable(),
  eventName: z.string().max(200).nullable(),
  startedAt: z.string().datetime(),
  seq: z.number().int().min(1).max(10_000).optional(),
  segments: z
    .array(
      z.object({
        discordId: z.string().regex(SNOWFLAKE),
        displayName: z.string().max(100).nullable(),
        key: z.string().regex(LIVE_KEY),
        startMs: z.number().int().min(0).max(MAX_CALL_MS),
        endMs: z.number().int().min(0).max(MAX_CALL_MS),
      }),
    )
    .max(300)
    .optional(),
  chat: z
    .array(
      z.object({
        discordId: z.string().regex(SNOWFLAKE),
        displayName: z.string().max(100).nullable(),
        messageId: z.string().regex(SNOWFLAKE),
        text: z.string().max(4000),
        atMs: z.number().int().min(0).max(MAX_CALL_MS),
      }),
    )
    .max(20)
    .optional(),
})

export type LiveRequest = z.infer<typeof liveRequestSchema>

export interface LiveConfig {
  /** Option A: spoken items (transcribed chunks). */
  audio: boolean
  /** Option C: typed items. */
  chat: boolean
  /** Normalized crew ids; empty = none. */
  crews: string[]
  chunkSeconds: number
  windowMinutes: number
  maxPerCall: number
  /** Cost caps per call: speech checks, and speech transcribed (ms). */
  maxChunks: number
  maxAudioMs: number
  /** Lower-case prefixes. */
  prefixes: string[]
  /** '' = the summary model. */
  model: string
  note: string
}

export function parseCrewList(raw: string): string[] {
  return [...new Set(raw.split(',').map((s) => normalizeCrewId(s)).filter(Boolean))]
}

export function parsePrefixes(raw: string): string[] {
  return [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2))]
}

/** The live settings. Unreadable settings: everything off. */
export function liveConfigFrom(settings: Settings, env: Record<string, string | undefined> = process.env): LiveConfig {
  const crews = settings.readFailed ? [] : parseCrewList(settings.get('calls.liveActionItemsCrews'))
  const on = (k: 'calls.liveActionItemsEnabled' | 'calls.chatActionItemsEnabled') => !settings.readFailed && crews.length > 0 && resolveToggle(k, settings, env)
  const prefixes = parsePrefixes(settings.get('calls.chatActionPrefixes'))
  return {
    audio: on('calls.liveActionItemsEnabled'),
    chat: on('calls.chatActionItemsEnabled') && prefixes.length > 0,
    crews,
    chunkSeconds: settings.get('calls.liveChunkSeconds'),
    windowMinutes: settings.get('calls.liveWindowMinutes'),
    maxPerCall: settings.get('calls.liveActionItemsMaxPerCall'),
    maxChunks: settings.get('calls.liveMaxChunksPerCall'),
    maxAudioMs: settings.get('calls.liveMaxAudioMinutesPerCall') * 60_000,
    prefixes,
    model: settings.get('calls.liveActionItemsModel').trim(),
    note: settings.get('calls.liveActionItemNote').trim(),
  }
}

/** The item of a chat line that starts with a prefix (case-insensitive), else null. Same rule as the recorder. */
export function chatItemText(text: string, prefixes: readonly string[]): string | null {
  const t = text.trim()
  const lower = t.toLowerCase()
  for (const p of prefixes) {
    if (!p || !lower.startsWith(p)) continue
    const rest = t.slice(p.length).trim()
    return rest.length >= 3 ? rest : null
  }
  return null
}

const MAX_ITEM_CHARS = 200
const MAX_OWNER_CHARS = 60

/** One line, no control characters, no Discord block syntax at the start, capped. */
export function cleanItemText(s: string | null | undefined, max = MAX_ITEM_CHARS): string {
  const one = (s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-#>*•\s]+/, '')
    .replace(/[.;,\s]+$/, '')
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}

/** An owner name: "S2 (Ann)" -> "Ann"; a bare label or "Speaker N" is not a name. */
export function cleanOwner(s: string | null | undefined): string | null {
  let o = cleanItemText(s, MAX_OWNER_CHARS)
  const labelled = /^S\d{1,3}\s*\((.+)\)$/i.exec(o)
  if (labelled) o = labelled[1].trim()
  if (!o || /^S\d{1,3}$/i.test(o) || /^speaker( \d+)?$/i.test(o) || /^(null|none|unknown|n\/a)$/i.test(o)) return null
  return o
}

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'on', 'in', 'at', 'by', 'with', 'is', 'be', 'will', 'should', 'we', 'i', 'it', 'this', 'that', 'our', 'their', 'up', 'out', 'get'])

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))

/** The dedupe key: content words in order (for the unique index). */
export function normKey(text: string): string {
  return words(text).join(' ').slice(0, 200) || text.trim().toLowerCase().slice(0, 200)
}

/**
 * Two items say the same thing: the same content words, one's words contained in the other's (at
 * least 2 words), or a high overlap. Loose on purpose: a missed duplicate posts twice in public.
 */
export function isSameItem(a: string, b: string): boolean {
  const ka = normKey(a)
  const kb = normKey(b)
  if (ka === kb) return true
  const A = new Set(words(a))
  const B = new Set(words(b))
  if (A.size === 0 || B.size === 0) return false
  let both = 0
  for (const w of A) if (B.has(w)) both++
  const small = Math.min(A.size, B.size)
  if (both === small && small >= 2) return true
  return both / (A.size + B.size - both) >= 0.6
}

/** Most items in one confirmation message. */
export const MAX_ITEMS_PER_MESSAGE = 5

/** The confirmation for the call chat, or null when there is nothing to post. */
export function formatConfirmation(items: ReadonlyArray<{ text: string; owner: string | null }>, note: string): string | null {
  const list = items.slice(0, MAX_ITEMS_PER_MESSAGE)
  if (list.length === 0) return null
  const line = (i: { text: string; owner: string | null }) => `${i.text}${i.owner ? ` — ${i.owner}` : ''}`
  const head = list.length === 1 ? `📝 Action item recorded: ${line(list[0])}` : `📝 Action items recorded:\n${list.map((i) => `• ${line(i)}`).join('\n')}`
  const tail = cleanItemText(note, 120)
  return tail ? `${head}\n-# ${tail}` : head
}

export interface StoredLiveItem {
  text: string
  owner: string | null
  source: string
  speakerIds: string[]
  messageId: string | null
  /** Spoken items: the call-time span of the speech it came from. */
  startMs?: number | null
  endMs?: number | null
}

/** Slack when matching a live span to the final transcript (the two are transcribed separately). */
export const SPAN_SLACK_MS = 3_000

/** Is some visible spoken line of one of these speakers inside the span (with slack)? */
function spokenLineOverlaps(segments: readonly TranscriptSegment[], speakerIds: readonly string[], startMs: number, endMs: number): boolean {
  const who = new Set(speakerIds)
  return segments.some((s) => s.kind !== 'chat' && who.has(s.discordId) && s.startMs <= endMs + SPAN_SLACK_MS && s.endMs >= startMs - SPAN_SLACK_MS)
}

/**
 * The summary's action items plus the live ones it does not already have (live items after the
 * model's, in the order they were recorded). Redactions apply: an item said or typed by a hidden
 * speaker is left out, a typed item whose chat line is gone (deleted or hidden) too, and a spoken
 * item when no visible spoken line of its speaker(s) overlaps the span it came from (a hidden line,
 * or no span recorded).
 * `segments` are the visible segments the summary was made from.
 */
export function mergeLiveActionItems(
  base: ReadonlyArray<{ text: string; owner: string | null; suggestedBy?: string | null }>,
  live: readonly StoredLiveItem[],
  segments: readonly TranscriptSegment[],
  redactedSpeakerIds: readonly string[] | null | undefined,
  max = 30,
  /** Display names by Discord id (buildSpeakerNames); the first speaker of a live item becomes its suggestedBy. */
  names: Readonly<Record<string, string>> = {},
): Array<{ text: string; owner: string | null; suggestedBy?: string | null }> {
  const hidden = new Set(redactedSpeakerIds ?? [])
  const chatLines = new Set(segments.filter((s) => s.kind === 'chat' && s.id).map((s) => s.id as string))
  const out = [...base]
  for (const it of live) {
    if (out.length >= max) break
    if (it.speakerIds.some((id) => hidden.has(id))) continue
    if (it.source === 'chat' && !(it.messageId && chatLines.has(`c:${it.messageId}`))) continue
    if (it.source !== 'chat') {
      if (typeof it.startMs !== 'number' || typeof it.endMs !== 'number' || it.speakerIds.length === 0) continue
      if (!spokenLineOverlaps(segments, it.speakerIds, it.startMs, it.endMs)) continue
    }
    if (out.some((o) => isSameItem(o.text, it.text))) continue
    const by = cleanSuggestedBy(names[it.speakerIds[0]] ?? null)
    out.push({ text: it.text, owner: it.owner, ...(by ? { suggestedBy: by } : {}) })
  }
  return out
}
