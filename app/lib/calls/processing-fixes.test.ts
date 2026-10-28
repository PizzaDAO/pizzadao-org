import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('./r2', () => ({ getObjectBytes: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn() } }))

import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import {
  cleanSegmentsWithStats,
  languageName,
  listNeedingSummary,
  listPendingTranscription,
  resetLanguageWarning,
  MAX_SUMMARY_ATTEMPTS,
  transcribeAudio,
  transcribeLanguage,
  transcribeRecording,
  USED_OPENAI,
} from './transcribe'
import { resetForRetranscribe } from './retranscribe'
import { publishRecording } from './recordings'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const ANN = '111111111111111111'
const BOB = '222222222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  db.callRecording.updateMany.mockResolvedValue({ count: 1 })
})
afterEach(() => vi.unstubAllEnvs())

const seg = (text: string, over: Record<string, unknown> = {}) => ({ start: 1, end: 5, text, avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.1, ...over })

describe('language hint', () => {
  it('defaults to en, auto sends none, anything else is passed through', () => {
    expect(transcribeLanguage({})).toBe('en')
    expect(transcribeLanguage({ CALL_TRANSCRIBE_LANGUAGE: '  ' })).toBe('en')
    expect(transcribeLanguage({ CALL_TRANSCRIBE_LANGUAGE: 'auto' })).toBeNull()
    expect(transcribeLanguage({ CALL_TRANSCRIBE_LANGUAGE: 'ES' })).toBe('es')
    expect(languageName('en')).toBe('english')
  })

  const send = async (opts: Parameters<typeof transcribeAudio>[2]) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ language: 'english', segments: [] }) })
    await transcribeAudio(new Uint8Array([1]), 'k', { ...opts, fetchImpl: fetchImpl as unknown as typeof fetch })
    return (fetchImpl.mock.calls[0][1] as { body: FormData }).body
  }

  it('sends language=en by default and the env value when set', async () => {
    expect((await send({})).get('language')).toBe('en')
    vi.stubEnv('CALL_TRANSCRIBE_LANGUAGE', 'fr')
    expect((await send({})).get('language')).toBe('fr')
  })

  it('sends no language for auto or an explicit null', async () => {
    vi.stubEnv('CALL_TRANSCRIBE_LANGUAGE', 'auto')
    expect((await send({})).has('language')).toBe(false)
    expect((await send({ language: null })).has('language')).toBe(false)
    expect((await send({ language: 'de' })).get('language')).toBe('de')
  })
})

describe('transcribeRecording diagnostics', () => {
  const rec = () => ({
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
  })
  const finalWrite = () => db.callRecording.updateMany.mock.calls.map((c) => c[0]).find((a) => a.data.transcribedAt && !a.where.OR)

  it('passes the hint to the transcriber and labels the language from it', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const transcribe = vi.fn(async (..._a: unknown[]) => ({ segments: [seg('hello there')], language: 'welsh' }))
    await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe, summarize: vi.fn(async () => true) })
    expect(transcribe.mock.calls[0][3]).toEqual({ language: 'en' })
    expect(finalWrite().data.transcriptLanguage).toBe('english')
  })

  it('with the auto hint it keeps what Whisper detected', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const transcribe = vi.fn(async (..._a: unknown[]) => ({ segments: [seg('hola amigos')], language: 'spanish' }))
    await transcribeRecording('r1', { apiKey: 'k', language: null, download: async () => new Uint8Array([1]), transcribe, summarize: vi.fn(async () => true) })
    expect(transcribe.mock.calls[0][3]).toEqual({ language: null })
    expect(finalWrite().data.transcriptLanguage).toBe('spanish')
  })

  it('counts what the filters dropped, per track, without any text', () => {
    const { utterances, stats } = cleanSegmentsWithStats([
      seg('real words here', { start: 0, end: 4 }),
      seg('noise', { avg_logprob: -1.8, start: 5, end: 6 }),
      seg('   ', { start: 6, end: 7 }),
      seg('loop', { start: 8, end: 9 }),
      seg('loop', { start: 9, end: 10 }),
      seg('loop', { start: 10, end: 11 }),
    ])
    expect(utterances).toHaveLength(1)
    expect(stats).toEqual({ rawSegments: 6, empty: 1, droppedDubious: 1, droppedRepeats: 3, kept: 1, words: 3, lastEndSec: 4 })
  })

  it('saves per-track stats at finalize (counts only)', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const logs: string[] = []
    await transcribeRecording('r1', {
      apiKey: 'k',
      download: async () => new Uint8Array([1]),
      transcribe: async () => ({ segments: [seg('secret words spoken'), seg('x', { avg_logprob: -2, start: 6, end: 7 })], language: 'english' }),
      summarize: vi.fn(async () => true),
      log: (m) => logs.push(m),
    })
    const stats = finalWrite().data.transcribeStats as Record<string, Record<string, unknown>>
    expect(Object.keys(stats).sort()).toEqual([ANN, BOB])
    expect(stats[ANN]).toMatchObject({ talkTimeSec: 60, rawSegments: 2, kept: 1, droppedDubious: 1, words: 3 })
    expect(JSON.stringify(stats)).not.toContain('secret')
    expect(logs.some((l) => l.startsWith('track stats:') && l.includes('dubious=1'))).toBe(true)
    expect(logs.join('\n')).not.toContain('secret')
  })

  it('counts a track skipped as too large in the partial error', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const out = await transcribeRecording('r1', {
      apiKey: 'k',
      download: async (key) => {
        if (key.endsWith('b.ogg')) throw new Error('Object is 99999999 bytes (limit 25165824)')
        return new Uint8Array([1])
      },
      transcribe: async () => ({ segments: [seg('ok')], language: 'english' }),
      summarize: vi.fn(async () => true),
    })
    expect(out).toBe('transcribed')
    const w = finalWrite().data
    expect(w.transcribeError).toBe('partial: 1 track(s) could not be transcribed (1 too large)')
    expect((w.transcribeStats as Record<string, Record<string, unknown>>)[BOB]).toEqual({ talkTimeSec: 30, skipped: 'too-large' })
  })

  it('returns transcribed-no-summary when the summary fails after a good transcription', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const out = await transcribeRecording('r1', { apiKey: 'k', download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('ok')], language: 'english' }), summarize: vi.fn(async () => false) })
    expect(out).toBe('transcribed-no-summary')
    expect(finalWrite().data.transcribedAt).toBeInstanceOf(Date)
    expect(USED_OPENAI.has('transcribed-no-summary')).toBe(true)
  })
})

