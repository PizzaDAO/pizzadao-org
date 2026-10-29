// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/discord-channels', () => ({ resolveChannelId: vi.fn(async () => null) }))

const state = vi.hoisted(() => ({ values: {} as Record<string, boolean>, readFailed: false, invalid: [] as string[], throws: false }))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: vi.fn(async () => {
    if (state.throws) throw new Error('db down')
    return { get: (k: string) => state.values[k] ?? false, isSet: () => true, readFailed: state.readFailed, invalidKeys: state.invalid }
  }),
}))

import { prisma } from '@/app/lib/db'
import { DISCORD_ONLY, importedAllowed, isImportedSource } from './imported'
import { postCallRecap } from './recap'
import { draftFollowUpsForRecording, listNeedingFollowups } from '@/app/lib/followups/draft'
import { previousActionItems } from '@/app/lib/call-agenda/run'
import { listNeedingSummary, listPendingTranscription, SUMMARY_SWEEP_WINDOW_DAYS } from './transcribe'
import { resetForRetranscribe } from './retranscribe'
import { listRecordingsPage } from './recordings'
import { SEGMENT_KEY, SPEAKER_ID } from './ingest-schema'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const PROD = { VERCEL_ENV: 'production' }

beforeEach(() => {
  vi.clearAllMocks()
  state.values = {}
  state.readFailed = false
  state.invalid = []
  state.throws = false
  db.callPostFilter.findUnique.mockResolvedValue(null)
})

describe('importedAllowed', () => {
  it('is off by default, when unreadable, invalid, throwing, or not production', async () => {
    expect(await importedAllowed('calls.importedRecapPostEnabled', PROD)).toBe(false)
    state.values['calls.importedRecapPostEnabled'] = true
    expect(await importedAllowed('calls.importedRecapPostEnabled', PROD)).toBe(true)
    expect(await importedAllowed('calls.importedRecapPostEnabled', {})).toBe(false)
    expect(await importedAllowed('calls.importedRecapPostEnabled', { VERCEL_ENV: 'preview' })).toBe(false)
    // The env var set to off always wins; on a preview only the env var counts.
    expect(await importedAllowed('calls.importedRecapPostEnabled', { ...PROD, CALL_IMPORT_RECAP_ENABLED: 'off' })).toBe(false)
    expect(await importedAllowed('calls.importedRecapPostEnabled', { VERCEL_ENV: 'preview', CALL_IMPORT_RECAP_ENABLED: '1' })).toBe(true)
    state.readFailed = true
    expect(await importedAllowed('calls.importedRecapPostEnabled', PROD)).toBe(false)
    state.readFailed = false
    state.invalid = ['calls.importedRecapPostEnabled']
    expect(await importedAllowed('calls.importedRecapPostEnabled', PROD)).toBe(false)
    state.invalid = []
    state.throws = true
    expect(await importedAllowed('calls.importedRecapPostEnabled', PROD)).toBe(false)
  })
  it('recognises imported sources', () => {
    expect(isImportedSource('X_BROADCAST')).toBe(true)
    expect(isImportedSource('X_SPACE')).toBe(true)
    expect(isImportedSource('DISCORD')).toBe(false)
    expect(isImportedSource(undefined)).toBe(false)
  })
})

describe('recap guard', () => {
  const env = { CALL_RECAP_POST_ENABLED: '1', DISCORD_BOT_TOKEN: 'tok', ...PROD }
  beforeEach(() => {
    state.values['calls.recapPostEnabled'] = true
  })
  const published = { id: 'r1', source: 'X_BROADCAST', status: 'PUBLISHED', title: 'T', summary: 'A. B. C. D.', actionItems: [], chapters: [], crewId: 'community_call', crewLabel: 'Community', eventName: null, recapPostedAt: null, redactionsUpdatedAt: null, summaryGeneratedAt: null, summaryEditedAt: null }
  it('returns imported and posts nothing for an imported call', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    const post = vi.fn()
    expect(await postCallRecap('r1', { env, post })).toBe('imported')
    expect(post).not.toHaveBeenCalled()
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })
  it('posts when the setting is on', async () => {
    state.values['calls.importedRecapPostEnabled'] = true
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.update.mockResolvedValue({})
    const post = vi.fn(async () => ({ id: 'm1' }))
    expect(await postCallRecap('r1', { env, post })).toBe('posted')
  })
})

describe('follow-up guards', () => {
  const rec = { id: 'r1', source: 'X_BROADCAST', status: 'IN_REVIEW', summary: 'x', crewId: 'community_call', actionItems: [], transcript: [], redactedSpeakerIds: [], redactedSegmentIds: [], followupsDraftedAt: null, followupsAttempts: 0, speakers: [] }
  it('refuses to draft an imported call, even when forced', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec)
    expect(await draftFollowUpsForRecording('r1', { force: true })).toEqual({ result: 'disabled', created: 0 })
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })
  it('the sweep only lists Discord calls unless the setting is on', async () => {
    db.callRecording.findMany.mockResolvedValue([])
    await listNeedingFollowups(1)
    expect(db.callRecording.findMany.mock.calls[0][0].where).toMatchObject(DISCORD_ONLY)
  })
})

