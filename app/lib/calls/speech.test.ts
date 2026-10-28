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
  LevelMeter,
  MAX_CHUNK_MS,
  SAMPLE_RATE,
  SILENT_DB,
  SpeechExtractor,
  analyzeTrack,
  callToChunkMs,
  chunkToCallMs,
  detectSpeech,
  downmix,
  extractSpeech,
  mapChunkResult,
  planChunks,
  planFingerprint,
  wordJoiner,
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

/** Feed PCM in odd-sized pieces, like the decoder does. */
function feed(pcm: Float32Array, sink: { push(p: Float32Array): void }, pieceSize = 1234) {
  for (let i = 0; i < pcm.length; i += pieceSize) sink.push(pcm.subarray(i, i + pieceSize))
}
function levels(pcm: Float32Array) {
  const m = new LevelMeter()
  feed(pcm, m)
  return m.finish()
}

const near = (actual: number, expected: number, tol = FRAME_MS) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol)
const FIXTURE = path.join(__dirname, '__fixtures__', 'tone-noise.ogg')

describe('level meter', () => {
  it('keeps one level per 30 ms frame and marks digital silence', () => {
    const t = levels(synth([{ sec: 3, kind: 'zero' }, { sec: 1, kind: 'tone' }, { sec: 2, kind: 'zero' }]))
    expect(t.totalSamples).toBe(6 * SAMPLE_RATE)
    expect(t.frameDb).toBeInstanceOf(Float32Array)
    expect(t.frameDb.length).toBe(200)
    expect(t.frameDb[0]).toBe(SILENT_DB)
    expect(t.frameDb[110]).toBeGreaterThan(-15) // 0.3 amplitude sine is about -13 dBFS
  })

  it('averages channels when downmixing', () => {
    const out = downmix([Float32Array.from([1, 0.5, 0]), Float32Array.from([0, 0.5, 1])], 3)
    expect([...out]).toEqual([0.5, 0.5, 0.5])
    const mono = Float32Array.from([0.1, 0.2, 0.3])
    expect(downmix([mono], 2)).toEqual(mono.subarray(0, 2))
    expect(downmix([], 0).length).toBe(0)
  })
})

