/**
 * Speech-only audio for Whisper. A recorder speaker track (Ogg/Opus, aligned to call time) is padded
 * with silence to the full call length, and Whisper loops / hallucinates over long silence. So only
 * the speech is sent:
 *   1. analyzeTrack: a streaming decode to 16 kHz mono that keeps one level (dBFS) per 30 ms frame;
 *   2. detectSpeech: a simple energy VAD over those levels;
 *   3. planChunks: speech regions packed into chunks (<= MAX_CHUNK_MS, CHUNK_GAP_MS of silence between
 *      regions), each with an offset map back to call time;
 *   4. extractSpeech: a second streaming decode that keeps 16-bit samples only inside the wanted
 *      regions, so memory is proportional to the speech kept, not to the call length;
 *   5. renderChunkWav / mapChunkResult: a 16-bit WAV per chunk, and Whisper's times mapped back. A
 *      segment that runs across two regions is split at the boundary using Whisper's word times.
 *
 * Decoding uses ogg-opus-decoder (libopus compiled to WebAssembly, no native binary), which decodes
 * straight to 16 kHz.
 *
 * Known limit: a region longer than a chunk is cut at its quietest frame near the limit. In
 * continuous speech that cut can fall inside a word, which Whisper may then garble or lose on both
 * sides; it happens at most once per 10 minutes of uninterrupted speech, so it is accepted.
 */

export const SAMPLE_RATE = 16_000
export const FRAME_MS = 30
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000
/** A frame whose peak stays below this (about -80 dBFS) is the recorder's padding. */
const DIGITAL_SILENCE = 1e-4
/** dB value used for a digitally silent frame. */
export const SILENT_DB = -120

export interface VadOptions {
  /** Speech must be this many dB above the track's noise floor... */
  marginDb: number
  /** ...but the threshold never goes below this (dBFS)... */
  minThresholdDb: number
  /** ...nor above this (dBFS), so a noisy or non-stop track still keeps quiet speech. */
  maxThresholdDb: number
  /** Percentile (0-100) of the non-silent frames' level taken as the noise floor. */
  floorPercentile: number
  /** Regions closer than this are merged. */
  mergeGapMs: number
  /** Regions shorter than this (before padding) are dropped as clicks. */
  minSpeechMs: number
  /** Kept on each side of a region (hangover / onset). */
  padMs: number
}

export const DEFAULT_VAD: VadOptions = {
  marginDb: 10,
  minThresholdDb: -60,
  maxThresholdDb: -38,
  floorPercentile: 10,
  mergeGapMs: 1000,
  minSpeechMs: 250,
  padMs: 300,
}

/** One chunk sent to Whisper is at most this much audio (16-bit 16 kHz WAV: 19.2 MB, under OpenAI's 25 MB). */
export const MAX_CHUNK_MS = 600_000
/** Silence inserted between two speech regions inside a chunk (long enough that Whisper usually ends a segment). */
export const CHUNK_GAP_MS = 1500

export interface Region {
  startMs: number
  endMs: number
}

/** First decoding pass: one level per frame. */
export interface TrackLevels {
  /** RMS level of each 30 ms frame, in dBFS (SILENT_DB for digital silence). */
  frameDb: Float32Array
  totalSamples: number
  decodeErrors: number
}

/** Level (dBFS RMS) of a frame of float samples. */
export function frameLevelDb(samples: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return rms > 0 ? Math.max(SILENT_DB, 20 * Math.log10(rms)) : SILENT_DB
}

/** Per-frame levels from 16 kHz float PCM delivered in pieces of any size (one float per frame kept). */
export class LevelMeter {
  private levels = new Float32Array(4096)
  private count = 0
  private pending = new Float32Array(FRAME_SAMPLES)
  private pendingLen = 0
  private total = 0
  decodeErrors = 0

  push(pcm: Float32Array): void {
    let i = 0
    while (i < pcm.length) {
      const n = Math.min(FRAME_SAMPLES - this.pendingLen, pcm.length - i)
      this.pending.set(pcm.subarray(i, i + n), this.pendingLen)
      this.pendingLen += n
      i += n
      if (this.pendingLen === FRAME_SAMPLES) this.flushFrame()
    }
    this.total += pcm.length
  }

  private flushFrame(): void {
    const f = this.pending.subarray(0, this.pendingLen)
    let peak = 0
    for (let i = 0; i < f.length; i++) peak = Math.max(peak, Math.abs(f[i]))
    if (this.count === this.levels.length) {
      const grown = new Float32Array(this.levels.length * 2)
      grown.set(this.levels)
      this.levels = grown
    }
    this.levels[this.count++] = peak < DIGITAL_SILENCE ? SILENT_DB : frameLevelDb(f)
    this.pendingLen = 0
  }

