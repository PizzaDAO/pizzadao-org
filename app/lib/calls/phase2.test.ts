// @vitest-environment node
// calzone-30418 phase 2: transcript ingest, opt-out exclusion, summary (model mocked),
// publish gating, and "only published calls are public; audio never is".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ DPR_ONLY_MIN_LEVEL: 8, canReviewMission: vi.fn() }))
vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn((o: unknown) => ({ kind: 'object', ...(o as object) })) },
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn((cb: () => unknown) => void cb()) }))

import { generateText } from 'ai'
import { after } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { canReviewMission } from '@/app/lib/mission-review-access'
import { parseIngestPayload } from './ingest-schema'
import { buildTranscriptText, DEFAULT_SUMMARY_MODEL, generateCallSummary, summaryModel, SUMMARY_SYSTEM_PROMPT } from './summarize'
import { generateAndStoreSummary, getPublishedRecording, listPublishedRecordings, publishRecording, unpublishRecording } from './recordings'
import { POST as ingestPOST } from '@/app/api/calls/recorder/ingest/route'
import { POST as publishPOST } from '@/app/api/admin/calls/[id]/publish/route'
import { PATCH as summaryPATCH } from '@/app/api/admin/calls/[id]/summary/route'
import { POST as regeneratePOST } from '@/app/api/admin/calls/[id]/regenerate/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const SESSION = 'ev1394003497153724497-1760000000000'
const ANN = '111111111111111111'
const BOB = '222222222222222222'
const payload = (over: Record<string, unknown> = {}) => ({
  sessionId: SESSION,
  eventId: '1394003497153724497',
  eventName: 'Community Call',
  channelId: '823956905739026442',
  startedAt: '2026-10-18T17:00:00.000Z',
  endedAt: '2026-10-18T18:00:00.000Z',
  endReason: 'empty',
  mix: { key: `calls/${SESSION}/mix.m4a`, bytes: 1234 },
  speakers: [
    { discordId: ANN, displayName: 'Ann', talkTimeSec: 600, trackKey: `calls/${SESSION}/tracks/${ANN}.ogg`, trackBytes: 99 },
    { discordId: BOB, displayName: 'Bob', talkTimeSec: 300, trackKey: `calls/${SESSION}/tracks/${BOB}.ogg`, trackBytes: 50 },
  ],
  transcript: {
    language: 'en',
    segments: [
      { discordId: BOB, startMs: 5000, endMs: 8000, text: 'Hello Ann' },
      { discordId: ANN, startMs: 1000, endMs: 4000, text: 'Welcome everyone' },
    ],
  },
  ...over,
})
const ingestReq = (body: unknown) =>
  new NextRequest('https://app.pizzadao.org/api/calls/recorder/ingest', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer rec-key' },
  })

let savedKey: string | undefined
let savedModel: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  savedKey = process.env.RECORDER_API_KEY
  savedModel = process.env.CALL_SUMMARY_MODEL
  process.env.RECORDER_API_KEY = 'rec-key'
  delete process.env.CALL_SUMMARY_MODEL
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.RECORDER_API_KEY
  else process.env.RECORDER_API_KEY = savedKey
  if (savedModel === undefined) delete process.env.CALL_SUMMARY_MODEL
  else process.env.CALL_SUMMARY_MODEL = savedModel
})

describe('parseIngestPayload transcript', () => {
  it('is optional', () => {
    expect(parseIngestPayload(payload({ transcript: undefined })).transcript).toBeNull()
  })

  it('sorts segments by time and trims text', () => {
    const t = parseIngestPayload(payload()).transcript!
    expect(t.language).toBe('en')
    expect(t.segments.map((s) => s.text)).toEqual(['Welcome everyone', 'Hello Ann'])
  })

  it('drops words from anyone who is not a speaker in the payload (e.g. an opted-out member)', () => {
    const t = parseIngestPayload(
      payload({
        transcript: {
          segments: [
            { discordId: ANN, startMs: 0, endMs: 1, text: 'kept' },
            { discordId: '999999999999999999', startMs: 2, endMs: 3, text: 'not a recorded speaker' },
            { discordId: ANN, startMs: 4, endMs: 5, text: '   ' },
          ],
        },
      }),
    ).transcript!
    expect(t.segments.map((s) => s.text)).toEqual(['kept'])
  })

  it.each([
    ['segments not an array', { segments: {} }],
    ['bad discord id', { segments: [{ discordId: 'x', startMs: 0, endMs: 1, text: 'a' }] }],
    ['negative time', { segments: [{ discordId: ANN, startMs: -1, endMs: 1, text: 'a' }] }],
    ['non-object', 'text'],
  ])('rejects %s', (_n, transcript) => {
    expect(() => parseIngestPayload(payload({ transcript }))).toThrow()
  })
})

