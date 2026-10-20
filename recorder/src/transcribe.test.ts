import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { appendRecord, summarize, readManifest } from './manifest.js'
import { finalizeSession, MAX_TRANSCRIBE_ATTEMPTS, writeSessionMeta } from './finalize.js'
import type { IngestPayload } from './types.js'
import {
  buildConcatList,
  buildOffsetMap,
  mergeTranscripts,
  parseDeepgram,
  remapUtterances,
  resetNoKeyWarning,
  speechToCallMs,
  TranscriptionFailedError,
  transcribeSession,
  transcribeWithDeepgram,
  type DeepgramResult,
  type FetchLike,
} from './transcribe.js'

describe('offset map', () => {
  // speech track = [A 2s][B 3s]; A was at call 10s, B at 60s
  const map = buildOffsetMap([
    { callStartMs: 60_000, durMs: 3000 },
    { callStartMs: 10_000, durMs: 2000 },
  ])

  it('orders parts by call time and accumulates speech offsets', () => {
    expect(map.map((m) => m.speechStartMs)).toEqual([0, 2000])
    expect(map.map((m) => m.callStartMs)).toEqual([10_000, 60_000])
  })

  it('maps speech time back to call time', () => {
    expect(speechToCallMs(map, 0)).toBe(10_000)
    expect(speechToCallMs(map, 1500)).toBe(11_500)
    expect(speechToCallMs(map, 2000)).toBe(60_000)
    expect(speechToCallMs(map, 4500)).toBe(62_500)
  })

  it('clamps times past the end into the last part', () => {
    expect(speechToCallMs(map, 99_000)).toBe(63_000)
  })

  it('remaps utterances (seconds) and drops empty text', () => {
    const out = remapUtterances(
      [
        { start: 0.5, end: 1.5, transcript: ' hello ' },
        { start: 2.0, end: 3.0, transcript: 'world' },
        { start: 3.0, end: 3.5, transcript: '  ' },
      ],
      map,
    )
    expect(out).toEqual([
      { startMs: 10_500, endMs: 11_500, text: 'hello' },
      { startMs: 60_000, endMs: 61_000, text: 'world' },
    ])
  })
})

describe('mergeTranscripts', () => {
  it('interleaves speakers by start time', () => {
    const out = mergeTranscripts([
      { discordId: 'A', utterances: [{ startMs: 0, endMs: 2000, text: 'hi' }, { startMs: 9000, endMs: 10_000, text: 'later' }] },
      { discordId: 'B', utterances: [{ startMs: 3000, endMs: 5000, text: 'hello' }] },
    ])
    expect(out.map((t) => `${t.discordId}:${t.text}`)).toEqual(['A:hi', 'B:hello', 'A:later'])
  })

  it('joins the same speaker within the gap and splits after it', () => {
    const out = mergeTranscripts([
      {
        discordId: 'A',
        utterances: [
          { startMs: 0, endMs: 1000, text: 'one' },
          { startMs: 2000, endMs: 3000, text: 'two' }, // 1000ms gap: joined
          { startMs: 4500, endMs: 5000, text: 'three' }, // 1500ms gap: new turn
        ],
      },
    ])
    expect(out).toEqual([
      { discordId: 'A', startMs: 0, endMs: 3000, text: 'one two' },
      { discordId: 'A', startMs: 4500, endMs: 5000, text: 'three' },
    ])
  })

  it('a different speaker in between breaks the turn even with a short gap', () => {
    const out = mergeTranscripts([
      { discordId: 'A', utterances: [{ startMs: 0, endMs: 1000, text: 'a1' }, { startMs: 1800, endMs: 2500, text: 'a2' }] },
      { discordId: 'B', utterances: [{ startMs: 1100, endMs: 1700, text: 'b' }] },
    ])
    expect(out.map((t) => t.discordId)).toEqual(['A', 'B', 'A'])
  })

  it('returns nothing for no speech', () => {
    expect(mergeTranscripts([{ discordId: 'A', utterances: [] }])).toEqual([])
  })
})

describe('helpers', () => {
  it('escapes quotes in the concat list', () => {
    expect(buildConcatList(["/d/it's.ogg"])).toBe("file '/d/it'\\''s.ogg'\n")
  })

  it('parses a Deepgram response and tolerates junk', () => {
    const r = parseDeepgram({ results: { utterances: [{ start: 0, end: 1, transcript: 'x' }, { start: 'a' }], channels: [{ detected_language: 'es' }] } })
    expect(r).toEqual({ utterances: [{ start: 0, end: 1, transcript: 'x' }], language: 'es' })
    expect(parseDeepgram(null)).toEqual({ utterances: [], language: null })
  })
})