  finish(): TrackLevels {
    if (this.pendingLen > 0) this.flushFrame()
    return { frameDb: this.levels.slice(0, this.count), totalSamples: this.total, decodeErrors: this.decodeErrors }
  }
}

const toInt16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)))

/**
 * Second pass: copies the samples of the wanted regions (null = not wanted) into one 16-bit buffer
 * per region. Regions must be sorted and not overlap.
 */
export class SpeechExtractor {
  private out: Array<Int16Array | undefined>
  private bounds: Array<{ i: number; start: number; end: number }>
  private next = 0
  private pos = 0

  constructor(regions: Array<Region | null>) {
    const perMs = SAMPLE_RATE / 1000
    this.bounds = regions.flatMap((r, i) => (r ? [{ i, start: Math.round(r.startMs * perMs), end: Math.round(r.endMs * perMs) }] : []))
    this.out = regions.map((r) => (r ? new Int16Array(Math.round((r.endMs - r.startMs) * perMs)) : undefined))
  }

  push(pcm: Float32Array): void {
    const from = this.pos
    const to = from + pcm.length
    for (let k = this.next; k < this.bounds.length; k++) {
      const b = this.bounds[k]
      if (b.start >= to) break
      const s = Math.max(b.start, from)
      const e = Math.min(b.end, to)
      const buf = this.out[b.i]!
      for (let x = s; x < e; x++) buf[x - b.start] = toInt16(pcm[x - from])
      if (b.end <= to) this.next = k + 1
    }
    this.pos = to
  }

  finish(): Array<Int16Array | undefined> {
    return this.out
  }
}

/** Feed the Ogg file to the decoder in pieces this big (keeps peak memory low). */
const DECODE_PIECE_BYTES = 32 * 1024

type Decoded = { channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }
interface OggDecoderLike {
  ready: Promise<void>
  decode(data: Uint8Array): Promise<Decoded>
  flush(): Promise<Decoded>
  free(): void
}

/** Mono 16 kHz samples of one decoder result (channels averaged). */
export function downmix(channelData: Float32Array[], samples: number): Float32Array {
  if (channelData.length === 0 || samples <= 0) return new Float32Array(0)
  if (channelData.length === 1) return channelData[0].subarray(0, samples)
  const out = new Float32Array(samples)
  for (const ch of channelData) for (let i = 0; i < samples; i++) out[i] += ch[i]
  for (let i = 0; i < samples; i++) out[i] /= channelData.length
  return out
}

/** Stream-decode an Ogg/Opus file to 16 kHz mono; returns the sample and error counts. */
async function decodeStream(bytes: Uint8Array, onPcm: (pcm: Float32Array) => void): Promise<{ samples: number; errors: number }> {
  const { OggOpusDecoder } = await import('ogg-opus-decoder')
  // sampleRate is supported by the decoder (libopus decodes natively at 16 kHz) but missing from its types.
  const decoder = new (OggOpusDecoder as unknown as new (o: { sampleRate: number }) => OggDecoderLike)({ sampleRate: SAMPLE_RATE })
  let samples = 0
  let errors = 0
  const take = (r: Decoded) => {
    errors += r.errors?.length ?? 0
    const pcm = downmix(r.channelData, r.samplesDecoded)
    if (pcm.length) {
      samples += pcm.length
      onPcm(pcm)
    }
  }
  try {
    await decoder.ready
    for (let i = 0; i < bytes.length; i += DECODE_PIECE_BYTES) take(await decoder.decode(bytes.subarray(i, i + DECODE_PIECE_BYTES)))
    take(await decoder.flush())
  } finally {
    decoder.free()
  }
  return { samples, errors }
}

/** Pass 1: per-frame levels of an Ogg/Opus track. Throws when nothing decodes (not Ogg/Opus, corrupt). */
export async function analyzeTrack(bytes: Uint8Array): Promise<TrackLevels> {
  const meter = new LevelMeter()
  const { samples, errors } = await decodeStream(bytes, (pcm) => meter.push(pcm))
  if (samples === 0) throw new Error('no audio decoded')
  meter.decodeErrors = errors
  return meter.finish()
}

/** Pass 2: 16-bit samples of the wanted regions (null entries are skipped). */
export async function extractSpeech(bytes: Uint8Array, regions: Array<Region | null>): Promise<Array<Int16Array | undefined>> {
  const ex = new SpeechExtractor(regions)
  await decodeStream(bytes, (pcm) => ex.push(pcm))
  return ex.finish()
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))
  return sorted[i]
}

