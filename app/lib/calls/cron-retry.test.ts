// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('./r2', () => ({ getObjectBytes: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn() } }))
vi.mock('@/app/lib/calls/access', () => ({ requireCallReviewer: vi.fn(async () => ({ ok: true, session: { discordId: '9' } })) }))
vi.mock('@/app/lib/cron-auth', () => ({ isCronAuthorized: () => true }))
vi.mock('./transcribe', async (orig) => ({
  ...(await orig<typeof import('./transcribe')>()),
  listPendingTranscription: vi.fn(),
  listNeedingSummary: vi.fn(async () => []),
  transcribeRecording: vi.fn(),
}))

import { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/db'
import { listPendingTranscription, transcribeRecording } from './transcribe'
import { GET as cronGET } from '@/app/api/cron/call-transcripts/route'
import { POST as retryPOST } from '@/app/api/admin/calls/[id]/retry-transcription/route'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const pending = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, eventName: null, crewLabel: null, startedAt: new Date(), durationSec: 60, status: 'RECORDED' }))
const cron = () => cronGET(new NextRequest('http://x/api/cron/call-transcripts', { headers: { authorization: 'Bearer x' } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OPENAI_API_KEY', 'k')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('cron loop', () => {
  it('stops after a run that spent OpenAI calls even if it ended busy or already-had-speech', async () => {
    vi.mocked(listPendingTranscription).mockResolvedValue(pending(3) as never)
    vi.mocked(transcribeRecording).mockImplementation((async (_id: string, deps: { usage?: { calls: number } }) => {
      if (deps.usage) deps.usage.calls++
      return 'busy'
    }) as never)
    await cron()
    expect(transcribeRecording).toHaveBeenCalledTimes(1)
  })
  it('keeps going past no-ops, and shares one start time with each recording', async () => {
    vi.mocked(listPendingTranscription).mockResolvedValue(pending(3) as never)
    vi.mocked(transcribeRecording).mockResolvedValue('nothing-to-transcribe')
    await cron()
    expect(transcribeRecording).toHaveBeenCalledTimes(3)
    const starts = vi.mocked(transcribeRecording).mock.calls.map((c) => (c[1] as { startedMs: number }).startedMs)
    expect(new Set(starts).size).toBe(1)
  })
  it('does not begin another recording after 30 seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
    vi.mocked(listPendingTranscription).mockResolvedValue(pending(3) as never)
    vi.mocked(transcribeRecording).mockImplementation((async () => {
      vi.setSystemTime(new Date('2026-10-28T12:00:40Z'))
      return 'nothing-to-transcribe'
    }) as never)
    await cron()
    expect(transcribeRecording).toHaveBeenCalledTimes(1)
  })
})

describe('retry route', () => {
  const call = (id = 'rec1') => retryPOST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id }) })

  it('only resets rows that used up their attempts, are not claimed (or the claim is stale) and are not too-large', async () => {
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    expect((await call('a1')).status).toBe(200)
    const where = db.callRecording.updateMany.mock.calls[0][0].where
    expect(where.transcribeAttempts).toEqual({ gte: 3 })
    expect(where.transcribedAt).toBeNull()
    const flat = JSON.stringify(where.AND)
    expect(flat).toContain('claimed')
    expect(flat).toContain('every track is larger')
    expect(db.callRecording.updateMany.mock.calls[0][0].data).toEqual({ transcribeAttempts: 0, transcribeError: null, retranscribeRequestedAt: expect.any(Date) })
  })
  it('flags a never-processed row outside the cron window so the cron picks it up', async () => {
    db.callRecording.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    expect((await call('old1')).status).toBe(200)
    const second = db.callRecording.updateMany.mock.calls[1][0]
    expect(second.where).toMatchObject({ transcribedAt: null, transcribeAttempts: 0, transcribeError: null, retranscribeRequestedAt: null })
    expect(second.where.startedAt.lt).toBeInstanceOf(Date)
    expect(second.where.speakers).toEqual({ some: { trackKey: { not: null }, talkTimeSec: { gt: 0 } } })
    expect(second.data).toEqual({ retranscribeRequestedAt: expect.any(Date) })
  })
  it('refuses when no row matches', async () => {
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    expect((await call('b1')).status).toBe(409)
  })
  it('rate limits repeated retries of the same recording', async () => {
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    expect((await call('c1')).status).toBe(200)
    expect((await call('c1')).status).toBe(409)
  })
})