describe('agenda guard', () => {
  it('reads only Discord calls', async () => {
    db.callRecording.findMany.mockResolvedValue([])
    await previousActionItems('community_call')
    expect(db.callRecording.findMany.mock.calls[0][0].where).toMatchObject({ crewId: 'community_call', status: 'PUBLISHED', source: 'DISCORD' })
  })
})

describe('transcription sweeps', () => {
  it('pending transcription is Discord only', async () => {
    db.callRecording.findMany.mockResolvedValue([])
    await listPendingTranscription(14, 10)
    expect(db.callRecording.findMany.mock.calls[0][0].where).toMatchObject({ source: 'DISCORD' })
  })
  it('the summary sweep is Discord only by default', async () => {
    db.callRecording.findMany.mockResolvedValue([])
    await listNeedingSummary(new Date('2026-11-04T00:00:00Z'))
    expect(db.callRecording.findMany.mock.calls[0][0].where.source).toBe('DISCORD')
  })
  it('with auto-summarize on, imported rows are windowed on importedAt and Discord rows are not', async () => {
    state.values['calls.importedAutoSummarize'] = true
    const prevEnv = process.env.VERCEL_ENV
    process.env.VERCEL_ENV = 'production'
    db.callRecording.findMany.mockResolvedValue([])
    const now = new Date('2026-11-04T00:00:00Z')
    try {
      await listNeedingSummary(now)
    } finally {
      if (prevEnv === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = prevEnv
    }
    const where = db.callRecording.findMany.mock.calls[0][0].where
    expect(where.source).toBeUndefined()
    expect(where.startedAt).toBeUndefined()
    const windowed = where.AND[2].OR
    expect(windowed[0]).toEqual({ source: 'DISCORD' })
    expect(windowed[1].importedAt.gte.getTime()).toBe(now.getTime() - SUMMARY_SWEEP_WINDOW_DAYS * 86_400_000)
  })
})

describe('retranscribe guard', () => {
  it('is not supported for an imported call and writes nothing', async () => {
    db.callRecording.findUnique.mockResolvedValue({ status: 'IN_REVIEW', source: 'X_BROADCAST', transcript: [], speakers: [], redactedSegmentIds: [], redactedSpeakerIds: [] })
    const r = await resetForRetranscribe('r1', { apply: true })
    expect(r).toMatchObject({ ok: false, reason: 'not-supported' })
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })
})

describe('admin list', () => {
  it('filters by source and pages by (startedAt, id) with no skipped rows', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}` }))
    const t0 = new Date('2026-01-01T00:00:00Z')
    db.callRecording.findUnique.mockResolvedValue({ startedAt: t0 })
    db.callRecording.findMany.mockResolvedValue(rows)
    const page = await listRecordingsPage({ take: 2, source: 'imported', cursor: 'r9' })
    expect(page.rows).toHaveLength(2)
    expect(page.nextCursor).toBe('r1')
    const arg = db.callRecording.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ OR: [{ startedAt: { lt: t0 } }, { startedAt: t0, id: { lt: 'r9' } }], source: { not: 'DISCORD' } })
    expect(arg.take).toBe(3)
    expect(arg).not.toHaveProperty('skip')
    expect(arg).not.toHaveProperty('cursor')
    expect(arg.orderBy).toEqual([{ startedAt: 'desc' }, { id: 'desc' }])
  })
  it('an unknown cursor starts from the newest', async () => {
    db.callRecording.findUnique.mockResolvedValue(null)
    db.callRecording.findMany.mockResolvedValue([])
    await listRecordingsPage({ cursor: 'gone' })
    expect(db.callRecording.findMany.mock.calls[0][0].where).toEqual({})
  })
})

describe('widened id patterns', () => {
  it('still accept Discord ids and reject junk', () => {
    expect(SPEAKER_ID.test('123456789012345678')).toBe(true)
    expect(SPEAKER_ID.test('xs:3')).toBe(true)
    expect(SPEAKER_ID.test('xs:1234')).toBe(false)
    expect(SPEAKER_ID.test('xs:')).toBe(false)
    expect(SPEAKER_ID.test('abc')).toBe(false)
    expect(SPEAKER_ID.test('12')).toBe(false)
    expect(SEGMENT_KEY.test('c:123456789012345678')).toBe(true)
    expect(SEGMENT_KEY.test('s:123456789012345678:4500')).toBe(true)
    expect(SEGMENT_KEY.test('s:xs:2:4500')).toBe(true)
    expect(SEGMENT_KEY.test('s:xs:2')).toBe(false)
    expect(SEGMENT_KEY.test('s:xs:x:4500')).toBe(false)
    expect(SEGMENT_KEY.test('x:1')).toBe(false)
  })
})