describe('transcribeWithDeepgram', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'dg-')), 'a.ogg')
  writeFileSync(file, 'audio')
  const res = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => 'err' })

  it('sends the key as a Token header and parses utterances', async () => {
    let seen: Record<string, string> = {}
    const fetch: FetchLike = async (_u, init) => {
      seen = init.headers
      return res(200, { results: { utterances: [{ start: 0, end: 1, transcript: 'hi' }] } })
    }
    const out = await transcribeWithDeepgram(file, 'secret', { fetch })
    expect(seen.Authorization).toBe('Token secret')
    expect(out.utterances).toHaveLength(1)
  })

  it('retries 5xx then succeeds; does not retry 4xx; never leaks the key in errors', async () => {
    let n = 0
    const flaky: FetchLike = async () => (++n < 3 ? res(503) : res(200, { results: {} }))
    await transcribeWithDeepgram(file, 'secret', { fetch: flaky, sleep: async () => {} })
    expect(n).toBe(3)

    let calls = 0
    const bad: FetchLike = async () => (calls++, res(401))
    await expect(transcribeWithDeepgram(file, 'secret', { fetch: bad, sleep: async () => {} })).rejects.toThrow(/401/)
    expect(calls).toBe(1)
    await expect(transcribeWithDeepgram(file, 'secret', { fetch: bad, sleep: async () => {} })).rejects.not.toThrow(/secret/)
  })
})

function makeSession(users: Array<{ id: string; startMs: number; endMs: number }>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tx-'))
  writeSessionMeta(dir, { sessionId: 'ev1-1000', eventId: '1', eventName: 'x', channelId: 'c', startedAtMs: 1000, endedAtMs: 90_000, endReason: 'empty', partial: false })
  for (const u of users) {
    mkdirSync(path.join(dir, 'seg', u.id), { recursive: true })
    const file = `seg/${u.id}/${u.startMs}.ogg`
    writeFileSync(path.join(dir, file), 'ogg')
    appendRecord(dir, { t: 'member', userId: u.id, displayName: `User${u.id}` })
    appendRecord(dir, { t: 'segment', userId: u.id, startMs: u.startMs, endMs: u.endMs, file, bytes: 3 })
  }
  return dir
}

describe('transcribeSession', () => {
  beforeEach(() => resetNoKeyWarning())

  it('without a key skips transcription and logs once', async () => {
    const dir = makeSession([{ id: '111', startMs: 0, endMs: 2000 }])
    const logs: string[] = []
    const speakers = summarize(readManifest(dir))
    expect(await transcribeSession(dir, dir, speakers, { apiKey: undefined, log: (m) => logs.push(m) })).toBeNull()
    expect(await transcribeSession(dir, dir, speakers, { apiKey: undefined, log: (m) => logs.push(m) })).toBeNull()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/DEEPGRAM_API_KEY/)
  })

  it('transcribes each speaker, remaps to call time and merges', async () => {
    const dir = makeSession([
      { id: '111', startMs: 5000, endMs: 7000 },
      { id: '222', startMs: 1000, endMs: 3000 },
    ])
    const sent: string[] = []
    const out = await transcribeSession(dir, dir, summarize(readManifest(dir)), {
      apiKey: 'k',
      log: () => {},
      ffmpeg: async (args) => writeFileSync(args.at(-1)!, 'speech'),
      probeMs: async () => 2000,
      transcribeFile: async (file): Promise<DeepgramResult> => {
        sent.push(path.basename(file))
        return { utterances: [{ start: 0.5, end: 1.5, transcript: path.basename(file).startsWith('111') ? 'from 111' : 'from 222' }], language: 'en' }
      },
    })
    expect(out?.segments).toEqual([
      { discordId: '222', startMs: 1500, endMs: 2500, text: 'from 222' },
      { discordId: '111', startMs: 5500, endMs: 6500, text: 'from 111' },
    ])
    expect(out?.language).toBe('en')
    expect(sent.sort()).toEqual(['111.speech.ogg', '222.speech.ogg'])
  })

  it('never transcribes a speaker who is not in the list (opted out and purged)', async () => {
    const dir = makeSession([
      { id: '111', startMs: 0, endMs: 2000 },
      { id: '222', startMs: 3000, endMs: 5000 },
    ])
    appendRecord(dir, { t: 'purge', userId: '222' })
    const sent: string[] = []
    await transcribeSession(dir, dir, summarize(readManifest(dir)), {
      apiKey: 'k',
      log: () => {},
      ffmpeg: async (args) => writeFileSync(args.at(-1)!, 'speech'),
      probeMs: async () => 2000,
      transcribeFile: async (file) => {
        sent.push(path.basename(file))
        return { utterances: [{ start: 0, end: 1, transcript: 'x' }], language: null }
      },
    })
    expect(sent).toEqual(['111.speech.ogg'])
  })

  it('one failing speaker does not lose the others', async () => {
    const dir = makeSession([
      { id: '111', startMs: 0, endMs: 2000 },
      { id: '222', startMs: 3000, endMs: 5000 },
    ])
    const out = await transcribeSession(dir, dir, summarize(readManifest(dir)), {
      apiKey: 'k',
      log: () => {},
      ffmpeg: async (args) => writeFileSync(args.at(-1)!, 'speech'),
      probeMs: async () => 2000,
      transcribeFile: async (file) => {
        if (path.basename(file).startsWith('111')) throw new Error('boom')
        return { utterances: [{ start: 0, end: 1, transcript: 'ok' }], language: null }
      },
    })
    expect(out?.segments.map((s) => s.discordId)).toEqual(['222'])
  })

  it('throws when every speaker failed, so the caller can retry later', async () => {
    const dir = makeSession([{ id: '111', startMs: 0, endMs: 2000 }])
    await expect(
      transcribeSession(dir, dir, summarize(readManifest(dir)), {
        apiKey: 'k',
        log: () => {},
        ffmpeg: async (args) => writeFileSync(args.at(-1)!, 'speech'),
        probeMs: async () => 2000,
        transcribeFile: async () => {
          throw new Error('503')
        },
      }),
    ).rejects.toBeInstanceOf(TranscriptionFailedError)
  })

  it('drops cached words of someone who opted out since the cache was written', async () => {
    const dir = makeSession([
      { id: '111', startMs: 0, endMs: 2000 },
      { id: '222', startMs: 3000, endMs: 5000 },
    ])
    const opts = {
      apiKey: 'k',
      log: () => {},
      ffmpeg: async (args: string[]) => writeFileSync(args.at(-1)!, 'speech'),
      probeMs: async () => 2000,
      transcribeFile: async (): Promise<DeepgramResult> => ({ utterances: [{ start: 0, end: 1, transcript: 'x' }], language: null }),
    }
    const first = await transcribeSession(dir, dir, summarize(readManifest(dir)), opts)
    expect(first?.segments).toHaveLength(2)
    appendRecord(dir, { t: 'purge', userId: '222' })
    const second = await transcribeSession(dir, dir, summarize(readManifest(dir)), opts)
    expect(second?.segments.map((s) => s.discordId)).toEqual(['111'])
  })
})

