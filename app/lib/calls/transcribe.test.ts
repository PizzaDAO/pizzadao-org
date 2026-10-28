// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('./r2', () => ({ getObjectBytes: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn() } }))

import { prisma } from '@/app/lib/db'
import { cleanSegments, dropRepeatRuns, isWav, MAX_UPLOAD_BYTES, mergeSpeakerTurns, transcribeAudio, transcribeRecording, START_BUDGET_MS, TOO_MUCH_AUDIO_ERROR, USED_OPENAI, type WhisperResult } from './transcribe'
import { FRAME_MS, SILENT_DB, renderChunkWav, type Region, type TrackLevels } from './speech'
import { generateAndStoreSummary, publishRecording, setSpeakerRedacted, updateRecordingText } from './recordings'
import { generateText } from 'ai'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const ANN = '111111111111111111'
const BOB = '222222222222222222'
const u = (startMs: number, text: string, endMs = startMs + 1000) => ({ startMs, endMs, text })

beforeEach(() => vi.clearAllMocks())

describe('hallucination filtering', () => {
  it('drops runs of 3+ identical lines and filler pairs, keeps one of a real pair', () => {
    const out = dropRepeatRuns([u(0, 'Thank you.'), u(1000, 'thank you'), u(2000, 'Real point'), u(3000, 'Same thing.'), u(4000, 'Same thing'), u(5000, 'Loop line'), u(6000, 'Loop line'), u(7000, 'Loop line'), u(8000, 'End')])
    expect(out.map((x) => x.text)).toEqual(['Real point', 'Same thing.', 'End'])
  })
  it('drops low-confidence and looping segments', () => {
    const out = cleanSegments([
      { start: 0, end: 1, text: 'Hello', avg_logprob: -0.3, no_speech_prob: 0.01, compression_ratio: 1.2 },
      { start: 2, end: 3, text: 'Thanks for watching', avg_logprob: -1.4, no_speech_prob: 0.9, compression_ratio: 1.0 },
      { start: 4, end: 5, text: 'la la la la la', avg_logprob: -0.5, compression_ratio: 3.1 },
      { start: 6, end: 7, text: '   ' },
    ])
    expect(out).toEqual([{ startMs: 0, endMs: 1000, text: 'Hello' }])
  })
})

describe('merge', () => {
  it('orders speakers by time and joins same-speaker lines within the gap', () => {
    const turns = mergeSpeakerTurns([
      { discordId: ANN, utterances: [u(0, 'Hi', 500), u(800, 'there', 1200), u(9000, 'Later')] },
      { discordId: BOB, utterances: [u(3000, 'Hello')] },
    ])
    expect(turns.map((t) => [t.discordId, t.text])).toEqual([
      [ANN, 'Hi there'],
      [BOB, 'Hello'],
      [ANN, 'Later'],
    ])
  })
})

describe('transcribeAudio', () => {
  it('retries a 429 and never leaks the key in the error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'slow down' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ language: 'en', segments: [{ start: 0, end: 1, text: 'x' }] }) })
    const r = await transcribeAudio(new Uint8Array([1]), 'sk-secret', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} })
    expect(r.segments).toHaveLength(1)
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' })
    const err = await transcribeAudio(new Uint8Array([1]), 'sk-secret', { fetchImpl: bad as unknown as typeof fetch, sleep: async () => {} }).then(
      () => new Error('expected a rejection'),
      (e: Error) => e,
    )
    expect(err.message).toMatch(/401/)
    expect(err.message).not.toContain('sk-secret')
  })
})