describe('speech extraction', () => {
  it('keeps samples only inside the wanted regions', () => {
    const pcm = synth([{ sec: 1, kind: 'zero' }, { sec: 1, kind: 'tone' }, { sec: 1, kind: 'zero' }, { sec: 1, kind: 'tone' }])
    const ex = new SpeechExtractor([{ startMs: 1000, endMs: 2000 }, null, { startMs: 3000, endMs: 3500 }])
    feed(pcm, ex, 777)
    const [a, skipped, c] = ex.finish()
    expect(skipped).toBeUndefined()
    expect(a!.length).toBe(SAMPLE_RATE)
    expect(c!.length).toBe(SAMPLE_RATE / 2)
    expect(a![123]).toBe(Math.round(pcm[SAMPLE_RATE + 123] * 32767))
    expect(c![c!.length - 1]).toBe(Math.round(pcm[3.5 * SAMPLE_RATE - 1] * 32767))
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
    const regions = detectSpeech(levels(pcm).frameDb)
    expect(regions).toHaveLength(2)
    near(regions[0].startMs, 3000 - DEFAULT_VAD.padMs)
    near(regions[0].endMs, 7000 + DEFAULT_VAD.padMs)
    near(regions[1].startMs, 12000 - DEFAULT_VAD.padMs)
    near(regions[1].endMs, 14000) // padding is clamped to the track (to its last frame)
  })

  it('keeps a pause of a second or more as two regions', () => {
    const pcm = synth([{ sec: 1, kind: 'noise' }, { sec: 1, kind: 'tone' }, { sec: 2, kind: 'noise' }, { sec: 1, kind: 'tone' }, { sec: 1, kind: 'noise' }])
    expect(detectSpeech(levels(pcm).frameDb)).toHaveLength(2)
  })

  it('finds nothing in an all-silent or all-background track', () => {
    expect(detectSpeech(levels(synth([{ sec: 5, kind: 'zero' }])).frameDb)).toEqual([])
    expect(detectSpeech(levels(synth([{ sec: 5, kind: 'noise' }])).frameDb)).toEqual([])
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
    expect(chunks.length).toBe(4) // 11 regions fit in 600 s (11 * 50 s + 10 gaps of 1.5 s)
    for (const c of chunks) {
      expect(c.durationMs).toBeLessThanOrEqual(MAX_CHUNK_MS)
      for (let i = 1; i < c.pieces.length; i++) {
        const prev = c.pieces[i - 1]
        expect(c.pieces[i].chunkStartMs).toBe(prev.chunkStartMs + prev.srcEndMs - prev.srcStartMs + CHUNK_GAP_MS)
      }
    }
    const pieces = chunks.flatMap((c) => c.pieces)
    expect(pieces.map((p) => p.srcStartMs)).toEqual(regions.map((r) => r.startMs))
    expect(pieces.map((p) => p.region)).toEqual(regions.map((_, i) => i))
    expect(planChunks([])).toEqual([])
    expect(() => planChunks([{ startMs: 0, endMs: MAX_CHUNK_MS + 1 }])).toThrow()
  })

  it('every chunk renders under the 25 MB upload limit', () => {
    const frameDb = new Float32Array(Math.ceil(3_600_000 / FRAME_MS)).fill(-20)
    const plan = planSpeech({ frameDb })
    expect(plan.chunks.length).toBe(6)
    for (const c of plan.chunks) expect(renderChunkWav(c, []).byteLength).toBeLessThan(25 * 1024 * 1024)
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
    expect(chunk.pieces.map((p) => p.chunkStartMs)).toEqual([0, 3500, 6000])
  })

  it('snaps times in the inserted silence to the nearest speech edge', () => {
    expect(chunkToCallMs(chunk, 2500, 'start')).toBe(30_000)
    expect(chunkToCallMs(chunk, 2500, 'end')).toBe(12_000)
    expect(chunkToCallMs(chunk, 99_999, 'end')).toBe(95_000)
  })

  it('maps segments inside one region, including ones ending in the following silence', () => {
    const out = mapChunkResult(chunk, [
      { start: 0.5, end: 1.5, text: 'a' },
      { start: 1.8, end: 2.6, text: 'b' }, // ends in the gap: cut at its region's end
      { start: 6.0, end: 11.0, text: 'c' },
    ])
    expect(out.segments.map((s) => [s.start, s.end, s.text])).toEqual([
      [10.5, 11.5, 'a'],
      [11.8, 12, 'b'],
      [90, 95, 'c'],
    ])
    expect(out.split).toBe(0)
    expect(out.capped).toBe(0)
  })

  // Realistic Whisper output: segment times are a few tenths off the word times, words carry no
  // punctuation, segment text does.
  const realistic = {
    segments: [
      { start: 0.0, end: 1.4, text: ' Hello there.', avg_logprob: -0.1 },
      { start: 1.4, end: 4.5, text: ' We should order more pizza.', avg_logprob: -0.2 }, // runs from region 1 into region 2
      { start: 6.2, end: 8.0, text: ' See you!', avg_logprob: -0.3 },
    ],
    words: [
      { word: 'Hello', start: 0.2, end: 0.5 },
      { word: 'there', start: 0.5, end: 1.0 },
      { word: 'We', start: 1.6, end: 1.8 },
      { word: 'should', start: 1.8, end: 1.95 },
      { word: 'order', start: 3.7, end: 3.9 },
      { word: 'more', start: 3.9, end: 4.1 },
      { word: 'pizza', start: 4.1, end: 4.4 },
      { word: 'See', start: 6.5, end: 6.8 },
      { word: 'you', start: 6.8, end: 7.3 },
    ],
  }

  it('splits only the segment that crosses a region boundary, by word times, keeping other text as is', () => {
    const out = mapChunkResult(chunk, realistic.segments, realistic.words)
    expect(out.segments.map((s) => [s.start, s.end, s.text])).toEqual([
      [10, 11.4, ' Hello there.'], // untouched text, punctuation kept
      [11.6, 11.95, 'We should'],
      [30.2, 30.9, 'order more pizza.'], // the segment's final punctuation stays on the last part
      [90.2, 92, ' See you!'],
    ])
    expect(out.segments[2].avg_logprob).toBe(-0.2) // confidence fields carry over to both parts
    expect(out.split).toBe(1)
    expect(out.capped).toBe(0)
    // No word dropped or repeated across the parts.
    const said = out.segments.flatMap((s) => s.text.replace(/[.!]/g, '').trim().split(/\s+/))
    expect(said).toEqual(realistic.words.map((w) => w.word))
  })

  it('gives a word outside every segment span to the nearest segment instead of dropping it', () => {
    // The segment ends at 4.2 s but its last two words run to 4.45 s.
    const words = [...realistic.words.slice(2, 7), { word: 'now', start: 4.4, end: 4.45 }]
    const out = mapChunkResult(chunk, [{ start: 1.4, end: 4.2, text: ' We should order more pizza now.' }], words)
    expect(out.segments.map((s) => s.text)).toEqual(['We should', 'order more pizza now.'])
  })

  it('joins words without spaces for languages written without them', () => {
    expect(wordJoiner('ja')).toBe('')
    expect(wordJoiner('chinese')).toBe('')
    expect(wordJoiner('en')).toBe(' ')
    expect(wordJoiner(null)).toBe(' ')
    const out = mapChunkResult(
      chunk,
      [{ start: 1.5, end: 4.2, text: '今日はピザです。' }],
      [
        { word: '今日', start: 1.6, end: 1.8 },
        { word: 'は', start: 1.8, end: 1.9 },
        { word: 'ピザ', start: 3.6, end: 3.9 },
        { word: 'です', start: 3.9, end: 4.1 },
      ],
      wordJoiner('ja'),
    )
    expect(out.segments.map((s) => s.text)).toEqual(['今日は', 'ピザです。'])
  })

  it('the plan fingerprint changes with the regions', () => {
    const a = planFingerprint([{ startMs: 0, endMs: 1000 }])
    expect(planFingerprint([{ startMs: 0, endMs: 1000 }])).toBe(a)
    expect(planFingerprint([{ startMs: 0, endMs: 1030 }])).not.toBe(a)
    expect(planFingerprint([{ startMs: 0, endMs: 1000 }], MAX_CHUNK_MS / 2)).not.toBe(a)
    expect(planFingerprint([{ startMs: 0, endMs: 1000 }], MAX_CHUNK_MS, CHUNK_GAP_MS + 1)).not.toBe(a)
  })

  it('without word times, cuts a crossing segment at the end of its first region', () => {
    const out = mapChunkResult(chunk, [{ start: 1.2, end: 4.2, text: 'we should order more pizza' }])
    expect(out.segments.map((s) => [s.start, s.end])).toEqual([[11.2, 12]])
    expect(out.capped).toBe(1)
  })
})