describe('POST /api/calls/recorder/ingest with a transcript', () => {
  it('stores it, marks the call PROCESSING and schedules the summary after the response', async () => {
    db.callRecording.findUnique.mockResolvedValueOnce(null) // not a duplicate
    db.recordingOptOut.findMany.mockResolvedValue([])
    db.callRecording.create.mockResolvedValue({ id: 'rec1' })
    // generateAndStoreSummary's own lookup
    db.callRecording.findUnique.mockResolvedValueOnce({ id: 'rec1', status: 'PROCESSING', transcript: [], speakers: [] })
    const res = await ingestPOST(ingestReq(payload()))
    expect(res.status).toBe(201)
    const data = db.callRecording.create.mock.calls[0][0].data
    expect(data.status).toBe('PROCESSING')
    expect(data.transcriptLanguage).toBe('en')
    expect(data.transcript).toHaveLength(2)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('never stores words of someone on the opt-out list, even if the worker sent them', async () => {
    db.callRecording.findUnique.mockResolvedValueOnce(null)
    db.recordingOptOut.findMany.mockResolvedValue([{ discordId: BOB }])
    db.callRecording.create.mockResolvedValue({ id: 'rec1' })
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'PROCESSING', transcript: [], speakers: [] })
    await ingestPOST(ingestReq(payload()))
    const stored = db.callRecording.create.mock.calls[0][0].data.transcript as Array<{ discordId: string }>
    expect(stored.map((s) => s.discordId)).toEqual([ANN])
  })

  it('without a transcript the call stays RECORDED and nothing is summarized', async () => {
    db.callRecording.findUnique.mockResolvedValueOnce(null)
    db.callRecording.create.mockResolvedValue({ id: 'rec1' })
    await ingestPOST(ingestReq(payload({ transcript: undefined })))
    const data = db.callRecording.create.mock.calls[0][0].data
    expect(data.status).toBeUndefined()
    expect(data.transcript).toBeUndefined()
    expect(after).not.toHaveBeenCalled()
  })

  it('a duplicate ingest neither overwrites the transcript nor re-summarizes', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', mixKey: null, speakers: [] })
    const res = await ingestPOST(ingestReq(payload()))
    expect(res.status).toBe(200)
    expect(db.callRecording.create).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })
})

describe('summary generation', () => {
  const segments = [
    { discordId: ANN, startMs: 65_000, endMs: 70_000, text: 'We ship on Friday' },
    { discordId: BOB, startMs: 3_725_000, endMs: 3_730_000, text: 'I will test it' },
  ]
  const good = { title: 'Release planning', summary: 'They ship Friday.', actionItems: [{ text: 'Test', owner: 'Bob' }], chapters: [{ startMs: 65_000, title: 'Release' }] }

  it('labels lines [mm:ss] Name: text in time order', () => {
    const text = buildTranscriptText([...segments].reverse(), { [ANN]: 'Ann', [BOB]: 'Bob' })
    expect(text).toBe('[01:05] Ann: We ship on Friday\n[1:02:05] Bob: I will test it')
  })

  it('uses the AI Gateway model string by default and CALL_SUMMARY_MODEL when set', () => {
    expect(summaryModel({})).toBe('anthropic/claude-sonnet-5-5')
    expect(DEFAULT_SUMMARY_MODEL).toBe('anthropic/claude-sonnet-5-5')
    expect(summaryModel({ CALL_SUMMARY_MODEL: 'anthropic/claude-opus-5-5' })).toBe('anthropic/claude-opus-5-5')
  })

  it('calls the model with the grounded prompt and returns validated output', async () => {
    m(generateText).mockResolvedValue({ output: good })
    const out = await generateCallSummary(segments, { [ANN]: 'Ann', [BOB]: 'Bob' })
    expect(out).toEqual(good)
    const arg = m(generateText).mock.calls[0][0]
    expect(arg.model).toBe('anthropic/claude-sonnet-5-5')
    expect(arg.system).toBe(SUMMARY_SYSTEM_PROMPT)
    expect(arg.prompt).toContain('[01:05] Ann: We ship on Friday')
  })

  it('rejects malformed model output', async () => {
    m(generateText).mockResolvedValue({ output: { title: '', summary: 'x', actionItems: [], chapters: [] } })
    await expect(generateCallSummary(segments, {})).rejects.toThrow()
  })

  it('stores the result and moves a PROCESSING call to IN_REVIEW (never PUBLISHED)', async () => {
    m(generateText).mockResolvedValue({ output: good })
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'PROCESSING', transcript: segments, speakers: [{ discordId: ANN, displayName: 'Ann' }] })
    expect(await generateAndStoreSummary('rec1')).toBe(true)
    const data = db.callRecording.update.mock.calls[0][0].data
    expect(data).toMatchObject({ title: 'Release planning', summary: 'They ship Friday.', status: 'IN_REVIEW' })
  })

  it('regenerating keeps a PUBLISHED call published', async () => {
    m(generateText).mockResolvedValue({ output: good })
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'PUBLISHED', transcript: segments, speakers: [] })
    await generateAndStoreSummary('rec1')
    expect(db.callRecording.update.mock.calls[0][0].data.status).toBeUndefined()
  })

  it('a model failure keeps the transcript and still moves the call to review for a human', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    m(generateText).mockRejectedValue(new Error('gateway down'))
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'PROCESSING', transcript: segments, speakers: [] })
    expect(await generateAndStoreSummary('rec1')).toBe(false)
    expect(db.callRecording.update).toHaveBeenCalledTimes(1)
    expect(db.callRecording.update.mock.calls[0][0].data).toEqual({ status: 'IN_REVIEW' })
  })
})