describe('transcribeRecording', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    status: 'RECORDED',
    transcript: null,
    transcribedAt: null,
    transcribeAttempts: 0,
    transcribeTracks: null,
    redactedSpeakerIds: [],
    summaryEditedAt: null,
    updatedAt: new Date('2026-10-28T12:00:00Z'),
    speakers: [
      { discordId: ANN, trackKey: 'calls/s/tracks/a.ogg', talkTimeSec: 60 },
      { discordId: BOB, trackKey: 'calls/s/tracks/b.ogg', talkTimeSec: 30 },
    ],
    ...over,
  })
  const seg = (text: string) => ({ start: 1, end: 2, text, avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.1 })
  const ok = (text = 'hello') => async () => ({ segments: [seg(text)], language: 'en' })
  const writes = () => db.callRecording.updateMany.mock.calls.map((c) => c[0])
  const finalWrite = () => writes().find((a) => a.data.transcribedAt && !a.where.OR)

  beforeEach(() => {
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
  })

  it('does nothing without an OpenAI key', async () => {
    expect(await transcribeRecording('r1', { apiKey: '' })).toBe('no-key')
  })

  it('transcribes each track, merges with chat, summarizes without touching reviewer edits', async () => {
    const chat = { discordId: BOB, startMs: 1500, endMs: 1500, text: 'link', kind: 'chat', id: 'c:1' }
    db.callRecording.findUnique.mockResolvedValue(rec({ transcript: [chat] }))
    const summarize = vi.fn(async () => true)
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: ok(), summarize })
    expect(out).toBe('transcribed')
    const w = finalWrite()
    const stored = w.data.transcript as Array<{ discordId: string; kind?: string }>
    expect(stored.filter((s) => s.kind !== 'chat').map((s) => s.discordId).sort()).toEqual([ANN, BOB])
    expect(stored.some((s) => s.kind === 'chat')).toBe(true)
    expect(w.data.transcriptLanguage).toBe('english') // the 'en' hint is the default
    expect(w.data.status).toBeUndefined() // never parks the row in PROCESSING
    expect(summarize).toHaveBeenCalledWith('r1', { onlyIfEmpty: false, unlessEdited: true, budgetMs: expect.any(Number) })
  })

  it('never auto-regenerates a summary a reviewer edited', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ summaryEditedAt: new Date(), status: 'IN_REVIEW' }))
    const summarize = vi.fn(async () => true)
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: ok(), summarize })
    expect(summarize).not.toHaveBeenCalled()
  })

  it('does not overwrite a language with null', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('x')], language: null }), summarize: vi.fn(), language: null })
    expect('transcriptLanguage' in finalWrite().data).toBe(false)
  })

  it('does not even download the tracks of already-redacted speakers', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ redactedSpeakerIds: [BOB] }))
    const download = vi.fn(async () => new Uint8Array([1]))
    await transcribeRecording('r1', { apiKey: 'k', download, transcribe: ok(), summarize: vi.fn() })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith('calls/s/tracks/a.ogg')
  })

  it('saves each finished track, and a retry only does the remaining ones', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: ok(), summarize: vi.fn() })
    expect(writes().filter((a) => a.data.transcribeTracks && typeof a.data.transcribeTracks === 'object' && ANN in a.data.transcribeTracks).length).toBeGreaterThan(0)

    db.callRecording.updateMany.mockClear()
    db.callRecording.findUnique.mockResolvedValue(rec({ transcribeAttempts: 1, transcribeTracks: { [ANN]: { utterances: [{ startMs: 0, endMs: 1000, text: 'saved' }], language: 'en', talkTimeSec: 60 } } }))
    const download = vi.fn(async () => new Uint8Array([1]))
    const out = await transcribeRecording('r1', { apiKey: 'k', download, transcribe: ok('new'), summarize: vi.fn() })
    expect(out).toBe('transcribed')
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith('calls/s/tracks/b.ogg')
    const texts = (finalWrite().data.transcript as Array<{ text: string }>).map((s) => s.text)
    expect(texts).toContain('saved')
  })

  it('stops starting tracks after the budget and resumes next run without spending an attempt', async () => {
    const speakers = [ANN, BOB, '333333333333333333', '444444444444444444'].map((d) => ({ discordId: d, trackKey: `calls/s/tracks/${d}.ogg`, talkTimeSec: 10 }))
    db.callRecording.findUnique.mockResolvedValue(rec({ speakers }))
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(200_000)
    const download = vi.fn(async () => new Uint8Array([1]))
    const out = await transcribeRecording('r1', { apiKey: 'k', clock, download, transcribe: ok(), summarize: vi.fn() })
    expect(out).toBe('progress')
    expect(download).toHaveBeenCalledTimes(3)
    expect(writes().at(-1).data).toMatchObject({ transcribeError: 'progress', transcribeAttempts: { decrement: 1 } })
  })

  it('gives up permanently after 3 attempts and never calls OpenAI again', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ transcribeAttempts: 3 }))
    const transcribe = vi.fn()
    expect(await transcribeRecording('r1', { apiKey: 'k', transcribe })).toBe('failed')
    expect(transcribe).not.toHaveBeenCalled()
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })

  it('claims with an attempt increment and only when the 6 hour backoff allows', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    const transcribe = vi.fn()
    expect(await transcribeRecording('r1', { apiKey: 'k', transcribe })).toBe('busy')
    const claim = writes()[0]
    expect(claim.data).toMatchObject({ transcribeError: 'claimed', transcribeAttempts: { increment: 1 } })
    expect(claim.where.transcribeAttempts).toEqual({ lt: 3 })
    const or = claim.where.OR as Array<Record<string, unknown>>
    expect(or).toContainEqual({ transcribeError: null })
    expect(or.some((c) => 'updatedAt' in c)).toBe(true) // a stale 'claimed' / 'failed' waits for the backoff, not 15 minutes
    expect(or.some((c) => c.transcribeError === 'claimed')).toBe(false)
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('records a failure when every track fails, without transcribedAt', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const out = await transcribeRecording('r1', {
      apiKey: 'k',
      download: async () => new Uint8Array([1]),
      transcribe: async () => {
        throw new Error('OpenAI answered 500')
      },
      summarize: vi.fn(),
    })
    expect(out).toBe('failed')
    const last = writes().at(-1)
    expect(last.data.transcribeError).toMatch(/^failed:/)
    expect(last.data.transcribedAt).toBeUndefined()
  })

  it('on the last attempt keeps what it has (partial) instead of failing', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ transcribeAttempts: 2 }))
    let n = 0
    const out = await transcribeRecording('r1', {
      apiKey: 'k',
      download: async () => new Uint8Array([1]),
      transcribe: async () => {
        if (n++ === 0) return { segments: [seg('ok')], language: 'en' }
        throw new Error('boom')
      },
      summarize: vi.fn(),
    })
    expect(out).toBe('transcribed')
    expect(finalWrite().data.transcribeError).toMatch(/^partial:/)
  })

  it('marks calls whose tracks are all over the upload limit as permanently failed', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const transcribe = vi.fn()
    const out = await transcribeRecording('r1', {
      apiKey: 'k',
      download: async () => {
        throw new Error('Object is 99999999 bytes (limit 25165824)')
      },
      transcribe,
      summarize: vi.fn(),
    })
    expect(out).toBe('failed')
    expect(transcribe).not.toHaveBeenCalled()
    expect(writes().find((a) => a.data.transcribeAttempts === 3)).toBeTruthy()
  })

  it('does not overwrite a spoken transcript that appeared during the run, and guards the write on updatedAt', async () => {
    const t0 = new Date('2026-10-28T12:00:00Z')
    db.callRecording.findUnique.mockResolvedValueOnce(rec()).mockResolvedValueOnce({ transcript: null, updatedAt: t0 })
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: ok(), summarize: vi.fn() })
    expect(finalWrite().where.updatedAt).toBe(t0)

    db.callRecording.updateMany.mockClear()
    db.callRecording.findUnique
      .mockResolvedValueOnce(rec())
      .mockResolvedValueOnce({ transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'from the worker' }], updatedAt: t0 })
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: ok(), summarize: vi.fn() })
    expect(out).toBe('already-had-speech')
    expect(writes().some((a) => a.data.transcript)).toBe(false)
  })

  it('skips published calls and ones that already have spoken lines', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ status: 'PUBLISHED' }))
    expect(await transcribeRecording('r1', { apiKey: 'k' })).toBe('not-eligible')
    db.callRecording.findUnique.mockResolvedValue(rec({ transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'hi' }] }))
    const transcribe = vi.fn()
    expect(await transcribeRecording('r1', { apiKey: 'k', transcribe })).toBe('already-had-speech')
    expect(transcribe).not.toHaveBeenCalled()
  })
})