/** The level a frame must reach to count as speech, from the track's noise floor. */
export function speechThresholdDb(frameDb: ArrayLike<number>, opts: VadOptions = DEFAULT_VAD): number | null {
  const audible: number[] = []
  for (let i = 0; i < frameDb.length; i++) if (frameDb[i] > SILENT_DB) audible.push(frameDb[i])
  if (audible.length === 0) return null
  const floor = percentile(audible, opts.floorPercentile)
  return Math.max(opts.minThresholdDb, Math.min(floor + opts.marginDb, opts.maxThresholdDb))
}

/** Speech regions (ms, on the track's own timeline) from per-frame levels. */
export function detectSpeech(frameDb: ArrayLike<number>, opts: VadOptions = DEFAULT_VAD): Region[] {
  const threshold = speechThresholdDb(frameDb, opts)
  if (threshold === null) return []
  const n = frameDb.length
  const trackMs = n * FRAME_MS
  // Runs of loud frames.
  const runs: Region[] = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    const loud = i < n && frameDb[i] >= threshold
    if (loud && start < 0) start = i
    if (!loud && start >= 0) {
      runs.push({ startMs: start * FRAME_MS, endMs: i * FRAME_MS })
      start = -1
    }
  }
  // Merge runs separated by short pauses, then drop clicks.
  const merged: Region[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && r.startMs - last.endMs < opts.mergeGapMs) last.endMs = r.endMs
    else merged.push({ ...r })
  }
  const kept = merged.filter((r) => r.endMs - r.startMs >= opts.minSpeechMs)
  // Pad, then merge what now overlaps.
  const out: Region[] = []
  for (const r of kept) {
    const p = { startMs: Math.max(0, r.startMs - opts.padMs), endMs: Math.min(trackMs, r.endMs + opts.padMs) }
    const last = out[out.length - 1]
    if (last && p.startMs <= last.endMs) last.endMs = Math.max(last.endMs, p.endMs)
    else out.push(p)
  }
  return out
}

/** Split regions longer than maxMs, cutting at the quietest frame of the last 20 s before the limit. */
export function splitLongRegions(regions: Region[], frameDb: ArrayLike<number>, maxMs = MAX_CHUNK_MS): Region[] {
  const out: Region[] = []
  const searchMs = Math.min(20_000, Math.floor(maxMs / 2))
  for (const r of regions) {
    let s = r.startMs
    while (r.endMs - s > maxMs) {
      const hi = Math.floor((s + maxMs) / FRAME_MS)
      const lo = Math.ceil((s + maxMs - searchMs) / FRAME_MS)
      let cut = hi
      for (let f = hi; f >= lo; f--) if ((frameDb[f] ?? SILENT_DB) < (frameDb[cut] ?? SILENT_DB)) cut = f
      const cutMs = Math.max(s + FRAME_MS, cut * FRAME_MS)
      out.push({ startMs: s, endMs: cutMs })
      s = cutMs
    }
    out.push({ startMs: s, endMs: r.endMs })
  }
  return out
}

/** A region (index into the plan's regions) placed at chunkStartMs inside a chunk. */
export interface ChunkPiece {
  region: number
  srcStartMs: number
  srcEndMs: number
  chunkStartMs: number
}

export interface Chunk {
  pieces: ChunkPiece[]
  durationMs: number
}

/** Pack regions (sorted, non-overlapping, each <= maxMs) into chunks of at most maxMs of audio. */
export function planChunks(regions: Region[], maxMs = MAX_CHUNK_MS, gapMs = CHUNK_GAP_MS): Chunk[] {
  const chunks: Chunk[] = []
  let cur: Chunk | null = null
  regions.forEach((r, region) => {
    const len = r.endMs - r.startMs
    if (len <= 0) return
    if (len > maxMs) throw new Error(`region of ${len} ms is longer than a chunk`)
    if (!cur || cur.durationMs + gapMs + len > maxMs) {
      cur = { pieces: [], durationMs: 0 }
      chunks.push(cur)
    }
    const startAt = cur.pieces.length ? cur.durationMs + gapMs : 0
    cur.pieces.push({ region, srcStartMs: r.startMs, srcEndMs: r.endMs, chunkStartMs: startAt })
    cur.durationMs = startAt + len
  })
  return chunks
}

const pieceLen = (p: ChunkPiece) => p.srcEndMs - p.srcStartMs

/** Index of the piece holding chunk time tMs; a time in a gap belongs to the next piece (the last piece past the end). */
function pieceAt(chunk: Chunk, tMs: number): number {
  const ps = chunk.pieces
  for (let i = 0; i < ps.length; i++) if (tMs <= ps[i].chunkStartMs + pieceLen(ps[i])) return i
  return ps.length - 1
}

