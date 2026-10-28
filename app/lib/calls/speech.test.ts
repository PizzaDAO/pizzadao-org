// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CHUNK_GAP_MS,
  DEFAULT_VAD,
  FRAME_MS,
  FrameCollector,
  MAX_CHUNK_MS,
  SAMPLE_RATE,
  SILENT_DB,
  callToChunkMs,
  chunkToCallMs,
  decodeOggOpus,
  detectSpeech,
  mapChunkSegments,
  planChunks,
  planSpeech,
  renderChunkWav,
  speechThresholdDb,
  splitLongRegions,
  type Chunk,
  type Region,
} from './speech'

/** Deterministic noise generator. */
function rng(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff - 0.5
  }
}

type Part = { sec: number; kind: 'zero' | 'noise' | 'tone' }
/** 16 kHz float PCM from parts: digital silence, quiet background noise (~-60 dBFS) or a loud tone. */
function synth(parts: Part[]): Float32Array {
  const rand = rng()
  const total = Math.round(parts.reduce((n, p) => n + p.sec, 0) * SAMPLE_RATE)
  const out = new Float32Array(total)
  let i = 0
  for (const p of parts) {
    const n = Math.round(p.sec * SAMPLE_RATE)
    for (let k = 0; k < n; k++, i++) {
      if (p.kind === 'noise') out[i] = rand() * 0.004
      else if (p.kind === 'tone') out[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) + rand() * 0.004
    }
  }
  return out
}

function collect(pcm: Float32Array, pieceSize = 1234) {
  const c = new FrameCollector()
  for (let i = 0; i < pcm.length; i += pieceSize) c.push(pcm.subarray(i, i + pieceSize))
  return c.finish()
}

const near = (actual: number, expected: number, tol = FRAME_MS) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol)

describe('frame collection', () => {
  it('keeps samples only for frames that are not digital silence', () => {
    const t = collect(synth([{ sec: 3, kind: 'zero' }, { sec: 1, kind: 'tone' }, { sec: 2, kind: 'zero' }]))
    expect(t.totalSamples).toBe(6 * SAMPLE_RATE)
    expect(t.frameDb.length).toBe(200)
    expect(t.frames.size).toBeGreaterThanOrEqual(33)
    expect(t.frames.size).toBeLessThanOrEqual(35)
    expect(t.frameDb[0]).toBe(SILENT_DB)
    expect(t.frameDb[110]).toBeGreaterThan(-15) // 0.3 amplitude sine is about -13 dBFS
  })
})

describe('VAD', () => {
  it('finds speech in silence + noise + tones: merges short pauses, drops clicks, pads', () => {
    const pcm = synth([
      { sec: 2, kind: 'zero' },
      { sec: 1, kind: 'noise' },
      { sec: 2, kind: 'tone' }, // 3-5 s
      { sec: 0.5, kind: 'noise' }, // short pause: merged
      { sec: 1.5, kind: 'tone' }, // 5.5-7 s
      { sec: 3, kind: 'noise' },
      { sec: 0.1, kind: 'tone' }, // 10-10.1 s click: dropped
      { sec: 1.9, kind: 'zero' },
      { sec: 2, kind: 'tone' }, // 12-14 s, runs to the end of the track
    ])
    const regions = detectSpeech(collect(pcm).frameDb)
    expect(regions).toHaveLength(2)
    near(regions[0].startMs, 3000 - DEFAULT_VAD.padMs)
    near(regions[0].endMs, 7000 + DEFAULT_VAD.padMs)
    near(regions[1].startMs, 12000 - DEFAULT_VAD.padMs)
    near(regions[1].endMs, 14000) // padding is clamped to the track (to its last frame)
  })

  it('keeps a pause of a second or more as two regions', () => {
    const pcm = synth([{ sec: 1, kind: 'noise' }, { sec: 1, kind: 'tone' }, { sec: 2, kind: 'noise' }, { sec: 1, kind: 'tone' }, { sec: 1, kind: 'noise' }])
    expect(detectSpeech(collect(pcm).frameDb)).toHaveLength(2)
  })

  it('finds nothing in an all-silent or all-background track', () => {
    expect(detectSpeech(collect(synth([{ sec: 5, kind: 'zero' }])).frameDb)).toEqual([])
    expect(detectSpeech(collect(synth([{ sec: 5, kind: 'noise' }])).frameDb)).toEqual([])
  })

  it('clamps the threshold between the configured bounds', () => {
    expect(speechThresholdDb([SILENT_DB, SILENT_DB])).toBeNull()
    expect(speechThresholdDb([-90, -90, -90])).toBe(DEFAULT_VAD.minThresholdDb)
    expect(speechThresholdDb([-20, -20, -20])).toBe(DEFAULT_VAD.maxThresholdDb) // non-stop talker: quiet speech still counts
    expect(speechThresholdDb([-55, -55, -55])).toBe(-45)
  })
})