describe('cron stop rule', () => {
  it('stops after any run that called OpenAI, including an empty result, but not after a no-op', () => {
    for (const o of ['transcribed', 'empty-transcript', 'progress', 'failed'] as const) expect(USED_OPENAI.has(o)).toBe(true)
    for (const o of ['nothing-to-transcribe', 'already-had-speech', 'busy', 'not-eligible'] as const) expect(USED_OPENAI.has(o)).toBe(false)
  })
})

describe('reviewer edits and redactions leave markers', () => {
  it('updateRecordingText sets summaryEditedAt', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'r1', status: 'IN_REVIEW' })
    db.callRecording.update.mockResolvedValue({})
    expect(await updateRecordingText('r1', { summary: 'mine' })).toBe('ok')
    expect(db.callRecording.update.mock.calls[0][0].data.summaryEditedAt).toBeInstanceOf(Date)
  })
  it('hiding a speaker sets redactionsUpdatedAt', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'r1', status: 'IN_REVIEW', transcript: [], redactedSpeakerIds: [] })
    db.callRecording.update.mockResolvedValue({})
    await setSpeakerRedacted('r1', ANN, true)
    expect(db.callRecording.update.mock.calls[0][0].data.redactionsUpdatedAt).toBeInstanceOf(Date)
  })
  it('publishing an already-published call reports "already" (so no second recap)', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'r1', status: 'PUBLISHED' })
    expect(await publishRecording('r1', '9')).toBe('already')
  })
})