/**
 * Chunk time to call time. Inside a piece the mapping is exact. A time in the silence between two
 * pieces snaps to the next piece's start (edge 'start') or the previous piece's end (edge 'end').
 */
export function chunkToCallMs(chunk: Chunk, tMs: number, edge: 'start' | 'end'): number {
  const ps = chunk.pieces
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    if (tMs < p.chunkStartMs) return edge === 'start' || i === 0 ? p.srcStartMs : ps[i - 1].srcEndMs
    if (tMs <= p.chunkStartMs + pieceLen(p)) return p.srcStartMs + (tMs - p.chunkStartMs)
  }
  return ps[ps.length - 1].srcEndMs
}

/** Call time to chunk time (inverse of chunkToCallMs inside pieces); null when the time is not in this chunk. */
export function callToChunkMs(chunk: Chunk, callMs: number): number | null {
  for (const p of chunk.pieces) if (callMs >= p.srcStartMs && callMs <= p.srcEndMs) return p.chunkStartMs + (callMs - p.srcStartMs)
  return null
}

/** 16-bit mono WAV of one chunk: its pieces (from the extracted region samples) with silence between them. */
export function renderChunkWav(chunk: Chunk, pcm: ArrayLike<Int16Array | undefined>): Uint8Array {
  const samplesPerMs = SAMPLE_RATE / 1000
  const total = Math.round(chunk.durationMs * samplesPerMs)
  const buf = new Uint8Array(44 + total * 2)
  const view = new DataView(buf.buffer)
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + total * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, total * 2, true)
  const out = new Int16Array(buf.buffer, 44, total)
  for (const p of chunk.pieces) {
    const src = pcm[p.region]
    if (!src) continue
    const dst = Math.round(p.chunkStartMs * samplesPerMs)
    out.set(src.subarray(0, Math.max(0, Math.min(src.length, total - dst))), dst)
  }
  return buf
}

export interface WordTime {
  word: string
  start: number
  end: number
}

/**
 * Whisper segments of one chunk mapped back to call time (seconds). A segment that runs from one
 * piece into a later one is split at the boundary using the word times (each part mapped through its
 * own piece); without word times it is cut at the end of its first piece.
 */
export function mapChunkResult<T extends { start: number; end: number; text: string }>(
  chunk: Chunk,
  segments: T[],
  words: WordTime[] = [],
): { segments: T[]; split: number; capped: number } {
  const out: T[] = []
  let split = 0
  let capped = 0
  const map = (s: T, startMs: number, endMs: number, text = s.text) => {
    const start = chunkToCallMs(chunk, startMs, 'start')
    const end = Math.max(start, chunkToCallMs(chunk, endMs, 'end'))
    out.push({ ...s, start: start / 1000, end: end / 1000, text })
  }
  for (const s of segments) {
    const sMs = s.start * 1000
    const eMs = s.end * 1000
    const first = pieceAt(chunk, sMs)
    const next = chunk.pieces[first + 1]
    // Ending in the gap after its piece is fine (it maps to the piece end); reaching a later piece is not.
    if (!next || eMs <= next.chunkStartMs) {
      map(s, sMs, eMs)
      continue
    }
    const inside = words.filter((w) => w.start * 1000 >= sMs - 20 && w.start * 1000 < eMs)
    if (inside.length === 0) {
      const p = chunk.pieces[first]
      map(s, sMs, p.chunkStartMs + pieceLen(p))
      capped++
      continue
    }
    const groups = new Map<number, WordTime[]>()
    for (const w of inside) {
      const g = pieceAt(chunk, ((w.start + w.end) / 2) * 1000)
      groups.set(g, [...(groups.get(g) ?? []), w])
    }
    for (const ws of groups.values()) {
      const text = ws.map((w) => w.word.trim()).filter(Boolean).join(' ')
      if (text) map(s, ws[0].start * 1000, ws[ws.length - 1].end * 1000, text)
    }
    if (groups.size > 1) split++
  }
  return { segments: out, split, capped }
}

export interface SpeechPlan {
  regions: Region[]
  chunks: Chunk[]
  speechMs: number
}

/** VAD + chunking for an analyzed track. */
export function planSpeech(levels: Pick<TrackLevels, 'frameDb'>, opts: VadOptions = DEFAULT_VAD, maxChunkMs = MAX_CHUNK_MS): SpeechPlan {
  const regions = splitLongRegions(detectSpeech(levels.frameDb, opts), levels.frameDb, maxChunkMs)
  return { regions, chunks: planChunks(regions, maxChunkMs), speechMs: regions.reduce((n, r) => n + r.endMs - r.startMs, 0) }
}