describe('language validation', () => {
  it('accepts two-letter codes and auto, otherwise warns once and uses en', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    resetLanguageWarning()
    expect(transcribeLanguage({ CALL_TRANSCRIBE_LANGUAGE: 'fr' })).toBe('fr')
    expect(transcribeLanguage({ CALL_TRANSCRIBE_LANGUAGE: 'auto' })).toBeNull()
    expect(transcribeLanguage({ CALL_TRANSCRIBE_LANGUAGE: 'english' })).toBe('en')
    expect(transcribeLanguage({ CALL_TRANSCRIBE_LANGUAGE: 'e1' })).toBe('en')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('pending list and summary budget', () => {
  it('picks up rows reset by the re-transcribe tool whatever their age', async () => {
    db.callRecording.findMany.mockResolvedValue([])
    const now = new Date('2026-10-28T12:00:00Z')
    await listPendingTranscription(14, 10, now)
    const where = db.callRecording.findMany.mock.calls[0][0].where
    expect(where.AND[0].OR).toEqual([{ startedAt: { gte: new Date('2026-10-14T12:00:00Z') } }, { retranscribeRequestedAt: { not: null } }])
  })

  it('gives the end-of-run summary a time budget and treats a deliberate skip as not a failure', async () => {
    const base = {
      id: 'r1', status: 'RECORDED', transcript: null, transcribedAt: null, transcribeAttempts: 0, transcribeTracks: null, redactedSpeakerIds: [], summaryEditedAt: null,
      updatedAt: new Date('2026-10-28T12:00:00Z'), speakers: [{ discordId: ANN, trackKey: 'k', talkTimeSec: 60 }],
    }
    db.callRecording.findUnique.mockResolvedValue(base)
    const logs: string[] = []
    const summarize = vi.fn(async () => 'skipped' as const)
    const run = () => transcribeRecording('r1', { apiKey: 'k', startedMs: Date.now() - 100_000, download: async () => new Uint8Array([1]), transcribe: async () => ({ segments: [seg('ok')], language: 'english' }), summarize, log: (m) => logs.push(m) })
    expect(await run()).toBe('transcribed')
    const budget = (summarize.mock.calls[0] as unknown as [string, { budgetMs: number }])[1].budgetMs
    expect(budget).toBeGreaterThan(150_000)
    expect(budget).toBeLessThanOrEqual(190_000)
    expect(logs.some((l) => l.includes('skipped on purpose'))).toBe(true)
    const final = db.callRecording.updateMany.mock.calls.map((c) => c[0]).find((a) => a.data.transcribedAt && !a.where.OR)
    expect(final.data.retranscribeRequestedAt).toBeNull()
    summarize.mockResolvedValue('failed' as never)
    expect(await run()).toBe('transcribed-no-summary')
  })
})

describe('publishing waits for transcription', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'r1', status: 'IN_REVIEW', summary: 'S', transcript: [{ discordId: BOB, startMs: 0, endMs: 1, text: 'typed', kind: 'chat', id: 'c:1' }],
    redactedSpeakerIds: [], redactedSegmentIds: [], transcribedAt: null, transcribeAttempts: 0,
    speakers: [{ discordId: ANN, trackKey: 'k', talkTimeSec: 60 }], ...over,
  })
  const recent = () => ({ startedAt: new Date(Date.now() - 86_400_000) })
  it('blocks while transcription is due (cron window or flagged, and OpenAI configured)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    db.callRecording.findUnique.mockResolvedValue(row(recent()))
    expect(await publishRecording('r1', '9')).toBe('transcribing')
    db.callRecording.findUnique.mockResolvedValue(row({ startedAt: new Date('2020-01-01'), retranscribeRequestedAt: new Date() }))
    expect(await publishRecording('r1', '9')).toBe('transcribing')
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })
  it('does not block when the cron will not pick the row up (too old and unflagged, or no OpenAI key)', async () => {
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    db.callRecording.findUnique.mockResolvedValue(row({ startedAt: new Date('2020-01-01'), retranscribeRequestedAt: null }))
    expect(await publishRecording('r1', '9')).toBe('ok')
    vi.stubEnv('OPENAI_API_KEY', '')
    db.callRecording.findUnique.mockResolvedValue(row(recent()))
    expect(await publishRecording('r1', '9')).toBe('ok')
  })
  it('publishes with a write guarded on updatedAt and reports a conflict when it matches nothing', async () => {
    const updatedAt = new Date('2026-10-28T12:00:00Z')
    db.callRecording.findUnique.mockResolvedValue(row({ updatedAt }))
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    expect(await publishRecording('r1', '9')).toBe('conflict')
    expect(db.callRecording.updateMany.mock.calls[0][0].where).toEqual({ id: 'r1', status: 'IN_REVIEW', updatedAt })
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    expect(await publishRecording('r1', '9')).toBe('ok')
  })
  it('does not block once transcribed, with no transcribable tracks, after giving up, or with spoken lines', async () => {
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    for (const over of [{ transcribedAt: new Date() }, { speakers: [] }, { speakers: [{ discordId: ANN, trackKey: 'k', talkTimeSec: 60 }], redactedSpeakerIds: [ANN] }, { transcribeAttempts: 3 }, { transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'spoken' }] }]) {
      db.callRecording.findUnique.mockResolvedValue(row({ ...recent(), ...over }))
      expect(await publishRecording('r1', '9')).toBe('ok')
    }
  })
})