describe('WAV rendering', () => {
  it('writes a 16 kHz mono 16-bit WAV with the pieces in place and silence between them', () => {
    const pcm = synth([{ sec: 1, kind: 'zero' }, { sec: 1, kind: 'tone' }, { sec: 1, kind: 'zero' }, { sec: 1, kind: 'tone' }])
    const regions = [{ startMs: 1000, endMs: 2000 }, { startMs: 3000, endMs: 4000 }]
    const ex = new SpeechExtractor(regions)
    feed(pcm, ex)
    const chunk = planChunks(regions)[0]
    const wav = renderChunkWav(chunk, ex.finish())
    const view = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    const samples = new Int16Array(wav.buffer, 44)
    const gap = (CHUNK_GAP_MS / 1000) * SAMPLE_RATE
    expect(samples.length).toBe(2 * SAMPLE_RATE + gap)
    expect(samples[100]).toBe(Math.round(pcm[SAMPLE_RATE + 100] * 32767))
    expect(samples.subarray(SAMPLE_RATE, SAMPLE_RATE + gap).every((s) => s === 0)).toBe(true)
    expect(samples[SAMPLE_RATE + gap + 7]).toBe(Math.round(pcm[3 * SAMPLE_RATE + 7] * 32767))
  })
})

describe('decoding a real Ogg/Opus track', () => {
  it('rejects bytes that are not Ogg/Opus', async () => {
    await expect(analyzeTrack(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  // Checked-in synthetic fixture (no voices): 7 s, a tone at 2-3 s and noise at 4.5-6 s, libopus 16k mono.
  it('decodes the fixture to call-aligned 16 kHz levels, finds the sounds and extracts them', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE))
    const levels = await analyzeTrack(bytes)
    near(levels.totalSamples / SAMPLE_RATE, 7, 0.05)
    const plan = planSpeech(levels)
    expect(plan.regions).toHaveLength(2)
    near(plan.regions[0].startMs, 2000 - DEFAULT_VAD.padMs, 60)
    near(plan.regions[0].endMs, 3000 + DEFAULT_VAD.padMs, 60)
    near(plan.regions[1].startMs, 4500 - DEFAULT_VAD.padMs, 60)
    near(plan.regions[1].endMs, 6000 + DEFAULT_VAD.padMs, 60)
    const pcm = await extractSpeech(bytes, [plan.regions[0], null])
    expect(pcm[1]).toBeUndefined()
    const tone = pcm[0]!
    expect(tone.length).toBe(Math.round(((plan.regions[0].endMs - plan.regions[0].startMs) / 1000) * SAMPLE_RATE))
    let peak = 0
    for (const s of tone) peak = Math.max(peak, Math.abs(s))
    expect(peak).toBeGreaterThan(1000) // the tone (sine at 1/8 amplitude, volume 0.3: peak ~1230) is in there
  })

  function hasFfmpeg(): boolean {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  // A longer track built the way the recorder does (silence-padded, libopus 32k). Skipped without ffmpeg.
  it.skipIf(!hasFfmpeg())('finds the speech in a 90 s silence-padded track', async () => {
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
      const plan = planSpeech(await analyzeTrack(new Uint8Array(readFileSync(file))))
      expect(plan.regions).toHaveLength(2)
      near(plan.regions[0].startMs, 20_000 - DEFAULT_VAD.padMs, 60)
      near(plan.regions[1].endMs, 65_000 + DEFAULT_VAD.padMs, 60)
      expect(plan.chunks).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
