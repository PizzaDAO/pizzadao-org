// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('./r2', () => ({ getObjectBytes: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn() } }))

import { prisma } from '@/app/lib/db'
import { cleanSegments, dropRepeatRuns, mergeSpeakerTurns, transcribeAudio, transcribeRecording } from './transcribe'

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
    reviewedBy: null,
    summary: null,
    speakers: [
      { discordId: ANN, trackKey: 'calls/s/tracks/a.ogg', talkTimeSec: 60 },
      { discordId: BOB, trackKey: 'calls/s/tracks/b.ogg', talkTimeSec: 30 },
    ],
    ...over,
  })
  const seg = (text: string) => ({ start: 1, end: 2, text, avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.1 })

  it('does nothing without an OpenAI key', async () => {
    expect(await transcribeRecording('r1', { apiKey: '' })).toBe('no-key')
  })
  it('transcribes each track, merges with existing chat, and summarizes', async () => {
    const chat = { discordId: BOB, startMs: 1500, endMs: 1500, text: 'link', kind: 'chat', id: 'c:1' }
    db.callRecording.findUnique.mockResolvedValue(rec({ transcript: [chat] }))
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const summarize = vi.fn(async () => true)
    const out = await transcribeRecording('r1', {
      apiKey: 'k',
      download: async () => new Uint8Array([1]),
      transcribe: async () => ({ segments: [seg('hello')], language: 'en' }),
      summarize,
    })
    expect(out).toBe('transcribed')
    const write = db.callRecording.updateMany.mock.calls.map((c) => c[0]).find((a) => a.data.transcript)
    const stored = write.data.transcript as Array<{ discordId: string; text: string; kind?: string }>
    expect(stored.filter((s) => s.kind !== 'chat').map((s) => s.discordId).sort()).toEqual([ANN, BOB])
    expect(stored.some((s) => s.kind === 'chat')).toBe(true)
    expect(write.data.transcribedAt).toBeInstanceOf(Date)
    expect(summarize).toHaveBeenCalledWith('r1', { onlyIfEmpty: false })
  })
  it('keeps a reviewer-edited summary', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ reviewedBy: '9', summary: 'mine', status: 'IN_REVIEW' }))
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const summarize = vi.fn(async () => true)
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('hi')], language: null }), summarize })
    expect(summarize).toHaveBeenCalledWith('r1', { onlyIfEmpty: true })
  })
  it('skips published calls and ones that already have spoken lines', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ status: 'PUBLISHED' }))
    expect(await transcribeRecording('r1', { apiKey: 'k' })).toBe('not-eligible')
    db.callRecording.findUnique.mockResolvedValue(rec({ transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'hi' }] }))
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const transcribe = vi.fn()
    expect(await transcribeRecording('r1', { apiKey: 'k', transcribe })).toBe('already-had-speech')
    expect(transcribe).not.toHaveBeenCalled()
  })
  it('returns busy when another runner holds the claim', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    const transcribe = vi.fn()
    expect(await transcribeRecording('r1', { apiKey: 'k', transcribe })).toBe('busy')
    expect(transcribe).not.toHaveBeenCalled()
  })
  it('records a failure when every track fails, and leaves the row retryable', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const out = await transcribeRecording('r1', {
      apiKey: 'k',
      download: async () => new Uint8Array([1]),
      transcribe: async () => {
        throw new Error('OpenAI answered 500')
      },
      summarize: vi.fn(),
    })
    expect(out).toBe('failed')
    const last = db.callRecording.updateMany.mock.calls.at(-1)![0]
    expect(last.data.transcribeError).toMatch(/^failed:/)
    expect(last.data.transcribedAt).toBeUndefined()
  })
  it('rejects tracks over the upload limit', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const transcribe = vi.fn()
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array(25 * 1024 * 1024), transcribe, summarize: vi.fn() })
    expect(out).toBe('failed')
    expect(transcribe).not.toHaveBeenCalled()
  })
})
