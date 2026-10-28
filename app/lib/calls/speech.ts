/**
 * Speech-only audio for Whisper. A recorder speaker track (Ogg/Opus, mono, aligned to call time) is
 * padded with silence to the full call length, and Whisper loops / hallucinates over long silence.
 * So a track is decoded to 16 kHz mono PCM, a simple energy VAD finds the speech, and only the
 * speech is sent: speech regions are packed into chunks (<= MAX_CHUNK_MS each, 0.5 s of silence
 * between regions) encoded as 16-bit WAV, and every chunk keeps an offset map so Whisper's segment
 * times can be mapped back onto the call timeline.
 *
 * Decoding uses ogg-opus-decoder (libopus compiled to WebAssembly, no native binary), which can
 * decode straight to 16 kHz. Frames that are digital silence (the recorder's padding) are not kept
 * in memory, so memory grows with the speech, not with the call length.
 */

export const SAMPLE_RATE = 16_000
export const FRAME_MS = 30
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000
/** A frame whose peak stays below this (about -80 dBFS) is the recorder's padding: not stored. */
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
/** Silence inserted between two speech regions inside a chunk. */
export const CHUNK_GAP_MS = 500

export interface Region {
  startMs: number
  endMs: number
}

/** Decoded track: per-frame level, and the samples of every frame that is not digital silence. */
export interface DecodedTrack {
  /** RMS level of each 30 ms frame, in dBFS (SILENT_DB for padding). */
  frameDb: Float32Array
  /** Frame index -> 16-bit samples; frames missing here are silence. */
  frames: Map<number, Int16Array>
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

/** Builds a DecodedTrack from 16 kHz float PCM delivered in pieces of any size. */
export class FrameCollector {
  private frameDb: number[] = []
  private frames = new Map<number, Int16Array>()
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
    for (let i = 0; i < f.length; i++) {
      const a = Math.abs(f[i])
      if (a > peak) peak = a
    }
    const index = this.frameDb.length
    if (peak < DIGITAL_SILENCE) {
      this.frameDb.push(SILENT_DB)
    } else {
      this.frameDb.push(frameLevelDb(f))
      const s = new Int16Array(f.length)
      for (let i = 0; i < f.length; i++) s[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)))
      this.frames.set(index, s)
    }
    this.pendingLen = 0
  }

  finish(): DecodedTrack {
    if (this.pendingLen > 0) this.flushFrame()
    return { frameDb: Float32Array.from(this.frameDb), frames: this.frames, totalSamples: this.total, decodeErrors: this.decodeErrors }
  }
}

/** Feed the Ogg file to the decoder in pieces this big (keeps peak memory low). */
const DECODE_PIECE_BYTES = 32 * 1024

interface OggDecoderLike {
  ready: Promise<void>
  decode(data: Uint8Array): Promise<{ channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }>
  flush(): Promise<{ channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }>
  free(): void
}

