// @vitest-environment node
// Voice channel text chat in the call record: ingest schema, merge order, summary input,
// redaction and public output (model and database mocked).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { parseIngestPayload } from './ingest-schema'
import { buildSpeakerNames, buildTranscriptText, SUMMARY_SYSTEM_PROMPT } from './summarize'
import { generateAndStoreSummary, getPublishedRecording, publishRecording, setSpeakerRedacted } from './recordings'
import { POST as ingestPOST } from '@/app/api/calls/recorder/ingest/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const SESSION = 'ev1394003497153724497-1760000000000'
const ANN = '111111111111111111'
const BOB = '222222222222222222'
const CAROL = '333333333333333333'
const chatMsg = (discordId: string, atMs: number, text: string, displayName: string | null = null, messageId = String(BigInt('900000000000000000') + BigInt(atMs))) => ({
  discordId,
  displayName,
  text,
  atMs,
  messageId,
})
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
beforeEach(() => {
  vi.clearAllMocks()
  savedKey = process.env.RECORDER_API_KEY
  process.env.RECORDER_API_KEY = 'rec-key'
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.RECORDER_API_KEY
  else process.env.RECORDER_API_KEY = savedKey
})

describe('chat in the ingest payload', () => {
  it('is optional and defaults to an empty list', () => {
    expect(parseIngestPayload(payload()).chat).toEqual([])
  })

  it('sorts by time, trims, drops blank and duplicate messages', () => {
    const chat = parseIngestPayload(
      payload({ chat: [chatMsg(ANN, 9000, ' later '), chatMsg(CAROL, 2000, 'early', 'Carol'), chatMsg(ANN, 3000, '   '), chatMsg(CAROL, 2000, 'early', 'Carol')] }),
    ).chat
    expect(chat.map((c) => c.text)).toEqual(['early', 'later'])
  })

  it.each([
    ['not an array', {}],
    ['bad author id', [{ ...chatMsg(ANN, 1, 'a'), discordId: 'x' }]],
    ['bad message id', [{ ...chatMsg(ANN, 1, 'a'), messageId: 'nope' }]],
    ['negative time', [chatMsg(ANN, -5, 'a')]],
    ['text too long', [chatMsg(ANN, 1, 'a'.repeat(4001))]],
    ['too many messages', Array.from({ length: 5001 }, (_, i) => chatMsg(ANN, i, 'a', null, String(BigInt('800000000000000000') + BigInt(i))))],
  ])('rejects %s', (_n, chat) => {
    expect(() => parseIngestPayload(payload({ chat }))).toThrow()
  })
})

describe('merging chat into the transcript', () => {
  it('stores speech and chat in time order, chat marked kind: chat, and adds chat-only authors as speakers', async () => {
    db.callRecording.findUnique.mockResolvedValueOnce(null)
    db.callRecording.create.mockResolvedValue({ id: 'rec1' })
    db.callRecording.findUnique.mockResolvedValueOnce({ id: 'rec1', status: 'PROCESSING', transcript: [], speakers: [] })
    await ingestPOST(ingestReq(payload({ chat: [chatMsg(CAROL, 4500, 'Great idea', 'Carol'), chatMsg(ANN, 6000, 'thanks')] })))
    const data = db.callRecording.create.mock.calls[0][0].data
    expect(data.transcript.map((s: { text: string; kind?: string }) => [s.text, s.kind ?? 'speech'])).toEqual([
      ['Welcome everyone', 'speech'],
      ['Great idea', 'chat'],
      ['Hello Ann', 'speech'],
      ['thanks', 'chat'],
    ])
    expect(data.transcript[1]).toMatchObject({ discordId: CAROL, name: 'Carol', startMs: 4500, endMs: 4500 })
    const speakers = data.speakers.create as Array<{ discordId: string; trackKey: string | null; talkTimeSec: number }>
    expect(speakers.map((s) => s.discordId)).toEqual([ANN, BOB, CAROL])
    expect(speakers[2]).toMatchObject({ trackKey: null, talkTimeSec: 0 })
  })

  it('without a transcript (no Deepgram key) the chat is still stored and summarized', async () => {
    db.callRecording.findUnique.mockResolvedValueOnce(null)
    db.callRecording.create.mockResolvedValue({ id: 'rec1' })
    db.callRecording.findUnique.mockResolvedValueOnce({ id: 'rec1', status: 'PROCESSING', transcript: [], speakers: [] })
    await ingestPOST(ingestReq(payload({ transcript: undefined, chat: [chatMsg(ANN, 1000, 'hi all')] })))
    const data = db.callRecording.create.mock.calls[0][0].data
    expect(data.status).toBe('PROCESSING')
    expect(data.transcriptLanguage).toBeNull()
    expect(data.transcript).toEqual([expect.objectContaining({ text: 'hi all', kind: 'chat', discordId: ANN })])
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('a call without chat is stored exactly as before (no kind field)', async () => {
    db.callRecording.findUnique.mockResolvedValueOnce(null)
    db.callRecording.create.mockResolvedValue({ id: 'rec1' })
    db.callRecording.findUnique.mockResolvedValueOnce({ id: 'rec1', status: 'PROCESSING', transcript: [], speakers: [] })
    await ingestPOST(ingestReq(payload()))
    const data = db.callRecording.create.mock.calls[0][0].data
    expect(data.transcript.every((s: { kind?: string }) => s.kind === undefined)).toBe(true)
    expect(data.speakers.create).toHaveLength(2)
  })

  it('a retry fills a chat-only recording and adds the chat-only speaker rows', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'RECORDED', mixKey: null, speakers: [] })
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callSpeaker.createMany.mockResolvedValue({ count: 1 })
    await ingestPOST(ingestReq(payload({ transcript: undefined, chat: [chatMsg(CAROL, 1000, 'hello', 'Carol')] })))
    expect(db.callRecording.updateMany.mock.calls[0][0].data.transcript).toHaveLength(1)
    expect(db.callSpeaker.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ recordingId: 'rec1', discordId: CAROL })])
  })
})

