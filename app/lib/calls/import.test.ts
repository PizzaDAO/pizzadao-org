// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [{ id: 'community_call', label: 'Community Call' }] })) }))

import { prisma } from '@/app/lib/db'
import { importExternalRecording, parseImportPayload, transcriptSha256 } from './import'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & { $transaction: ReturnType<typeof vi.fn> }
const SID = 'x-broadcast-AbCdEfGh12345'

const body = () => ({
  sessionId: SID,
  sourceUrl: 'https://x.com/i/broadcasts/AbCdEfGh12345',
  eventName: 'Community call',
  crewId: 'community_call',
  startedAt: '2020-10-28T18:00:00Z',
  durationSec: 3600,
  mix: { key: `calls/${SID}/mix.m4a`, bytes: 1000 },
  speakers: [{ id: 'xs:1', talkTimeSec: 100 }, { id: 'xs:2', talkTimeSec: 50 }],
  segments: [
    { discordId: 'xs:2', startMs: 5000, endMs: 6000, text: 'second' },
    { discordId: 'xs:1', startMs: 1000, endMs: 2000, text: ' first ' },
  ],
  importMeta: { engine: 'whisper.cpp' },
})

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma))
})

describe('parseImportPayload', () => {
  it('accepts a good payload, sorts and trims segments, and derives the source', () => {
    const p = parseImportPayload(body())
    expect(p.source).toBe('X_BROADCAST')
    expect(p.segments.map((s) => [s.discordId, s.text, s.kind])).toEqual([['xs:1', 'first', 'speech'], ['xs:2', 'second', 'speech']])
  })
  it.each([
    ['bad session id', (b: ReturnType<typeof body>) => ({ ...b, sessionId: 'abc' })],
    ['a Discord session id', (b: ReturnType<typeof body>) => ({ ...b, sessionId: '1234567890123456789' })],
    ['a Discord-style speaker', (b: ReturnType<typeof body>) => ({ ...b, speakers: [{ id: '123456789012345678', talkTimeSec: 1 }] })],
    ['an unlisted speaker in a segment', (b: ReturnType<typeof body>) => ({ ...b, segments: [{ discordId: 'xs:9', startMs: 0, endMs: 1, text: 'x' }] })],
    ['a segment after the end', (b: ReturnType<typeof body>) => ({ ...b, segments: [{ discordId: 'xs:1', startMs: 4_000_000, endMs: 4_000_001, text: 'x' }] })],
    ['no text at all', (b: ReturnType<typeof body>) => ({ ...b, segments: [{ discordId: 'xs:1', startMs: 0, endMs: 1, text: '  ' }] })],
    ['a foreign source link', (b: ReturnType<typeof body>) => ({ ...b, sourceUrl: 'https://example.org/x' })],
    ['an http source link', (b: ReturnType<typeof body>) => ({ ...b, sourceUrl: 'http://x.com/i/broadcasts/AbCdEfGh12345' })],
    ['a mix key outside the session', (b: ReturnType<typeof body>) => ({ ...b, mix: { key: 'calls/other/mix.m4a', bytes: 1 } })],
    ['transcript text smuggled in importMeta', (b: ReturnType<typeof body>) => ({ ...b, importMeta: { lines: [{ text: 'hi' }] } })],
    ['too many segments', (b: ReturnType<typeof body>) => ({ ...b, segments: Array.from({ length: 20001 }, () => ({ discordId: 'xs:1', startMs: 0, endMs: 1, text: 'x' })) })],
    ['a zero duration', (b: ReturnType<typeof body>) => ({ ...b, durationSec: 0 })],
  ])('rejects %s', (_n, mut) => {
    expect(() => parseImportPayload(mut(body()))).toThrow()
  })
})