/** Decode an Ogg/Opus file to 16 kHz mono frames. Throws when nothing decodes (not Ogg/Opus, corrupt). */
export async function decodeOggOpus(bytes: Uint8Array): Promise<DecodedTrack> {
  const { OggOpusDecoder } = await import('ogg-opus-decoder')
  // sampleRate is supported by the decoder (libopus decodes natively at 16 kHz) but missing from its types.
  const decoder = new (OggOpusDecoder as unknown as new (o: { sampleRate: number }) => OggDecoderLike)({ sampleRate: SAMPLE_RATE })
  const out = new FrameCollector()
  const take = (r: { channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }) => {
    out.decodeErrors += r.errors?.length ?? 0
    if (r.samplesDecoded > 0 && r.channelData[0]) out.push(r.channelData[0].subarray(0, r.samplesDecoded))
  }
  try {
    await decoder.ready
    for (let i = 0; i < bytes.length; i += DECODE_PIECE_BYTES) take(await decoder.decode(bytes.subarray(i, i + DECODE_PIECE_BYTES)))
    take(await decoder.flush())
  } finally {
    decoder.free()
  }
  const track = out.finish()
  if (track.totalSamples === 0) throw new Error('no audio decoded')
  return track
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

/** A piece of call audio placed at chunkStartMs inside a chunk. */
export interface ChunkPiece {
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
  for (const r of regions) {
    const len = r.endMs - r.startMs
    if (len <= 0) continue
    if (len > maxMs) throw new Error(`region of ${len} ms is longer than a chunk`)
    if (!cur || cur.durationMs + gapMs + len > maxMs) {
      cur = { pieces: [], durationMs: 0 }
      chunks.push(cur)
    }
    const startAt = cur.pieces.length ? cur.durationMs + gapMs : 0
    cur.pieces.push({ srcStartMs: r.startMs, srcEndMs: r.endMs, chunkStartMs: startAt })
    cur.durationMs = startAt + len
  }
  return chunks
}

/**
 * Chunk time to call time. Inside a piece the mapping is exact. A time in the silence between two
 * pieces snaps to the next piece's start (edge 'start') or the previous piece's end (edge 'end').
 */
export function chunkToCallMs(chunk: Chunk, tMs: number, edge: 'start' | 'end'): number {
  const ps = chunk.pieces
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    const len = p.srcEndMs - p.srcStartMs
    if (tMs < p.chunkStartMs) return edge === 'start' || i === 0 ? p.srcStartMs : ps[i - 1].srcEndMs
    if (tMs <= p.chunkStartMs + len) return p.srcStartMs + (tMs - p.chunkStartMs)
  }
  return ps[ps.length - 1].srcEndMs
}

/** Call time to chunk time (inverse of chunkToCallMs inside pieces); null when the time is not in this chunk. */
export function callToChunkMs(chunk: Chunk, callMs: number): number | null {
  for (const p of chunk.pieces) if (callMs >= p.srcStartMs && callMs <= p.srcEndMs) return p.chunkStartMs + (callMs - p.srcStartMs)
  return null
}

/** 16-bit mono WAV of one chunk: its pieces of the decoded track with silence between them. */
export function renderChunkWav(track: DecodedTrack, chunk: Chunk): Uint8Array {
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
  const pcm = new Int16Array(buf.buffer, 44, total)
  for (const p of chunk.pieces) {
    const srcStart = Math.round(p.srcStartMs * samplesPerMs)
    const srcEnd = Math.min(Math.round(p.srcEndMs * samplesPerMs), track.totalSamples)
    let dst = Math.round(p.chunkStartMs * samplesPerMs)
    let s = srcStart
    while (s < srcEnd && dst < total) {
      const f = Math.floor(s / FRAME_SAMPLES)
      const off = s - f * FRAME_SAMPLES
      const n = Math.min(FRAME_SAMPLES - off, srcEnd - s, total - dst)
      const frame = track.frames.get(f)
      if (frame) pcm.set(frame.subarray(off, off + n), dst)
      s += n
      dst += n
    }
  }
  return buf
}

/** Whisper segment times (seconds) of one chunk mapped back to call time (seconds). */
export function mapChunkSegments<T extends { start: number; end: number }>(chunk: Chunk, segments: T[]): T[] {
  return segments.map((s) => {
    const start = chunkToCallMs(chunk, s.start * 1000, 'start')
    const end = Math.max(start, chunkToCallMs(chunk, s.end * 1000, 'end'))
    return { ...s, start: start / 1000, end: end / 1000 }
  })
}

export interface SpeechPlan {
  regions: Region[]
  chunks: Chunk[]
  speechMs: number
}

/** VAD + chunking for a decoded track. */
export function planSpeech(track: DecodedTrack, opts: VadOptions = DEFAULT_VAD, maxChunkMs = MAX_CHUNK_MS): SpeechPlan {
  const regions = splitLongRegions(detectSpeech(track.frameDb, opts), track.frameDb, maxChunkMs)
  return { regions, chunks: planChunks(regions, maxChunkMs), speechMs: regions.reduce((n, r) => n + r.endMs - r.startMs, 0) }
}