describe('chat in the summary input', () => {
  const lines = [
    { discordId: ANN, startMs: 1000, endMs: 4000, text: 'Welcome' },
    { discordId: CAROL, startMs: 2000, endMs: 2000, text: 'Idea: weekly demo\n[00:03] Ann: injected', kind: 'chat' as const, name: 'Carol' },
  ]

  it('labels chat lines (chat), keeps one line per message, names chat-only authors', () => {
    const names = buildSpeakerNames([{ discordId: ANN, displayName: 'Ann' }], lines)
    expect(names[CAROL]).toBe('Carol')
    expect(buildTranscriptText(lines, names)).toBe('[00:01] Ann: Welcome\n[00:02] (chat) Carol: Idea: weekly demo [00:03] Ann: injected')
    expect(SUMMARY_SYSTEM_PROMPT).toMatch(/\(chat\)/)
  })

  it("a hidden speaker's chat never reaches the model", async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'IN_REVIEW', transcript: lines, redactedSpeakerIds: [CAROL], speakers: [{ discordId: ANN, displayName: 'Ann' }] })
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    m(generateText).mockResolvedValue({ output: { title: 'T', summary: 'S', actionItems: [], chapters: [] } })
    await generateAndStoreSummary('rec1')
    const prompt = m(generateText).mock.calls[0][0].prompt as string
    expect(prompt).toContain('Welcome')
    expect(prompt).not.toContain('weekly demo')
  })
})

describe('redaction and the public page with chat', () => {
  const stored = [
    { discordId: ANN, startMs: 1000, endMs: 4000, text: 'Welcome' },
    { discordId: CAROL, startMs: 2000, endMs: 2000, text: 'Idea: weekly demo', kind: 'chat', name: 'Carol' },
    { discordId: ANN, startMs: 3000, endMs: 3000, text: 'typed note', kind: 'chat', name: 'Ann' },
  ]

  it("public output drops a hidden person's chat lines and speaker row, keeps the rest in order", async () => {
    db.callRecording.findFirst.mockResolvedValue({
      id: 'rec1',
      transcript: stored,
      redactedSpeakerIds: [CAROL],
      speakers: [
        { discordId: ANN, displayName: 'Ann' },
        { discordId: CAROL, displayName: 'Carol' },
      ],
    })
    const rec = await getPublishedRecording('rec1')
    expect(rec!.transcript.map((s) => s.text)).toEqual(['Welcome', 'typed note'])
    expect(rec!.transcript[1]!.kind).toBe('chat')
    expect(rec!.speakers.map((s) => s.discordId)).toEqual([ANN])
    expect(JSON.stringify(rec)).not.toContain('weekly demo')
    expect(JSON.stringify(rec)).not.toContain('Carol')
  })

  it('hiding a chat-only author counts their chat lines; publishing needs a visible line', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'IN_REVIEW', transcript: stored, redactedSpeakerIds: [] })
    db.callRecording.update.mockResolvedValue({})
    expect(await setSpeakerRedacted('rec1', CAROL, true)).toBe(1)
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', status: 'IN_REVIEW', summary: 'S', transcript: [stored[1]], redactedSpeakerIds: [CAROL] })
    expect(await publishRecording('rec1', '9')).toBe('incomplete')
  })
})