describe('second review fixes', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: 'r1', status: 'RECORDED', transcript: null, transcribedAt: null, transcribeAttempts: 0, transcribeTracks: null,
    redactedSpeakerIds: [], summaryEditedAt: null, updatedAt: new Date('2026-10-28T12:00:00Z'),
    speakers: [
      { discordId: ANN, trackKey: 'calls/s/tracks/a.ogg', talkTimeSec: 60 },
      { discordId: BOB, trackKey: 'calls/s/tracks/b.ogg', talkTimeSec: 30 },
    ],
    ...over,
  })
  const seg = (text: string) => ({ start: 1, end: 2, text, avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.1 })
  const writes = () => db.callRecording.updateMany.mock.calls.map((c) => c[0])

  it('stamps summaryGeneratedAt from BEFORE the row was read, so a redaction during generation counts as newer', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
      db.callRecording.findUnique.mockImplementation(async () => {
        vi.setSystemTime(new Date('2026-10-28T10:05:00Z')) // time passes while the row is read and the model runs
        return { id: 'r1', status: 'IN_REVIEW', transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'hi' }], redactedSpeakerIds: [], redactedSegmentIds: [], speakers: [] }
      })
      vi.mocked(generateText).mockResolvedValue({ output: { title: 'T', summary: 'S', actionItems: [], chapters: [] } } as never)
      db.callRecording.updateMany.mockResolvedValue({ count: 1 })
      await generateAndStoreSummary('r1')
      expect(db.callRecording.updateMany.mock.calls[1][0].data.summaryGeneratedAt).toEqual(new Date('2026-10-28T10:00:00Z'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('automatic summary writes never touch PUBLISHED or edited rows', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'r1', status: 'IN_REVIEW', transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'hi' }], redactedSpeakerIds: [], redactedSegmentIds: [], speakers: [] })
    vi.mocked(generateText).mockResolvedValue({ output: { title: 'T', summary: 'S', actionItems: [], chapters: [] } } as never)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    await generateAndStoreSummary('r1', { onlyIfEmpty: true, unlessEdited: true })
    const where = db.callRecording.updateMany.mock.calls[1][0].where // [0] is the attempt claim
    expect(where.status).toEqual({ notIn: ['REJECTED', 'PUBLISHED'] })
    expect(where.summaryEditedAt).toBeNull()
  })

  it('summaryEditedAt is set only when summary/action items/chapters text really changes', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'r1', status: 'IN_REVIEW', summary: 'S', actionItems: [{ text: 'a' }], chapters: [] })
    db.callRecording.update.mockResolvedValue({})
    await updateRecordingText('r1', { title: 'New title' })
    await updateRecordingText('r1', { title: 'New title', summary: 'S', actionItems: [{ text: 'a' }], chapters: [] }) // the form re-sends everything
    expect(db.callRecording.update.mock.calls.every((c) => c[0].data.summaryEditedAt === undefined)).toBe(true)
    await updateRecordingText('r1', { summary: 'S edited' })
    expect(db.callRecording.update.mock.calls.at(-1)![0].data.summaryEditedAt).toBeInstanceOf(Date)
  })

  it('permanent failure (last attempt, nothing usable) moves the row to review and summarizes chat', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ transcribeAttempts: 2 }))
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const summarize = vi.fn(async () => true)
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: async () => { throw new Error('500') }, summarize })
    expect(out).toBe('failed')
    expect(summarize).toHaveBeenCalledWith('r1', { onlyIfEmpty: true, unlessEdited: true, budgetMs: expect.any(Number) })
    expect(writes().some((a) => a.data.status === 'IN_REVIEW' && a.where.status.in.includes('RECORDED'))).toBe(true)
  })

  it('all-tracks-too-large also moves the row to review, and an early failure does not', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    await transcribeRecording('r1', { apiKey: 'k', download: async () => { throw new Error('Object is 99999999 bytes (limit 25165824)') }, transcribe: vi.fn(), summarize: vi.fn(async () => true) })
    expect(writes().some((a) => a.data.status === 'IN_REVIEW')).toBe(true)

    db.callRecording.updateMany.mockClear()
    db.callRecording.findUnique.mockResolvedValue(rec({ transcribeAttempts: 0 }))
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: async () => { throw new Error('500') }, summarize: vi.fn() })
    expect(writes().some((a) => a.data.status === 'IN_REVIEW')).toBe(false) // will be retried
  })

  it('persists track results one at a time, each write carrying every track saved so far', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const order: string[][] = []
    let first = true
    db.callRecording.updateMany.mockImplementation(async (arg: { data: { transcribeTracks?: Record<string, unknown> } }) => {
      if (arg.data.transcribeTracks && !('transcribedAt' in arg.data)) {
        const keys = Object.keys(arg.data.transcribeTracks)
        const slow = first
        first = false
        if (slow) await new Promise((r) => setTimeout(r, 30)) // the first commit is slow; a parallel second one must not overtake it
        order.push(keys)
      }
      return { count: 1 }
    })
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('x')], language: 'en' }), summarize: vi.fn() })
    expect(order).toHaveLength(2)
    expect(order[1].sort()).toEqual([ANN, BOB])
  })

  it('does not count a track whose result could not be saved', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    db.callRecording.updateMany.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
      if (arg.data.transcribeTracks && !arg.data.transcribeError) throw new Error('db down')
      return { count: 1 }
    })
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('x')], language: 'en' }), summarize: vi.fn() })
    expect(out).toBe('failed') // nothing was saved, so nothing counts as progress
  })

  it('the progress refund is guarded by our own claim and never goes below zero, and keeps the saved tracks', async () => {
    const speakers = [ANN, BOB, '333333333333333333', '444444444444444444'].map((d) => ({ discordId: d, trackKey: `calls/s/tracks/${d}.ogg`, talkTimeSec: 10 }))
    db.callRecording.findUnique.mockResolvedValue(rec({ speakers }))
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(200_000)
    expect(await transcribeRecording('r1', { apiKey: 'k', clock, download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('x')], language: null }), summarize: vi.fn() })).toBe('progress')
    const w = writes().at(-1)
    expect(w.where).toMatchObject({ transcribeError: 'claimed', transcribeAttempts: { gt: 0 } })
    expect(Object.keys(w.data.transcribeTracks)).toHaveLength(3)
  })

  it('counts OpenAI calls through usage even when the run ends busy', async () => {
    const usage = { calls: 0 }
    db.callRecording.findUnique.mockResolvedValue(rec())
    db.callRecording.updateMany.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ count: arg.data.transcribedAt ? 0 : 1 }))
    const out = await transcribeRecording('r1', { apiKey: 'k', usage, download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('x')], language: 'en' }), summarize: vi.fn() })
    expect(out).toBe('busy')
    expect(usage.calls).toBe(2)
  })
})