describe('chunking', () => {
  it('splits an over-long region at a quiet frame, never over the limit', () => {
    const frameDb = new Float32Array(Math.ceil(1_500_000 / FRAME_MS)).fill(-20)
    frameDb[Math.floor(590_000 / FRAME_MS)] = -50
    const parts = splitLongRegions([{ startMs: 0, endMs: 1_500_000 }], frameDb)
    expect(parts[0]).toEqual({ startMs: 0, endMs: Math.floor(590_000 / FRAME_MS) * FRAME_MS })
    for (const p of parts) expect(p.endMs - p.startMs).toBeLessThanOrEqual(MAX_CHUNK_MS)
    expect(parts[parts.length - 1].endMs).toBe(1_500_000)
    for (let i = 1; i < parts.length; i++) expect(parts[i].startMs).toBe(parts[i - 1].endMs)
  })

  it('packs regions into chunks of at most the limit, with a gap between regions', () => {
    const regions: Region[] = Array.from({ length: 40 }, (_, i) => ({ startMs: i * 120_000, endMs: i * 120_000 + 50_000 }))
    const chunks = planChunks(regions)
    expect(chunks.length).toBe(4) // 11 regions fit in 600 s (11 * 50 s + 10 gaps)
    for (const c of chunks) {
      expect(c.durationMs).toBeLessThanOrEqual(MAX_CHUNK_MS)
      for (let i = 1; i < c.pieces.length; i++) {
        const prev = c.pieces[i - 1]
        expect(c.pieces[i].chunkStartMs).toBe(prev.chunkStartMs + prev.srcEndMs - prev.srcStartMs + CHUNK_GAP_MS)
      }
    }
    expect(chunks.flatMap((c) => c.pieces).map((p) => p.srcStartMs)).toEqual(regions.map((r) => r.startMs))
    expect(planChunks([])).toEqual([])
    expect(() => planChunks([{ startMs: 0, endMs: MAX_CHUNK_MS + 1 }])).toThrow()
  })

  it('every chunk renders under the 25 MB upload limit', () => {
    const frameDb = new Float32Array(Math.ceil(3_600_000 / FRAME_MS)).fill(-20)
    const plan = planSpeech({ frameDb, frames: new Map(), totalSamples: 3600 * SAMPLE_RATE, decodeErrors: 0 })
    expect(plan.chunks.length).toBe(6)
    for (const c of plan.chunks) expect(renderChunkWav({ frameDb, frames: new Map(), totalSamples: 3600 * SAMPLE_RATE, decodeErrors: 0 }, c).byteLength).toBeLessThan(25 * 1024 * 1024)
  })
})