describe('finalizeSession with a transcript', () => {
  const base = (dir: string, over: Record<string, unknown> = {}) => {
    const posted: IngestPayload[] = []
    return {
      posted,
      deps: {
        appBaseUrl: 'a',
        apiKey: 'k',
        log: () => {},
        ffmpeg: async (args: string[]) => writeFileSync(args.at(-1)!, 'a'),
        uploader: { put: async () => 1, pruneExcept: async () => 0 },
        postIngest: async (p: IngestPayload) => (posted.push(p), { ok: true as const, id: 'r', duplicate: false, keys: [] }),
        ...over,
      },
      dir,
    }
  }

  it('sends the transcript in the ingest payload', async () => {
    const { deps, posted, dir } = base(makeSession([{ id: '111', startMs: 0, endMs: 2000 }]), {
      transcribe: async () => ({ language: 'en', segments: [{ discordId: '111', startMs: 0, endMs: 1000, text: 'hi' }] }),
    })
    expect(await finalizeSession(dir, deps)).toBe('uploaded')
    expect(posted[0].transcript?.segments[0].text).toBe('hi')
  })

  it('only hands speakers with an uploaded track (post-purge) to the transcriber', async () => {
    const dir = makeSession([
      { id: '111', startMs: 0, endMs: 2000 },
      { id: '222', startMs: 3000, endMs: 5000 },
    ])
    appendRecord(dir, { t: 'purge', userId: '222' })
    let ids: string[] = []
    const { deps } = base(dir, {
      transcribe: async (_d: string, _o: string, sp: Array<{ userId: string }>) => ((ids = sp.map((s) => s.userId)), null),
    })
    await finalizeSession(dir, deps)
    expect(ids).toEqual(['111'])
  })

  it('without a Deepgram key it still ingests, with no transcript field', async () => {
    resetNoKeyWarning()
    const { deps, posted, dir } = base(makeSession([{ id: '111', startMs: 0, endMs: 2000 }]), { deepgramApiKey: undefined })
    expect(await finalizeSession(dir, deps)).toBe('uploaded')
    expect(posted[0].transcript).toBeUndefined()
  })

  it('total transcription failure keeps the session pending, then ingests without a transcript after the retries', async () => {
    const dir = makeSession([{ id: '111', startMs: 0, endMs: 2000 }])
    const { deps, posted } = base(dir, {
      deepgramApiKey: 'k',
      transcribe: async () => {
        throw new TranscriptionFailedError('all failed')
      },
    })
    for (let i = 1; i < MAX_TRANSCRIBE_ATTEMPTS; i++) {
      expect(await finalizeSession(dir, deps)).toBe('pending')
      expect(posted).toHaveLength(0)
    }
    expect(await finalizeSession(dir, deps)).toBe('uploaded')
    expect(posted).toHaveLength(1)
    expect(posted[0].transcript).toBeUndefined()
  })

  it('a transcriber crash does not block the ingest', async () => {
    const { deps, posted, dir } = base(makeSession([{ id: '111', startMs: 0, endMs: 2000 }]), {
      transcribe: async () => {
        throw new Error('x')
      },
    })
    expect(await finalizeSession(dir, deps)).toBe('uploaded')
    expect(posted[0].transcript).toBeUndefined()
  })
})