describe('speech-only transcription', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    status: 'RECORDED',
    transcript: null,
    transcribedAt: null,
    transcribeAttempts: 0,
    transcribeTracks: null,
    redactedSpeakerIds: [],
    summaryEditedAt: null,
    updatedAt: new Date('2026-10-28T12:00:00Z'),
    speakers: [{ discordId: ANN, trackKey: 'calls/s/tracks/a.ogg', talkTimeSec: 60 }],
    ...over,
  })
  const seg = (start: number, end: number, text: string) => ({ start, end, text, avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.1 })
  /** Levels of a track of `sec` seconds that is loud only in the given [startSec, endSec) ranges. */
  const track = (sec: number, loud: Array<[number, number]>): TrackLevels => {
    const frameDb = new Float32Array(Math.ceil((sec * 1000) / FRAME_MS)).fill(SILENT_DB)
    for (const [a, b] of loud) frameDb.fill(-20, Math.round((a * 1000) / FRAME_MS), Math.round((b * 1000) / FRAME_MS))
    return { frameDb, totalSamples: sec * 16000, decodeErrors: 0 }
  }
  const audio = (levels: TrackLevels) => ({ decode: async () => levels, extract: vi.fn(async () => [] as Array<Int16Array | undefined>) })
  const writes = () => db.callRecording.updateMany.mock.calls.map((c) => c[0])
  const finalWrite = () => writes().find((a) => a.data.transcribedAt && !a.where.OR)
  const statsOf = () => (finalWrite().data.transcribeStats as Record<string, Record<string, unknown>>)[ANN]
  const lastTracks = () => [...writes()].reverse().find((a) => a.data.transcribeTracks && typeof a.data.transcribeTracks === 'object')?.data.transcribeTracks as Record<string, unknown> | undefined

  beforeEach(() => {
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.findUnique.mockResolvedValue(rec())
  })

  it('sends only the speech as WAV and maps segment times back to call time', async () => {
    const sent: Uint8Array[] = []
    const transcribe = vi.fn(async (bytes: Uint8Array) => {
      sent.push(bytes)
      // Chunk layout (300 ms padding): call [100.2 s, 110.7 s] at 0 s, 1.5 s of silence, call [500.7 s, 519.3 s] at 12 s.
      return { segments: [seg(1, 3, 'first point'), seg(13, 14.5, 'second point')], language: 'english' }
    })
    const usage = { calls: 0 }
    const out = await transcribeRecording('r1', { apiKey: 'k', usage, download: async () => new Uint8Array([9]), ...audio(track(1200, [[100.5, 110.4], [501, 519]])), transcribe, summarize: vi.fn(async () => true) })
    expect(out).toBe('transcribed')
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(usage.calls).toBe(1)
    expect(isWav(sent[0])).toBe(true)
    // About 30 s of 16-bit 16 kHz audio instead of a 20 minute file.
    expect(sent[0].byteLength).toBeLessThan(32 * 16000 * 2)
    const stored = finalWrite().data.transcript as Array<{ startMs: number; text: string }>
    expect(stored.map((s) => [s.startMs, s.text])).toEqual([
      [101200, 'first point'],
      [501700, 'second point'],
    ])
    expect(statsOf()).toMatchObject({ mode: 'speech', chunks: 1, requests: 1, kept: 2, decodeErrors: 0, speechSec: 29, splitSegments: 0, cappedSegments: 0 })
    expect(statsOf().fallback).toBeUndefined()
  })

  it('splits a segment that runs across two regions using word times', async () => {
    const transcribe = vi.fn(async () => ({
      segments: [seg(9, 13.6, 'so the plan is pizza')],
      words: [
        { word: 'so', start: 9, end: 9.3 },
        { word: 'the', start: 9.3, end: 9.6 },
        { word: 'plan', start: 9.6, end: 10.1 },
        { word: 'is', start: 12.1, end: 12.4 },
        { word: 'pizza', start: 12.4, end: 13.0 },
      ],
      language: 'english',
    }))
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), ...audio(track(1200, [[100.5, 110.4], [501, 519]])), transcribe, summarize: vi.fn(async () => true) })
    const stored = finalWrite().data.transcript as Array<{ startMs: number; endMs: number; text: string }>
    expect(stored.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [109200, 110300, 'so the plan'],
      [500800, 501700, 'is pizza'],
    ])
    expect(statsOf()).toMatchObject({ splitSegments: 1, cappedSegments: 0 })
  })

  it('sends one request per chunk and keeps paid chunks when another chunk fails', async () => {
    // Five stretches of ~5 minutes: two fit in one 10 minute chunk, so three chunks.
    const levels = track(3600, [[0, 290], [600, 890], [1200, 1490], [1800, 2090], [2400, 2690]])
    let m = 0
    const ok = vi.fn(async () => ({ segments: [seg(1, 2, `part ${m++}`)], language: 'english' }))
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), ...audio(levels), transcribe: ok, summarize: vi.fn(async () => true) })
    expect(ok).toHaveBeenCalledTimes(3)
    expect(statsOf()).toMatchObject({ chunks: 3, requests: 3, kept: 3 })

    vi.clearAllMocks()
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.findUnique.mockResolvedValue(rec())
    let n = 0
    const flaky = vi.fn<(bytes: Uint8Array, key: string, deadline: number, opts: unknown) => Promise<WhisperResult>>(async () => {
      if (n++ === 1) throw new Error('OpenAI answered 500: oops Bearer sk-secret https://api.example/x')
      return { segments: [{ ...seg(1, 2, `earlier ${n}`), tokens: [1, 2, 3], seek: 0, temperature: 0 }], language: 'english' }
    })
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), ...audio(levels), transcribe: flaky, summarize: vi.fn(async () => true) })
    expect(out).toBe('progress') // the paid chunk is headway: no attempt is spent
    expect(finalWrite()).toBeUndefined()
    const tracksJson = lastTracks()!
    expect(ANN in tracksJson).toBe(false) // the track itself is not done
    const progress = (tracksJson._chunks as Record<string, { done: Record<string, unknown>; requests: number }>)[ANN]
    const doneBefore = Object.keys(progress.done).length
    const paidRequests = progress.requests
    expect(doneBefore).toBeGreaterThanOrEqual(1)
    expect(flaky.mock.calls[0][3]).toEqual({ language: 'en', words: true }) // word times only on speech chunks
    // Saved progress keeps only what the filters need (no tokens etc.).
    expect(Object.keys((Object.values(progress.done)[0] as object[])[0]).sort()).toEqual(['avg_logprob', 'compression_ratio', 'end', 'no_speech_prob', 'start', 'text'])
    // The chunk error is visible (sanitized) while the call waits for the next run.
    const progressWrite = writes().find((a) => a.data.transcribeError === 'progress')
    const lastError = (progressWrite.data.transcribeStats as { _progress: { lastError: string } })._progress.lastError
    expect(lastError).toContain('500')
    expect(lastError).not.toMatch(/sk-secret|https:|Bearer/)

    // The next run resumes: only the chunks not yet paid for are sent.
    vi.clearAllMocks()
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.findUnique.mockResolvedValue(rec({ transcribeTracks: tracksJson, transcribeError: 'progress' }))
    let k = 0
    const resumed = vi.fn(async () => ({ segments: [seg(1, 2, `point ${k++}`)], language: 'english' }))
    expect(await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), ...audio(levels), transcribe: resumed, summarize: vi.fn(async () => true) })).toBe('transcribed')
    expect(resumed).toHaveBeenCalledTimes(3 - doneBefore)
    expect((finalWrite().data.transcript as unknown[]).length).toBe(3)
    expect(statsOf()).toMatchObject({ chunks: 3, requests: paidRequests + 3 - doneBefore })
  })

  it('stops starting chunks after the start budget and resumes on the next run', async () => {
    const levels = track(3600, [[0, 290], [600, 890], [1200, 1490], [1800, 2090], [2400, 2690]])
    let now = 1_000_000
    const transcribe = vi.fn(async () => {
      now += START_BUDGET_MS + 1 // the first request uses up the budget
      return { segments: [seg(1, 2, 'words')], language: 'english' }
    })
    const out = await transcribeRecording('r1', { apiKey: 'k', clock: () => now, startedMs: now, download: async () => new Uint8Array([9]), ...audio(levels), transcribe, summarize: vi.fn(async () => true) })
    expect(out).toBe('progress')
    expect(transcribe).toHaveBeenCalledTimes(1)
    const progress = (lastTracks()!._chunks as Record<string, { done: Record<string, unknown> }>)[ANN]
    expect(Object.keys(progress.done)).toEqual(['0'])
  })

  it('a track without speech costs no OpenAI call', async () => {
    const transcribe = vi.fn()
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), ...audio(track(600, [])), transcribe, summarize: vi.fn(async () => true) })
    expect(out).toBe('empty-transcript')
    expect(transcribe).not.toHaveBeenCalled()
    expect(statsOf()).toMatchObject({ mode: 'speech', speechSec: 0, chunks: 0, requests: 0 })
  })

  it('does not attempt a track with more than the speech cap', async () => {
    const transcribe = vi.fn()
    const a = audio(track(4 * 3600, [[0, 4 * 3600]]))
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), ...a, transcribe, summarize: vi.fn(async () => true) })
    expect(out).toBe('failed')
    expect(transcribe).not.toHaveBeenCalled()
    expect(a.extract).not.toHaveBeenCalled()
    expect((lastTracks()![ANN] as { skipped: string }).skipped).toBe('too-much-audio')
    expect(writes().some((a) => a.data.transcribeError === TOO_MUCH_AUDIO_ERROR)).toBe(true)
  })

  it('names tracks with too much speech in the partial error', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ speakers: [
      { discordId: ANN, trackKey: 'calls/s/tracks/a.ogg', talkTimeSec: 60 },
      { discordId: BOB, trackKey: 'calls/s/tracks/b.ogg', talkTimeSec: 60 },
    ] }))
    const short = track(600, [[10, 20]])
    const huge = track(4 * 3600, [[0, 4 * 3600]])
    await transcribeRecording('r1', {
      apiKey: 'k',
      download: async (key) => new Uint8Array([key.endsWith('b.ogg') ? 2 : 1]),
      decode: async (b) => (b[0] === 2 ? huge : short),
      extract: async () => [],
      transcribe: async () => ({ segments: [seg(1, 2, 'hi')], language: 'english' }),
      summarize: vi.fn(async () => true),
    })
    expect(finalWrite().data.transcribeError).toBe('partial: 1 track(s) could not be transcribed (1 with too much speech)')
  })

  it('ignores saved chunk progress from a different chunk plan', async () => {
    const levels = track(3600, [[0, 290], [600, 890], [1200, 1490], [1800, 2090], [2400, 2690]])
    const stale = { _chunks: { [ANN]: { plan: 'some-other-plan', done: { 0: [seg(1, 2, 'stale words')] }, language: 'english', requests: 1, split: 0, capped: 0 } } }
    db.callRecording.findUnique.mockResolvedValue(rec({ transcribeTracks: stale }))
    let k = 0
    const transcribe = vi.fn(async () => ({ segments: [seg(1, 2, `fresh ${k++}`)], language: 'english' }))
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), ...audio(levels), transcribe, summarize: vi.fn(async () => true) })
    expect(transcribe).toHaveBeenCalledTimes(3)
    const texts = (finalWrite().data.transcript as Array<{ text: string }>).map((t) => t.text).join(' ')
    expect(texts).not.toContain('stale')
  })

  it('decodes one track at a time and extracts only the regions it will send', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ speakers: [
      { discordId: ANN, trackKey: 'calls/s/tracks/a.ogg', talkTimeSec: 60 },
      { discordId: BOB, trackKey: 'calls/s/tracks/b.ogg', talkTimeSec: 60 },
    ] }))
    let active = 0
    let maxActive = 0
    const levels = track(600, [[10, 20], [100, 110]])
    const decode = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return levels
    }
    const extract = vi.fn(async (_b: Uint8Array, regions: Array<Region | null>) => regions.map(() => undefined))
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([9]), decode, extract, transcribe: async () => ({ segments: [seg(1, 2, 'x')], language: 'english' }), summarize: vi.fn(async () => true) })
    expect(maxActive).toBe(1)
    expect(extract).toHaveBeenCalledTimes(2)
    expect(extract.mock.calls[0][1].filter(Boolean)).toHaveLength(2)
  })

  it('falls back to the whole track when decoding fails, and says so in the stats', async () => {
    const bytes = new Uint8Array([7, 7, 7])
    const transcribe = vi.fn<(bytes: Uint8Array) => Promise<WhisperResult>>(async () => ({ segments: [seg(5, 6, 'hello')], language: 'english' }))
    const logs: string[] = []
    const decode = async (): Promise<TrackLevels> => {
      throw new Error('bad ogg')
    }
    await transcribeRecording('r1', { apiKey: 'k', download: async () => bytes, decode, transcribe, summarize: vi.fn(async () => true), log: (m) => logs.push(m) })
    expect(transcribe.mock.calls[0][0]).toBe(bytes)
    expect((finalWrite().data.transcript as Array<{ startMs: number }>)[0].startMs).toBe(5000)
    expect(statsOf()).toMatchObject({ mode: 'whole-track', fallback: 'decode-failed', chunks: 1, requests: 1, speechSec: 0 })
    expect(logs.some((l) => l.includes('could not be decoded'))).toBe(true)
  })

  it('a whole-track fallback over the upload limit is skipped as too large', async () => {
    const transcribe = vi.fn()
    const decode = async (): Promise<TrackLevels> => {
      throw new Error('bad ogg')
    }
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array(MAX_UPLOAD_BYTES + 1), decode, transcribe, summarize: vi.fn(async () => true) })
    expect(out).toBe('failed')
    expect(transcribe).not.toHaveBeenCalled()
  })
})

