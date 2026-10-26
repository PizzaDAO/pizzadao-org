/**
 * Voice-channel text chat in the call transcript. Chat lines live in the same `transcript` JSON as
 * spoken lines (no migration), marked `kind: 'chat'`, placed by time (startMs = endMs = message time).
 */
import type { IngestChatMessage, TranscriptSegment } from './ingest-schema'

export const isChat = (seg: TranscriptSegment): boolean => seg.kind === 'chat'

export function chatToSegments(chat: IngestChatMessage[]): TranscriptSegment[] {
  return chat.map((c) => ({ discordId: c.discordId, startMs: c.atMs, endMs: c.atMs, text: c.text, kind: 'chat' as const, id: `c:${c.messageId}`, ...(c.displayName ? { name: c.displayName } : {}) }))
}

/** Speech and chat in time order; at the same instant speech comes first (stable). */
export function mergeChat(speech: TranscriptSegment[], chat: IngestChatMessage[]): TranscriptSegment[] {
  return [...speech, ...chatToSegments(chat)].sort((a, b) => a.startMs - b.startMs)
}

/** Chat authors who are not among the recorded speakers (they get a speaker row so they can be hidden). */
export function chatOnlyAuthors(chat: IngestChatMessage[], speakerIds: Iterable<string>): Array<{ discordId: string; displayName: string | null }> {
  const known = new Set(speakerIds)
  const out = new Map<string, string | null>()
  for (const c of chat) if (!known.has(c.discordId) && !out.has(c.discordId)) out.set(c.discordId, c.displayName)
  return [...out].map(([discordId, displayName]) => ({ discordId, displayName }))
}

/** Stable key of a transcript line, for hiding single lines: chat `c:<messageId>`, speech `s:<speaker>:<startMs>`. */
export const segmentKey = (seg: TranscriptSegment): string => seg.id ?? `s:${seg.discordId}:${seg.startMs}`

const DISCORD_CDN = /https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/\S+/gi

/** Attachment links (Discord CDN) are reviewer-only: public output and the model see "[attachment]". */
export const publicChatText = (text: string): string => text.replace(DISCORD_CDN, '[attachment]')
