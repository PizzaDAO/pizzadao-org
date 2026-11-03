// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { giveVouch, DAY_MS, type GiveVouchDeps } from './give-vouch'

const NOW = new Date('2026-11-02T12:00:00Z')
const deps = (over: Partial<GiveVouchDeps> = {}): GiveVouchDeps => ({
  findVoucher: vi.fn(async () => ({ memberId: '42', name: 'Voucher' })),
  fetchTarget: vi.fn(async (id: string) => (id === '7' ? { Name: 'Friend', discordId: '500' } : id === '8' ? { Name: 'NoDiscord' } : null)),
  exists: vi.fn(async () => false),
  countRecent: vi.fn(async () => 0),
  dailyLimit: vi.fn(async () => 10),
  create: vi.fn(async () => ({})),
  emit: vi.fn(async () => null),
  notify: vi.fn(async () => null),
  now: () => NOW,
  ...over,
})
const run = (d: GiveVouchDeps, target = '7') => giveVouch({ voucherDiscordId: 'd1', targetMemberId: target }, { deps: d, defer: (job) => void job() })

describe('giveVouch', () => {
  it('creates the vouch, then emits both mission events and notifies the target', async () => {
    const d = deps()
    expect(await run(d)).toEqual({ ok: true, targetMemberId: '7', targetName: 'Friend' })
    expect(d.create).toHaveBeenCalledWith('42', '7')
    expect(d.emit).toHaveBeenCalledWith('d1', 'vouch_created', '42')
    expect(d.emit).toHaveBeenCalledWith('500', 'vouch_received', '7')
    expect(d.notify).toHaveBeenCalledWith('7', 'Voucher', '42', '500')
  })

  it('a target with no Discord id still gets the vouch, just no events or notification for them', async () => {
    const d = deps()
    expect((await run(d, '8')).ok).toBe(true)
    expect(d.emit).toHaveBeenCalledTimes(1)
    expect(d.notify).not.toHaveBeenCalled()
  })

  it('refuses without a profile, for yourself and for an unknown member (no writes)', async () => {
    const none = deps({ findVoucher: vi.fn(async () => null) })
    expect(await run(none)).toEqual({ ok: false, reason: 'no-profile' })
    const d = deps()
    expect(await run(d, '42')).toEqual({ ok: false, reason: 'self' })
    expect(await run(d, '999')).toEqual({ ok: false, reason: 'not-found' })
    expect(d.create).not.toHaveBeenCalled()
  })

  it('enforces the daily limit over a rolling 24 hours', async () => {
    const d = deps({ countRecent: vi.fn(async () => 10) })
    expect(await run(d)).toEqual({ ok: false, reason: 'limit', limit: 10 })
    expect(d.countRecent).toHaveBeenCalledWith('42', new Date(NOW.getTime() - DAY_MS))
    expect(d.create).not.toHaveBeenCalled()
    expect((await run(deps({ countRecent: vi.fn(async () => 9) }))).ok).toBe(true)
  })

  it('a repeat is a duplicate even when the daily limit is used up', async () => {
    const d = deps({ exists: vi.fn(async () => true), countRecent: vi.fn(async () => 99) })
    expect(await run(d)).toEqual({ ok: false, reason: 'duplicate' })
    expect(d.create).not.toHaveBeenCalled()
  })

  it('a repeat is a duplicate, with no events', async () => {
    const d = deps({ create: vi.fn(async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }) }) })
    expect(await run(d)).toEqual({ ok: false, reason: 'duplicate' })
    expect(d.emit).not.toHaveBeenCalled()
  })

  it('other database errors propagate', async () => {
    await expect(run(deps({ create: vi.fn(async () => { throw new Error('db down') }) }))).rejects.toThrow('db down')
  })
})