describe('listNeedingSummary sweep eligibility', () => {
  it('lists in-review rows with a transcript, no summary, no edit, under the attempt cap, after a backoff', async () => {
    db.callRecording.findMany.mockResolvedValue([])
    const now = new Date('2026-10-28T12:00:00Z')
    await listNeedingSummary(now)
    const where = db.callRecording.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      summary: null,
      summaryEditedAt: null,
      summaryGeneratedAt: null,
      summaryAttempts: { lt: MAX_SUMMARY_ATTEMPTS },
      status: { in: ['RECORDED', 'PROCESSING', 'IN_REVIEW'] },
      transcript: { not: Prisma.DbNull },
    })
    // never PUBLISHED / REJECTED
    expect(where.status.in).not.toContain('PUBLISHED')
    expect(where.status.in).not.toContain('REJECTED')
    const [{ OR: handedOn }, { OR: backoff }] = where.AND
    expect(handedOn).toEqual([{ transcribedAt: { not: null } }, { status: 'IN_REVIEW' }])
    expect(backoff).toEqual([
      { summaryError: null, updatedAt: { lt: new Date('2026-10-28T11:45:00Z') } },
      { summaryError: { not: null }, updatedAt: { lt: new Date('2026-10-28T11:00:00Z') } },
    ])
  })
})

