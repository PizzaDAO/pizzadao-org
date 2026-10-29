/**
 * Imported calls: merge whisper.cpp output (what was said) with a diarization (who spoke when) into the
 * app's transcript segments. Pure and unit-tested; the operator tool (scripts/calls/x-import.mjs) calls it.
 *
 * Speaker ids on an imported call are synthetic: `xs:1..xs:N`, numbered by first appearance in the
 * transcript, and `xs:0` for text no speaker turn explains. The segment field keeps the name `discordId`
 * so every existing reader of the transcript keeps working.
 */
import type { TranscriptSegment } from './ingest-schema'
import { dropRepeatRuns, isDubious, TURN_GAP_MS, type Utterance, type WhisperSegment } from './transcribe'

export const UNKNOWN_SPEAKER = 'xs:0'
/** A turn this close to a word still claims it when nothing overlaps. */
export const NEAREST_TURN_MS = 1000

export interface WhisperToken {
  text: string
  startMs: number
  endMs: number
  /** Probability of the token (0-1) when whisper reports it. */
  p?: number
}

export interface WhisperSeg {
  startMs: number
  endMs: number
  text: string
  tokens: WhisperToken[]
  /** Mean log probability of the real tokens, when tokens carry p. */
  avgLogprob?: number
}

export interface DiarTurn {
  startMs: number
  endMs: number
  /** Label from the diarizer (any string); mapped to xs:N here. */
  speaker: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** whisper.cpp marks special tokens like [_BEG_], [_TT_42] and <|endoftext|>. */
const isSpecialToken = (t: string) => /^\s*(\[_[A-Za-z]+_?\d*\]|<\|[^|]*\|>)\s*$/.test(t)

/** Parse whisper.cpp `-ojf` (full JSON) output. Segments without usable offsets are skipped. */
export function parseWhisperJson(json: unknown): WhisperSeg[] {
  const list = isObj(json) && Array.isArray(json.transcription) ? json.transcription : []
  const out: WhisperSeg[] = []
  for (const raw of list) {
    if (!isObj(raw) || typeof raw.text !== 'string' || !isObj(raw.offsets)) continue
    const startMs = num(raw.offsets.from)
    const endMs = num(raw.offsets.to)
    if (startMs === null || endMs === null) continue
    const tokens: WhisperToken[] = []
    for (const tk of Array.isArray(raw.tokens) ? raw.tokens : []) {
      if (!isObj(tk) || typeof tk.text !== 'string' || isSpecialToken(tk.text) || !isObj(tk.offsets)) continue
      const from = num(tk.offsets.from)
      const to = num(tk.offsets.to)
      if (from === null || to === null) continue
      tokens.push({ text: tk.text, startMs: from, endMs: Math.max(from, to), ...(num(tk.p) !== null ? { p: num(tk.p)! } : {}) })
    }
    const ps = tokens.map((t) => t.p).filter((p): p is number => typeof p === 'number' && p > 0)
    out.push({
      startMs: Math.max(0, startMs),
      endMs: Math.max(startMs, endMs),
      text: raw.text,
      tokens,
      ...(ps.length ? { avgLogprob: ps.reduce((a, p) => a + Math.log(p), 0) / ps.length } : {}),
    })
  }
  return out
}

/** Parse an RTTM file (`SPEAKER <file> 1 <start s> <duration s> <NA> <NA> <speaker> ...`). */
export function parseRttm(text: string): DiarTurn[] {
  const turns: DiarTurn[] = []
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/)
    if (f[0] !== 'SPEAKER' || f.length < 8) continue
    const start = Number(f[3])
    const dur = Number(f[4])
    if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0 || start < 0) continue
    turns.push({ startMs: Math.round(start * 1000), endMs: Math.round((start + dur) * 1000), speaker: f[7] })
  }
  return turns.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

const overlap = (aS: number, aE: number, bS: number, bE: number) => Math.max(0, Math.min(aE, bE) - Math.max(aS, bS))

