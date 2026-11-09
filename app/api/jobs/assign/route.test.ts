import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: vi.fn(),
}))
vi.mock('@/app/lib/jobs', () => ({
  getJob: vi.fn(),
  getJobRewardAmount: vi.fn(async () => 50),
  hasCompletedJobToday: vi.fn(),
  recordDailyJobCompletion: vi.fn(),
  isTodaysDailyJob: vi.fn(),
  getDayStart: () => new Date('2026-01-01T00:00:00Z'),
  getUsedJobMessageIds: vi.fn(async () => []),
}))
vi.mock('@/app/lib/jobs-verify', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/jobs-verify')>()),
  verifyJobPost: vi.fn(),
  verifyPostsEnabled: vi.fn(),
  unverifiablePayOnClick: vi.fn(),
}))
vi.mock('@/app/lib/rate-limit', () => ({
  checkKeyedRateLimit: vi.fn(),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'slow down' }), { status: 429 }),
}))
vi.mock('@/app/lib/economy', () => ({
  requireOnboarded: vi.fn(),
  getOrCreateEconomy: vi.fn(),
  formatCurrency: (n: number) => `${n} $PEP`,
}))

import { POST } from './route'
import { requireSession } from '@/app/lib/auth-guards'
import {
  getJob,
  hasCompletedJobToday,
  recordDailyJobCompletion,
  isTodaysDailyJob,
} from '@/app/lib/jobs'
import { verifyJobPost, verifyPostsEnabled, unverifiablePayOnClick } from '@/app/lib/jobs-verify'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { requireOnboarded, getOrCreateEconomy } from '@/app/lib/economy'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/jobs/assign', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/jobs/assign — memo building with a <t:...> timestamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFn(requireSession).mockResolvedValue({ ok: true, session: { discordId: 'user-1' } })
    mockFn(requireOnboarded).mockResolvedValue(undefined)
    mockFn(getOrCreateEconomy).mockResolvedValue({})
    mockFn(isTodaysDailyJob).mockResolvedValue(true)
    mockFn(hasCompletedJobToday).mockResolvedValue(false)
    mockFn(recordDailyJobCompletion).mockResolvedValue(true)
    mockFn(verifyPostsEnabled).mockResolvedValue(true)
    mockFn(unverifiablePayOnClick).mockResolvedValue(true)
    mockFn(checkKeyedRateLimit).mockResolvedValue({ success: true })
    mockFn(verifyJobPost).mockResolvedValue({ ok: true, verified: true, messageId: 'm1', channelId: '123456789012345678' })
  })

  it('keeps a valid <t:...> tag raw and drops an out-of-range one, without throwing', async () => {
    mockFn(getJob).mockResolvedValue({
      id: 7,
      description: 'Due <t:9999999999999> and <t:1700000000:R>',
      type: 'General',
      isActive: true,
    })

    const res = await POST(createRequest({ jobId: 7 }))

    expect(res.status).toBe(200)
    expect(recordDailyJobCompletion).toHaveBeenCalledWith(
      'user-1',
      7,
      50,
      'Daily job: Due  and <t:1700000000:R>',
      undefined,
    )
  })

  it('resolves a channel mention to plain text while leaving a valid timestamp raw', async () => {
    mockFn(getJob).mockResolvedValue({
      id: 8,
      description: 'Meet in <#123456789012345678> at <t:1700000000:t>',
      type: 'General',
      isActive: true,
    })

    const res = await POST(createRequest({ jobId: 8 }))

    expect(res.status).toBe(200)
    // No Discord bot token configured in tests, so the mention falls back
    // to "#channel" instead of leaking raw <#id> markup into the ledger.
    expect(recordDailyJobCompletion).toHaveBeenCalledWith(
      'user-1',
      8,
      50,
      'Daily job: Meet in #channel at <t:1700000000:t>',
      { messageId: 'm1', channelId: '123456789012345678' },
    )
  })
})