describe('upload format', () => {
  it('names a WAV chunk as wav and the recorder file as ogg, and asks for word times', async () => {
    const forms: FormData[] = []
    const fetchImpl = vi.fn(async (_url: string, init: { body: FormData }) => {
      forms.push(init.body)
      return { ok: true, json: async () => ({ segments: [], words: [{ word: 'hi', start: 0, end: 0.2 }] }) }
    })
    const wav = renderChunkWav({ pieces: [{ region: 0, srcStartMs: 0, srcEndMs: 300, chunkStartMs: 0 }], durationMs: 300 }, [])
    expect(isWav(wav)).toBe(true)
    expect(isWav(new Uint8Array([1, 2, 3]))).toBe(false)
    const r = await transcribeAudio(wav, 'k', { fetchImpl: fetchImpl as unknown as typeof fetch, language: 'en', words: true })
    await transcribeAudio(new Uint8Array([1]), 'k', { fetchImpl: fetchImpl as unknown as typeof fetch, language: 'en' })
    expect((forms[0].get('file') as File).name).toBe('speech.wav')
    expect((forms[0].get('file') as File).type).toBe('audio/wav')
    expect((forms[1].get('file') as File).name).toBe('track.ogg')
    expect(forms[0].getAll('timestamp_granularities[]')).toEqual(['word', 'segment'])
    expect(forms[1].getAll('timestamp_granularities[]')).toEqual([]) // whole-track fallback: no word times
    expect(r.words).toEqual([{ word: 'hi', start: 0, end: 0.2 }])
  })
})