describe('offset map', () => {
  const chunk: Chunk = planChunks([
    { startMs: 10_000, endMs: 12_000 },
    { startMs: 30_000, endMs: 31_000 },
    { startMs: 90_000, endMs: 95_000 },
  ])[0]

  it('round-trips call time through chunk time', () => {
    for (const t of [10_000, 11_234, 12_000, 30_000, 30_500, 90_000, 94_999]) expect(chunkToCallMs(chunk, callToChunkMs(chunk, t)!, 'start')).toBe(t)
    expect(callToChunkMs(chunk, 20_000)).toBeNull()
    expect(chunk.pieces.map((p) => p.chunkStartMs)).toEqual([0, 2500, 4000])
  })

  it('snaps times in the inserted silence to the nearest speech edge', () => {
    expect(chunkToCallMs(chunk, 2200, 'start')).toBe(30_000)
    expect(chunkToCallMs(chunk, 2200, 'end')).toBe(12_000)
    expect(chunkToCallMs(chunk, 99_999, 'end')).toBe(95_000)
  })

  it('maps Whisper segments back to call seconds', () => {
    const mapped = mapChunkSegments(chunk, [
      { start: 0.5, end: 1.5, text: 'a' },
      { start: 1.8, end: 3.0, text: 'b' }, // spans the gap into the second region
      { start: 4.0, end: 9.0, text: 'c' },
    ])
    expect(mapped.map((s) => [s.start, s.end, s.text])).toEqual([
      [10.5, 11.5, 'a'],
      [11.8, 30.5, 'b'],
      [90, 95, 'c'],
    ])
  })
})

describe('WAV rendering', () => {
  it('writes a 16 kHz mono 16-bit WAV with the pieces in place and silence between them', () => {
    const pcm = synth([{ sec: 1, kind: 'zero' }, { sec: 1, kind: 'tone' }, { sec: 1, kind: 'zero' }, { sec: 1, kind: 'tone' }])
    const track = collect(pcm)
    const chunk = planChunks([{ startMs: 1000, endMs: 2000 }, { startMs: 3000, endMs: 4000 }])[0]
    const wav = renderChunkWav(track, chunk)
    const view = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    const samples = new Int16Array(wav.buffer, 44)
    expect(samples.length).toBe(2.5 * SAMPLE_RATE)
    expect(samples[100]).toBe(Math.round(pcm[SAMPLE_RATE + 100] * 32767))
    expect(samples.subarray(SAMPLE_RATE, 1.5 * SAMPLE_RATE).every((s) => s === 0)).toBe(true)
    expect(samples[1.5 * SAMPLE_RATE + 7]).toBe(Math.round(pcm[3 * SAMPLE_RATE + 7] * 32767))
  })
})

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('decoding a real Ogg/Opus track', () => {
  it('rejects bytes that are not Ogg/Opus', async () => {
    await expect(decodeOggOpus(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  // Builds a track the way the recorder does (silence-padded, libopus 32k mono). Skipped without ffmpeg.
  it.skipIf(!hasFfmpeg())('decodes to call-aligned 16 kHz frames and finds the speech', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'speech-test-'))
    try {
      const file = path.join(dir, 'track.ogg')
      execFileSync('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'anoisesrc=d=8:c=pink:a=0.2',
        '-f', 'lavfi', '-i', 'sine=f=220:d=5',
        '-filter_complex', '[0:a]adelay=20000:all=1[a];[1:a]volume=0.3,adelay=60000:all=1[b];[a][b]amix=inputs=2:normalize=0:duration=longest,apad=whole_dur=90[out]',
        '-map', '[out]', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', file,
      ])
      const track = await decodeOggOpus(new Uint8Array(readFileSync(file)))
      near(track.totalSamples / SAMPLE_RATE, 90, 0.05)
      const plan = planSpeech(track)
      expect(plan.regions).toHaveLength(2)
      near(plan.regions[0].startMs, 20_000 - DEFAULT_VAD.padMs, 60)
      near(plan.regions[0].endMs, 28_000 + DEFAULT_VAD.padMs, 60)
      near(plan.regions[1].startMs, 60_000 - DEFAULT_VAD.padMs, 60)
      near(plan.regions[1].endMs, 65_000 + DEFAULT_VAD.padMs, 60)
      expect(plan.chunks).toHaveLength(1)
      near(plan.speechMs, 13_000 + 4 * DEFAULT_VAD.padMs, 200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