describe('POST /api/jobs/assign — post verification', () => {
  const job = { id: 9, description: 'Share a movie in <#123456789012345678>', type: 'General', isActive: true }
  beforeEach(() => {
    vi.clearAllMocks()
    mockFn(requireSession).mockResolvedValue({ ok: true, session: { discordId: 'user-1' } })
    mockFn(requireOnboarded).mockResolvedValue(undefined)
    mockFn(getOrCreateEconomy).mockResolvedValue({})
    mockFn(isTodaysDailyJob).mockResolvedValue(true)
    mockFn(hasCompletedJobToday).mockResolvedValue(false)
    mockFn(recordDailyJobCompletion).mockResolvedValue(true)
    mockFn(verifyPostsEnabled).mockResolvedValue(true)
    mockFn(unverifiablePayOnClick).mockResolvedValue(true)
    mockFn(checkKeyedRateLimit).mockResolvedValue({ success: true })
    mockFn(getJob).mockResolvedValue(job)
  })

  it('pays and records the verifying message when the post is found', async () => {
    mockFn(verifyJobPost).mockResolvedValue({ ok: true, verified: true, messageId: 'm9', channelId: '123456789012345678' })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(200)
    expect(mockFn(recordDailyJobCompletion).mock.calls[0][4]).toEqual({ messageId: 'm9', channelId: '123456789012345678' })
  })

  it('409s with a channel link and does not pay when the post is not found', async () => {
    mockFn(verifyJobPost).mockResolvedValue({ ok: false, reason: 'not_found', channelId: '123456789012345678', channelIds: ['123456789012345678'] })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/couldn't find your post/)
    expect(body.error).toMatch(/Complete again/)
    expect(body.code).toBe('POST_NOT_FOUND')
    expect(body.channelId).toBe('123456789012345678')
    expect(recordDailyJobCompletion).not.toHaveBeenCalled()
  })

  it('409s with a mod hint when the channel cannot be checked', async () => {
    mockFn(verifyJobPost).mockResolvedValue({ ok: false, reason: 'channel_unavailable', channelId: '123456789012345678' })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('CHANNEL_UNCHECKABLE')
    expect(body.error).toMatch(/ask a mod/i)
    expect(recordDailyJobCompletion).not.toHaveBeenCalled()
  })

  it('409s when the post already completed another job', async () => {
    mockFn(verifyJobPost).mockResolvedValue({ ok: false, reason: 'reused', channelId: '123456789012345678' })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already completed another job/)
    expect(recordDailyJobCompletion).not.toHaveBeenCalled()
  })

  it('409s if the ledger refuses a reused message at pay time', async () => {
    mockFn(recordDailyJobCompletion).mockResolvedValue('reused')
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('POST_REUSED')
  })

  it('fails closed with 503 when Discord is unreachable', async () => {
    mockFn(verifyJobPost).mockResolvedValue({ ok: false, reason: 'unreachable' })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('DISCORD_UNAVAILABLE')
    expect(recordDailyJobCompletion).not.toHaveBeenCalled()
  })

  it('rate limits retries before reading Discord', async () => {
    mockFn(checkKeyedRateLimit).mockResolvedValue({ success: false })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(429)
    expect(verifyJobPost).not.toHaveBeenCalled()
    expect(recordDailyJobCompletion).not.toHaveBeenCalled()
  })

  it('kill switch: verification off pays on click without reading Discord', async () => {
    mockFn(verifyPostsEnabled).mockResolvedValue(false)
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(200)
    expect(verifyJobPost).not.toHaveBeenCalled()
    expect(mockFn(recordDailyJobCompletion).mock.calls[0][4]).toBeUndefined()
  })

  it('a job with no channel pays on click by default', async () => {
    mockFn(getJob).mockResolvedValue({ ...job, description: 'Say hi to someone' })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(200)
    expect(verifyJobPost).not.toHaveBeenCalled()
  })

  it('a job with no channel does not pay when jobs.unverifiableJobsPayOnClick is off', async () => {
    mockFn(unverifiablePayOnClick).mockResolvedValue(false)
    mockFn(getJob).mockResolvedValue({ ...job, description: 'Say hi to someone' })
    const res = await POST(createRequest({ jobId: 9 }))
    expect(res.status).toBe(409)
    expect(recordDailyJobCompletion).not.toHaveBeenCalled()
  })
})