/** The diarizer label with the most overlap with [s, e]; else the nearest turn within NEAREST_TURN_MS; else null. */
export function speakerFor(turns: DiarTurn[], s: number, e: number): string | null {
  const byOverlap = new Map<string, number>()
  let nearest: { speaker: string; gap: number } | null = null
  for (const t of turns) {
    if (t.startMs > e + NEAREST_TURN_MS) break // turns are sorted by start
    const ov = overlap(s, e, t.startMs, t.endMs)
    if (ov > 0) {
      byOverlap.set(t.speaker, (byOverlap.get(t.speaker) ?? 0) + ov)
    } else {
      const gap = t.endMs <= s ? s - t.endMs : t.startMs - e
      if (gap <= NEAREST_TURN_MS && (!nearest || gap < nearest.gap)) nearest = { speaker: t.speaker, gap }
    }
  }
  if (byOverlap.size > 0) return [...byOverlap.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
  return nearest?.speaker ?? null
}

interface Piece {
  speaker: string | null
  tokens: WhisperToken[]
}

const words = (t: string) => t.match(/\S+/g)?.length ?? 0

/** Split one segment at the tokens where the speaker changes; a one-word flip inside one speaker's turn is absorbed. */
function splitSegment(seg: WhisperSeg, turns: DiarTurn[]): Array<{ speaker: string | null; startMs: number; endMs: number; text: string }> {
  if (seg.tokens.length === 0) {
    return [{ speaker: speakerFor(turns, seg.startMs, seg.endMs), startMs: seg.startMs, endMs: seg.endMs, text: seg.text.trim() }]
  }
  const pieces: Piece[] = []
  for (const tk of seg.tokens) {
    const sp = speakerFor(turns, tk.startMs, tk.endMs)
    const last = pieces[pieces.length - 1]
    if (last && last.speaker === sp) last.tokens.push(tk)
    else pieces.push({ speaker: sp, tokens: [tk] })
  }
  // Absorb a tiny piece flanked by the same speaker on both sides.
  for (let i = 1; i < pieces.length - 1; i++) {
    if (pieces[i - 1].speaker === pieces[i + 1].speaker && words(pieces[i].tokens.map((t) => t.text).join('')) <= 1) pieces[i].speaker = pieces[i - 1].speaker
  }
  const merged: Piece[] = []
  for (const p of pieces) {
    const last = merged[merged.length - 1]
    if (last && last.speaker === p.speaker) last.tokens.push(...p.tokens)
    else merged.push({ speaker: p.speaker, tokens: [...p.tokens] })
  }
  return merged
    .map((p) => ({
      speaker: p.speaker,
      startMs: p.tokens[0].startMs,
      endMs: p.tokens[p.tokens.length - 1].endMs,
      text: p.tokens.map((t) => t.text).join('').trim(),
    }))
    .filter((p) => p.text.length > 0)
}

/** No stored segment is longer than this (the importer accepts 4000 characters per segment). */
export const MAX_TURN_CHARS = 3000

/** Split text into chunks of at most `max` characters, at sentence ends where possible, else at spaces, else hard. */
export function chunkText(text: string, max = MAX_TURN_CHARS): string[] {
  const pieces: string[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= max) pieces.push(sentence)
    else {
      let cur = ''
      for (const word of sentence.split(/\s+/)) {
        if (word.length > max) {
          if (cur) pieces.push(cur)
          cur = ''
          for (let i = 0; i < word.length; i += max) pieces.push(word.slice(i, i + max))
        } else if (cur && cur.length + 1 + word.length > max) {
          pieces.push(cur)
          cur = word
        } else cur = cur ? `${cur} ${word}` : word
      }
      if (cur) pieces.push(cur)
    }
  }
  const chunks: string[] = []
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1]
    if (last !== undefined && last.length + 1 + piece.length <= max) chunks[chunks.length - 1] = `${last} ${piece}`
    else chunks.push(piece)
  }
  return chunks
}

/** An utterance over the cap becomes several, each with a share of its time proportional to its text. */
function capUtterance(u: Utterance, max: number): Utterance[] {
  if (u.text.length <= max) return [u]
  const chunks = chunkText(u.text, max)
  const total = chunks.reduce((n, c) => n + c.length, 0) || 1
  let done = 0
  return chunks.map((text) => {
    const startMs = Math.round(u.startMs + ((u.endMs - u.startMs) * done) / total)
    done += text.length
    return { startMs, endMs: Math.round(u.startMs + ((u.endMs - u.startMs) * done) / total), text }
  })
}

/**
 * Speaker turns: consecutive lines of one speaker within the usual gap are joined, but a turn is closed before it
 * would pass `maxChars`, so one long monologue becomes several segments (split at utterance and sentence ends).
 */
export function buildTurns(perSpeaker: Array<{ discordId: string; utterances: Utterance[] }>, gapMs = TURN_GAP_MS, maxChars = MAX_TURN_CHARS): TranscriptSegment[] {
  const all = perSpeaker
    .flatMap((s) => s.utterances.flatMap((u) => capUtterance(u, maxChars)).map((u) => ({ discordId: s.discordId, ...u })))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const turns: TranscriptSegment[] = []
  for (const u of all) {
    const last = turns[turns.length - 1]
    if (last && last.discordId === u.discordId && u.startMs - last.endMs < gapMs && last.text.length + 1 + u.text.length <= maxChars) {
      last.text = `${last.text} ${u.text}`
      last.endMs = Math.max(last.endMs, u.endMs)
    } else {
      turns.push({ discordId: u.discordId, startMs: u.startMs, endMs: Math.max(u.startMs, u.endMs), text: u.text })
    }
  }
  return turns
}