describe('importExternalRecording', () => {
  const payload = () => parseImportPayload(body())
  const sha = () => transcriptSha256(payload().segments)

  it('creates an IN_REVIEW imported row with the automatic steps already marked done', async () => {
    db.callRecording.findUnique.mockResolvedValue(null)
    db.callRecording.create.mockResolvedValue({ id: 'new1' })
    const out = await importExternalRecording(payload(), { now: new Date('2026-11-04T00:00:00Z') })
    expect(out).toEqual({ id: 'new1', action: 'created' })
    const data = db.callRecording.create.mock.calls[0][0].data
    expect(data).toMatchObject({ sessionId: SID, status: 'IN_REVIEW', source: 'X_BROADCAST', channelId: 'x', crewLabel: 'Community Call', durationSec: 3600 })
    expect(data.transcribedAt).toEqual(new Date('2026-11-04T00:00:00Z'))
    expect(data.followupsDraftedAt).toEqual(new Date('2026-11-04T00:00:00Z'))
    expect(data.speakers.create.map((s: { discordId: string; trackKey: unknown }) => [s.discordId, s.trackKey])).toEqual([['xs:1', null], ['xs:2', null]])
  })

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'r1', source: 'X_BROADCAST', status: 'IN_REVIEW', updatedAt: new Date(), eventName: 'Community call', crewId: 'community_call', sourceUrl: 'https://x.com/i/broadcasts/AbCdEfGh12345', durationSec: 3600, startedAt: new Date('2020-10-28T18:00:00Z'), mixKey: `calls/${SID}/mix.m4a`, importMeta: { transcriptSha256: 'old' },
    summaryEditedAt: null, reviewedBy: null, redactedSpeakerIds: [], redactedSegmentIds: [], speakerLabelsUpdatedAt: null, ...over,
  })

  it('is idempotent: the same transcript writes nothing', async () => {
    db.callRecording.findUnique.mockResolvedValue(row({ importMeta: { transcriptSha256: sha() } }))
    expect(await importExternalRecording(payload())).toEqual({ id: 'r1', action: 'unchanged' })
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
    expect(db.callRecording.create).not.toHaveBeenCalled()
  })

  it('a changed title, crew, date or link updates only those details', async () => {
    db.callRecording.findUnique.mockResolvedValue(row({ importMeta: { transcriptSha256: sha() }, summary: 'kept', summaryEditedAt: new Date() }))
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    for (const change of [{ eventName: 'Old title' }, { crewId: 'ops' }, { startedAt: new Date('2019-01-01T00:00:00Z') }, { sourceUrl: null }, { durationSec: 5 }]) {
      db.callRecording.updateMany.mockClear()
      db.callRecording.findUnique.mockResolvedValue(row({ importMeta: { transcriptSha256: sha() }, summaryEditedAt: new Date(), ...change }))
      expect(await importExternalRecording(payload())).toEqual({ id: 'r1', action: 'replaced' })
      const data = db.callRecording.updateMany.mock.calls[0][0].data
      expect(data).toMatchObject({ eventName: 'Community call', crewId: 'community_call' })
      expect(data).not.toHaveProperty('transcript')
      expect(data).not.toHaveProperty('summary')
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('never overwrites a published or rejected call, even with force', async () => {
    for (const status of ['PUBLISHED', 'REJECTED']) {
      db.callRecording.findUnique.mockResolvedValue(row({ status }))
      const out = await importExternalRecording(payload(), { force: true })
      expect(out.action).toBe('refused')
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('refuses a call a human touched unless forced', async () => {
    for (const over of [{ summaryEditedAt: new Date() }, { reviewedBy: '1' }, { redactedSpeakerIds: ['xs:1'] }, { redactedSegmentIds: ['s:xs:1:1000'] }, { speakerLabelsUpdatedAt: new Date() }]) {
      db.callRecording.findUnique.mockResolvedValue(row(over))
      expect((await importExternalRecording(payload())).action).toBe('refused')
    }
    expect(db.$transaction).not.toHaveBeenCalled()
    db.callRecording.findUnique.mockResolvedValue(row({ summaryEditedAt: new Date() }))
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callSpeaker.deleteMany.mockResolvedValue({ count: 2 })
    db.callSpeaker.createMany.mockResolvedValue({ count: 2 })
    expect((await importExternalRecording(payload(), { force: true })).action).toBe('replaced')
  })

  it('replaces an untouched row, resets the summary and swaps the speakers', async () => {
    db.callRecording.findUnique.mockResolvedValue(row())
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callSpeaker.deleteMany.mockResolvedValue({ count: 2 })
    db.callSpeaker.createMany.mockResolvedValue({ count: 2 })
    expect(await importExternalRecording(payload())).toEqual({ id: 'r1', action: 'replaced' })
    const arg = db.callRecording.updateMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({ id: 'r1' })
    expect(arg.data).toMatchObject({ summary: null, summaryAttempts: 0, status: 'IN_REVIEW' })
    expect(db.callSpeaker.deleteMany).toHaveBeenCalledWith({ where: { recordingId: 'r1' } })
  })

  it('writes nothing when the row changed meanwhile', async () => {
    db.callRecording.findUnique.mockResolvedValue(row())
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    expect((await importExternalRecording(payload())).action).toBe('refused')
    expect(db.callSpeaker.deleteMany).not.toHaveBeenCalled()
  })

  it('refuses a Discord-recorded row with the same session id', async () => {
    db.callRecording.findUnique.mockResolvedValue(row({ source: 'DISCORD' }))
    expect((await importExternalRecording(payload(), { force: true })).action).toBe('refused')
  })
})
