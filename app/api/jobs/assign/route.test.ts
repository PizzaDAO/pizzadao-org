import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: vi.fn(),
}))
vi.mock('@/app/lib/jobs', () => ({
  getJob: vi.fn(),
  JOB_REWARD_AMOUNT: 50,
  hasCompletedJobToday: vi.fn(),
  recordDailyJobCompletion: vi.fn(),
  isTodaysDailyJob: vi.fn(),
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
    )
  })
})