describe('publish gating', () => {
  const ctx = { params: Promise.resolve({ id: 'rec1' }) }
  const call = (action: unknown = 'publish') =>
    publishPOST(new Request('https://app.pizzadao.org/api/admin/calls/rec1/publish', { method: 'POST', body: JSON.stringify({ action }) }), ctx)
  const asReviewer = () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(canReviewMission).mockResolvedValue(true)
  }

  it('401 without a session, 403 for non-reviewers (L8 gate), changing nothing', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(canReviewMission).mockResolvedValue(false)
    expect((await call()).status).toBe(403)
    expect(canReviewMission).toHaveBeenCalledWith('9', 8)
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
    expect(db.callRecording.update).not.toHaveBeenCalled()
  })

  it('the edit and regenerate routes are gated the same way', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(canReviewMission).mockResolvedValue(false)
    const edit = await summaryPATCH(new Request('https://x/api', { method: 'PATCH', body: JSON.stringify({ title: 't', summary: 's' }) }), ctx)
    const regen = await regeneratePOST(new Request('https://x/api', { method: 'POST' }), ctx)
    expect([edit.status, regen.status]).toEqual([403, 403])
    expect(db.callRecording.update).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('400 for an unknown action', async () => {
    asReviewer()
    expect((await call('delete')).status).toBe(400)
  })

  it('publishes an IN_REVIEW call that has a summary and transcript', async () => {
    asReviewer()
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'IN_REVIEW', summary: 'S', transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'a' }] })
    expect((await call()).status).toBe(200)
    const data = db.callRecording.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'PUBLISHED', reviewedBy: '9' })
    expect(data.publishedAt).toBeInstanceOf(Date)
  })

  it('409 without a summary, and for a REJECTED or merely RECORDED call', async () => {
    asReviewer()
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'IN_REVIEW', summary: null, transcript: [{ discordId: ANN, startMs: 0, endMs: 1, text: 'a' }] })
    expect((await call()).status).toBe(409)
    for (const status of ['REJECTED', 'RECORDED', 'PROCESSING']) {
      db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status, summary: 'S', transcript: [{}] })
      expect(await publishRecording('rec1', '9')).toBe('not-allowed')
    }
    expect(db.callRecording.update).not.toHaveBeenCalled()
  })

  it('404 for an unknown recording', async () => {
    asReviewer()
    db.callRecording.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('unpublish returns to IN_REVIEW, clears publishedAt, and deletes nothing', async () => {
    asReviewer()
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'PUBLISHED' })
    expect((await call('unpublish')).status).toBe(200)
    expect(db.callRecording.update.mock.calls[0][0].data).toMatchObject({ status: 'IN_REVIEW', publishedAt: null })
    expect(db.callRecording.delete).not.toHaveBeenCalled()
    expect(db.callRecording.deleteMany).not.toHaveBeenCalled()
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'REJECTED' })
    expect(await unpublishRecording('rec1', '9')).toBe('not-allowed')
  })
})

describe('public visibility', () => {
  it('lists only PUBLISHED calls and selects no audio or key fields', async () => {
    db.callRecording.findMany.mockResolvedValue([])
    await listPublishedRecordings()
    const arg = db.callRecording.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ status: 'PUBLISHED' })
    expect(Object.keys(arg.select)).not.toEqual(expect.arrayContaining(['mixKey']))
    expect(JSON.stringify(arg.select)).not.toMatch(/mixKey|trackKey|mixBytes|trackBytes|audio/i)
  })

  it('shows one call only when PUBLISHED (unpublished, in-review and rejected are not found), with no audio keys selected', async () => {
    db.callRecording.findFirst.mockResolvedValue(null)
    expect(await getPublishedRecording('rec1')).toBeNull()
    const arg = db.callRecording.findFirst.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'rec1', status: 'PUBLISHED' })
    expect(JSON.stringify(arg.select)).not.toMatch(/mixKey|trackKey|mixBytes|trackBytes|audio/i)
    expect(arg.select.transcript).toBe(true)
    expect(arg.select.summary).toBe(true)
  })

  it('has no public audio route: audio is only under /api/admin/calls', () => {
    const root = path.resolve(__dirname, '../../..')
    expect(existsSync(path.join(root, 'app/api/admin/calls/[id]/audio/route.ts'))).toBe(true)
    for (const p of ['app/api/calls/[id]/audio', 'app/api/calls/audio', 'app/calls/[id]/audio', 'app/api/calls/recordings']) {
      expect(existsSync(path.join(root, p))).toBe(false)
    }
  })
})