describe('resetForRetranscribe', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    status: 'IN_REVIEW',
    transcript: [
      { discordId: ANN, startMs: 0, endMs: 1000, text: 'spoken' },
      { discordId: BOB, startMs: 500, endMs: 500, text: 'typed', kind: 'chat', id: 'c:1' },
    ],
    summaryEditedAt: null,
    reviewedBy: null,
    redactedSegmentIds: [],
    redactedSpeakerIds: [],
    updatedAt: new Date('2026-10-28T12:00:00Z'),
    transcribeStats: { [ANN]: { talkTimeSec: 10 } },
    speakers: [{ discordId: ANN, trackKey: 'calls/s/tracks/a.ogg', talkTimeSec: 60 }],
    ...over,
  })

  it('dry run reports counts and writes nothing', async () => {
    db.callRecording.findUnique.mockResolvedValue(row())
    expect(await resetForRetranscribe('r1')).toEqual({ ok: true, dryRun: true, speechLines: 1, chatLines: 1, tracks: 1 })
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['a reviewer-edited summary', { summaryEditedAt: new Date() }],
    ['a reviewer id', { reviewedBy: '999' }],
    ['redacted lines', { redactedSegmentIds: ['s:1:0'] }],
    ['redacted speakers', { redactedSpeakerIds: [ANN] }],
    ['PUBLISHED status', { status: 'PUBLISHED' }],
    ['REJECTED status', { status: 'REJECTED' }],
    ['no speaker with an audio track', { speakers: [{ discordId: ANN, trackKey: null, talkTimeSec: 60 }] }],
    ['only a redacted speaker with a track', { redactedSpeakerIds: [ANN] }],
    ['no track with talk time', { speakers: [{ discordId: ANN, trackKey: 'k', talkTimeSec: 0 }] }],
    ['a recorder-provided transcript (no server stats)', { transcribeStats: null }],
  ])('refuses a row with %s, even with apply', async (_name, over) => {
    db.callRecording.findUnique.mockResolvedValue(row(over))
    const res = await resetForRetranscribe('r1', { apply: true })
    expect(res).toMatchObject({ ok: false, reason: 'refused' })
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })

  it('--force-worker lets a recorder-provided transcript be replaced', async () => {
    db.callRecording.findUnique.mockResolvedValue(row({ transcribeStats: null }))
    expect(await resetForRetranscribe('r1', { apply: true, forceWorker: true })).toMatchObject({ ok: true, dryRun: false })
  })

  it('a dry-run refusal explains why', async () => {
    db.callRecording.findUnique.mockResolvedValue(row({ speakers: [] }))
    const res = await resetForRetranscribe('r1')
    expect(res).toMatchObject({ ok: false, reason: 'refused' })
    expect(JSON.stringify(res)).toContain('nothing could be re-transcribed')
  })

  it('reports a missing row', async () => {
    db.callRecording.findUnique.mockResolvedValue(null)
    expect(await resetForRetranscribe('nope', { apply: true })).toMatchObject({ ok: false, reason: 'not-found' })
  })

  it('apply does one guarded update that keeps chat and resets the transcription fields', async () => {
    db.callRecording.findUnique.mockResolvedValue(row())
    const res = await resetForRetranscribe('r1', { apply: true })
    expect(res).toEqual({ ok: true, dryRun: false, speechLines: 1, chatLines: 1, tracks: 1 })
    expect(db.callRecording.updateMany).toHaveBeenCalledTimes(1)
    const arg = db.callRecording.updateMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      id: 'r1',
      status: { in: ['RECORDED', 'PROCESSING', 'IN_REVIEW'] },
      summaryEditedAt: null,
      reviewedBy: null,
      redactedSegmentIds: { isEmpty: true },
      redactedSpeakerIds: { isEmpty: true },
      updatedAt: new Date('2026-10-28T12:00:00Z'),
    })
    expect(arg.data.transcript).toEqual([expect.objectContaining({ kind: 'chat', id: 'c:1' })])
    expect(arg.data).toMatchObject({ transcribedAt: null, transcribeError: null, transcribeAttempts: 0, summaryError: null, summaryAttempts: 0, retranscribeRequestedAt: expect.any(Date) })
    expect(arg.data.transcribeTracks).toBe(Prisma.DbNull)
    expect(arg.data.transcribeStats).toBe(Prisma.DbNull)
  })

  it('reports a change when the guarded write matches nothing', async () => {
    db.callRecording.findUnique.mockResolvedValue(row())
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    expect(await resetForRetranscribe('r1', { apply: true })).toMatchObject({ ok: false, reason: 'changed' })
  })

  it('clears the transcript entirely when there was no chat', async () => {
    db.callRecording.findUnique.mockResolvedValue(row({ transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'x' }] }))
    await resetForRetranscribe('r1', { apply: true })
    expect(db.callRecording.updateMany.mock.calls[0][0].data.transcript).toBe(Prisma.DbNull)
  })
})
