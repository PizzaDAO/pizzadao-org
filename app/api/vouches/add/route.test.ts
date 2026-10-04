// @vitest-environment node
// POST /api/vouches/add re-runs the voucher's vouch_given verifier (L5.2) after
// the response, keyed by the voucher's Discord ID with their member ID.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ME = { discordId: '400000000000000042', memberId: '42', name: 'Don Pepperoni' }

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberByDiscordId: vi.fn(async () => ME) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberById: vi.fn(async (id: string) => (id === '7' ? { discordId: '500000000000000007', Name: 'Friend' } : null)),
}))
vi.mock('@/app/lib/vouches', () => ({
  addVouch: vi.fn(async () => ({})),
  notifyVouchAdded: vi.fn(async () => ({})),
}))
vi.mock('@/app/lib/mission-verify/events', () => ({ emitMissionEvent: vi.fn(async () => null) }))

import { POST } from './route'
import { getSession } from '@/app/lib/session'
import { addVouch } from '@/app/lib/vouches'
import { emitMissionEvent } from '@/app/lib/mission-verify/events'

const req = (body: unknown) =>
  new Request('https://app.pizzadao.org/api/vouches/add', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue({ discordId: ME.discordId } as never)
})

describe('POST /api/vouches/add -> vouch_created hook', () => {
  it('a new vouch re-runs the voucher\'s verifiers', async () => {
    const res = await POST(req({ targetMemberId: '7' }))
    expect(res.status).toBe(200)
    expect(addVouch).toHaveBeenCalledWith('42', '7')
    expect(emitMissionEvent).toHaveBeenCalledWith(ME.discordId, 'vouch_created', { memberId: '42' })
  })

  it('no hook for a self-vouch, an unknown member or a duplicate', async () => {
    expect((await POST(req({ targetMemberId: '42' }))).status).toBe(400)
    expect((await POST(req({ targetMemberId: '999' }))).status).toBe(404)
    vi.mocked(addVouch).mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect((await POST(req({ targetMemberId: '7' }))).status).toBe(409)
    expect(emitMissionEvent).not.toHaveBeenCalled()
  })
})