export interface MergeStats {
  whisperSegments: number
  droppedDubious: number
  droppedRepeats: number
  utterances: number
  unattributed: number
  turns: number
  words: number
}

export interface MergedSpeaker {
  /** `xs:N` */
  id: string
  /** The diarizer's own label (kept for the raw record only; never shown). */
  label: string | null
  talkTimeSec: number
}

export interface MergeResult {
  segments: TranscriptSegment[]
  speakers: MergedSpeaker[]
  stats: MergeStats
}

/** Total length of the union of intervals, in ms. */
function unionMs(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let curS = -1
  let curE = -1
  for (const [s, e] of sorted) {
    if (curE < 0 || s > curE) {
      if (curE >= 0) total += curE - curS
      curS = s
      curE = e
    } else curE = Math.max(curE, e)
  }
  if (curE >= 0) total += curE - curS
  return total
}

/**
 * Whisper segments + diarization turns -> transcript segments with `xs:N` speaker ids.
 * Dubious segments (decoding loops, low confidence) are dropped like the server pipeline does, then each
 * segment is split where the speaker changes, repeated lines are dropped, and consecutive lines of one speaker
 * within the usual 1.5 s gap are joined into turns. Times are clamped to the recording length when given.
 */
export function mergeTranscript(input: { segments: WhisperSeg[]; turns: DiarTurn[]; durationMs?: number }): MergeResult {
  const turns = [...input.turns].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const asWhisper = (s: WhisperSeg): WhisperSegment => ({ start: s.startMs / 1000, end: s.endMs / 1000, text: s.text, ...(s.avgLogprob !== undefined ? { avg_logprob: s.avgLogprob } : {}) })
  const nonEmpty = input.segments.filter((s) => s.text.trim().length > 0)
  const kept = nonEmpty.filter((s) => !isDubious(asWhisper(s))).sort((a, b) => a.startMs - b.startMs)

  type Labelled = Utterance & { label: string | null }
  const labelled: Labelled[] = []
  for (const seg of kept) for (const p of splitSegment(seg, turns)) labelled.push({ startMs: p.startMs, endMs: p.endMs, text: p.text, label: p.speaker })
  labelled.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)

  // Repeat runs are detected over consecutive lines whatever the speaker (a loop is a loop).
  const survivors = new Set(dropRepeatRuns(labelled))
  const deduped = labelled.filter((u) => survivors.has(u))

  // xs:N by first appearance; unattributed text is xs:0.
  const ids = new Map<string, string>()
  const labelOf = new Map<string, string>()
  let n = 0
  let unattributed = 0
  const perSpeaker = new Map<string, Utterance[]>()
  for (const u of deduped) {
    let id = UNKNOWN_SPEAKER
    if (u.label === null) unattributed++
    else {
      if (!ids.has(u.label)) ids.set(u.label, `xs:${Math.min(++n, 999)}`)
      id = ids.get(u.label)!
      labelOf.set(id, u.label)
    }
    const list = perSpeaker.get(id) ?? []
    list.push({ startMs: u.startMs, endMs: u.endMs, text: u.text })
    perSpeaker.set(id, list)
  }

  let segments = buildTurns([...perSpeaker.entries()].map(([discordId, utterances]) => ({ discordId, utterances }))).map((s) => ({ ...s, kind: 'speech' as const }))
  if (input.durationMs !== undefined) {
    const max = input.durationMs
    // Text that starts after the recording ends is a timing glitch; one that runs past the end is cut at it.
    segments = segments.filter((s) => s.startMs < max).map((s) => ({ ...s, endMs: Math.min(Math.max(s.endMs, s.startMs), max) }))
  }

  const speakers: MergedSpeaker[] = []
  const seen = new Set<string>()
  for (const s of segments) {
    if (seen.has(s.discordId)) continue
    seen.add(s.discordId)
    // Talk time: the diarizer's turns for that label (union, so overlapping turns are not double counted); xs:0 falls back to its lines.
    const label = labelOf.get(s.discordId) ?? null
    const own = label !== null ? turns.filter((t) => t.speaker === label).map((t): [number, number] => [t.startMs, t.endMs]) : segments.filter((x) => x.discordId === s.discordId).map((x): [number, number] => [x.startMs, x.endMs])
    speakers.push({ id: s.discordId, label, talkTimeSec: Math.round(unionMs(own) / 1000) })
  }

  return {
    segments,
    speakers,
    stats: {
      whisperSegments: input.segments.length,
      droppedDubious: nonEmpty.length - kept.length,
      droppedRepeats: labelled.length - deduped.length,
      utterances: deduped.length,
      unattributed,
      turns: turns.length,
      words: segments.reduce((a, s) => a + words(s.text), 0),
    },
  }
}
