// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { requestVouch, DAY_MS, type VouchRequestDeps } from './vouch-request'

const NOW = new Date('2026-11-09T12:00:00Z')
const deps = (over: Partial<VouchRequestDeps> = {}): VouchRequestDeps => ({
  findSender: vi.fn(async () => ({ memberId: '42', name: 'Sender' })),
  fetchTarget: vi.fn(async (id: string) => (id === '7' ? { Name: 'Friend', discordId: '500' } : id === '8' ? { Name: 'NoDiscord' } : null)),
  alreadyVouched: vi.fn(async () => false),
  hasPending: vi.fn(async () => false),
  countRecent: vi.fn(async () => 0),
  dailyLimit: vi.fn(async () => 5),
  create: vi.fn(async () => ({})),
  now: () => NOW,
  ...over,
})
const run = (d: VouchRequestDeps, target = '7') => requestVouch({ senderDiscordId: 'd1', targetMemberId: target }, d)

describe('requestVouch', () => {
  it('creates the request for the target', async () => {
    const d = deps()
    expect(await run(d)).toEqual({ ok: true, targetName: 'Friend' })
    expect(d.create).toHaveBeenCalledWith({ senderDiscordId: 'd1', senderMemberId: '42', senderName: 'Sender', recipientDiscordId: '500' })
  })

  it('refuses without a profile, to yourself, to an unknown member and to one with no Discord id', async () => {
    expect(await run(deps({ findSender: vi.fn(async () => null) }))).toEqual({ ok: false, reason: 'no-profile' })
    const d = deps()
    expect(await run(d, '42')).toEqual({ ok: false, reason: 'self' })
    expect(await run(d, '999')).toEqual({ ok: false, reason: 'not-found' })
    expect(await run(d, '8')).toEqual({ ok: false, reason: 'unreachable' })
    expect(d.create).not.toHaveBeenCalled()
  })

  it('does not ask someone who already vouched', async () => {
    const d = deps({ alreadyVouched: vi.fn(async () => true) })
    expect(await run(d)).toEqual({ ok: false, reason: 'already-vouched' })
    expect(d.create).not.toHaveBeenCalled()
  })

  it('blocks a duplicate pending request, even at the limit', async () => {
    const d = deps({ hasPending: vi.fn(async () => true), countRecent: vi.fn(async () => 99) })
    expect(await run(d)).toEqual({ ok: false, reason: 'pending' })
    expect(d.create).not.toHaveBeenCalled()
  })

  it('enforces the configurable daily limit over a rolling 24 hours', async () => {
    const d = deps({ countRecent: vi.fn(async () => 5) })
    expect(await run(d)).toEqual({ ok: false, reason: 'limit', limit: 5 })
    expect(d.countRecent).toHaveBeenCalledWith('d1', new Date(NOW.getTime() - DAY_MS))
    expect((await run(deps({ countRecent: vi.fn(async () => 4) }))).ok).toBe(true)
  })
})
