import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db', () => ({ prisma: { appSetting: { findMany: async () => [] } } }))
vi.mock('./missions', () => ({ completedLevelBy: vi.fn() }))
vi.mock('./member-registration', () => ({ readSignedUpMembers: vi.fn() }))

import { runTraineeNicks, removePizzaNoobOnGraduate, parseSince, type TraineeNickDeps } from './trainee-nick-run'
import { prisma } from './db'
import type { MemberWrite,MemberWriteResult, WelcomeResult } from './discord'

const NOOB = '555555'
const BOT = 'botid'
const ROLES = [
  { id: '100001', name: 'Member', position: 10, managed: false },
  { id: '100003', name: 'Bot role', position: 120, managed: false },
  { id: '100004', name: 'Admin', position: 125, managed: false },
  { id: NOOB, name: 'Pizza Noob', position: 5, managed: false },
]
const ok: MemberWriteResult = { status: 204, remaining: 4, resetAfterMs: 1000, retryAfterMs: null, blocked: false }
const res = (status: number, over: Partial<MemberWriteResult> = {}): MemberWriteResult => ({ ...ok, status, ...over })

const member = (id: string, over: Record<string, unknown> = {}) => ({
  user: { id },
  nick: null as string | null,
  roles: [] as string[],
  joined_at: '2026-10-19T00:00:00Z',
  ...over,
})

const W_OK: WelcomeResult = { dm: 'sent', channel: 'sent', transient: false, rateLimited: false }

function setup(over: Partial<TraineeNickDeps> = {}, env: Record<string, string> = {}, store = new Set<string>()) {
  const writes: Array<{ op: MemberWrite; reason: string }> = []
  const order: string[] = []
  const signed = new Map<string, string>(Array.from({ length: 120 }, (_, i) => [`s${i}`, `Name ${i}`]))
  const deps: Partial<TraineeNickDeps> = {
    env: { TRAINEE_NICK_SINCE: '2026-10-18T00:00:00Z', ...env } as unknown as NodeJS.ProcessEnv,
    sleep: vi.fn(async () => {}),
    withLock: async (fn) => ({ busy: false, value: await fn() }),
    listMembers: vi.fn(async () => {
      order.push('members')
      return [member(BOT, { roles: ['100003'], joined_at: '2020-01-01T00:00:00Z' }), member('u1'), member('u2', { nick: 'Custom' })]
    }),
    guildInfo: vi.fn(async () => ({ ownerId: 'owner', roles: ROLES })),
    botUserId: vi.fn(async () => BOT),
    readSignedUp: vi.fn(async () => {
      order.push('sheet')
      return signed
    }),
    completedL2: vi.fn(async () => new Set<string>()),
    write: vi.fn(async (op: MemberWrite, reason: string) => {
      writes.push({ op, reason })
      return ok
    }),
    welcome: vi.fn(async () => W_OK),
    welcomedIds: vi.fn(async (ids: string[]) => new Set(ids.filter((i) => store.has(i)))),
    claimWelcome: vi.fn(async (id: string) => (store.has(id) ? false : (store.add(id), true))),
    releaseWelcome: vi.fn(async (id: string) => {
      store.delete(id)
    }),
    recordWelcome: vi.fn(async () => {}),
    reclaimStaleWelcomes: vi.fn(async () => 0),
    ...over,
  }
  return { deps, writes, order, signed }
}

beforeEach(() => vi.clearAllMocks())

describe('runTraineeNicks: gating', () => {
  it('not_configured without TRAINEE_NICK_SINCE (no backfill)', async () => {
    const { deps, writes } = setup({}, {})
    deps.env = {} as unknown as NodeJS.ProcessEnv
    expect(await runTraineeNicks({ dryRun: false, deps })).toEqual({ status: 'not_configured', dryRun: false })
    expect(writes).toEqual([])
    expect(deps.listMembers).not.toHaveBeenCalled()
  })

  it('busy when the lock is held', async () => {
    const { deps } = setup({ withLock: async () => ({ busy: true }) })
    expect(await runTraineeNicks({ dryRun: false, deps })).toEqual({ status: 'busy', dryRun: false })
    expect(deps.listMembers).not.toHaveBeenCalled()
  })

  it('dry run plans but makes no writes', async () => {
    const { deps, writes } = setup()
    const r = await runTraineeNicks({ dryRun: true, deps })
    expect(writes).toEqual([])
    expect(r.status).toBe('finished')
    expect(r.planned).toEqual({ heal: 0, sweep: 0, enforce: 2 })
    expect(r.samples?.enforce).toEqual(['u1', 'u2'])
    expect(r.nickSet).toBe(0)
  })
})

describe('runTraineeNicks: safety guards', () => {
  it('reads the roster after the members', async () => {
    const { deps, order } = setup()
    await runTraineeNicks({ dryRun: true, deps })
    expect(order).toEqual(['members', 'sheet'])
  })

  it('aborts before any write when the roster read fails', async () => {
    const { deps, writes } = setup({ readSignedUp: vi.fn(async () => { throw new Error('Could not find Discord ID column') }) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r).toMatchObject({ status: 'aborted', stoppedReason: 'roster_read_failed' })
    expect(writes).toEqual([])
  })

  it('aborts when the roster is smaller than the minimum', async () => {
    const { deps, writes } = setup({ readSignedUp: vi.fn(async () => new Map([['a', 'A']])) })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r).toMatchObject({ status: 'aborted', stoppedReason: 'roster_too_small' })
    expect(writes).toEqual([])
  })
})

describe('runTraineeNicks: writes', () => {
  it('sets only nick (nick op) with the audit reason, then adds the role with addRole, never a roles PATCH', async () => {
    const { deps, writes } = setup()
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(writes.map((w) => w.op)).toEqual([
      { kind: 'nick', userId: 'u1', nick: 'Pizza Trainee' },
      { kind: 'addRole', userId: 'u1', roleId: NOOB },
      { kind: 'nick', userId: 'u2', nick: 'Pizza Trainee' },
      { kind: 'addRole', userId: 'u2', roleId: NOOB },
    ])
    expect(writes.every((w) => w.reason === 'anchovy-52918 trainee nickname')).toBe(true)
    expect(r).toMatchObject({ enforced: 2, nickSet: 2, roleAdded: 2, roleStatus: 'ok', pizzaNoobRoleId: NOOB })
  })

  it('skips the role add when the nick write got a 403 or 404', async () => {
    const { deps, writes } = setup({
      write: vi.fn(async (op: MemberWrite, reason: string) => {
        writes.push({ op, reason })
        return op.kind === 'nick' ? res(op.userId === 'u1' ? 404 : 403) : ok
      }),
    })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(writes.map((w) => w.op.kind)).toEqual(['nick', 'nick'])
    expect(r.roleAdded).toBe(0)
    expect(r.forbidden).toBe(1)
  })

  it('role at or above the bot, or managed: no role writes, role_not_assignable', async () => {
    for (const role of [{ position: 120, managed: false }, { position: 5, managed: true }]) {
      const { deps, writes } = setup({
        guildInfo: vi.fn(async () => ({ ownerId: 'owner', roles: ROLES.map((r) => (r.id === NOOB ? { ...r, ...role } : r)) })),
      })
      const r = await runTraineeNicks({ dryRun: false, deps })
      expect(r.roleStatus).toBe('role_not_assignable')
      expect(writes.map((w) => w.op.kind)).toEqual(['nick', 'nick'])
    }
  })

  it('unresolved role: nicks only', async () => {
    const { deps, writes } = setup({
      guildInfo: vi.fn(async () => ({ ownerId: 'owner', roles: ROLES.filter((r) => r.id !== NOOB) })),
    })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r.roleStatus).toBe('role_unresolved')
    expect(writes.map((w) => w.op.kind)).toEqual(['nick', 'nick'])
  })

  it('heals signed-up members, sweeps L2 graduates with the L2 reason', async () => {
    const { deps, writes, signed } = setup({
      listMembers: vi.fn(async () => [
        member(BOT, { roles: ['100003'], joined_at: '2020-01-01T00:00:00Z' }),
        member('s1', { nick: 'Pizza Trainee' }),
        member('g1', { nick: 'Pizza Trainee', roles: [NOOB] }),
      ]),
      completedL2: vi.fn(async () => new Set(['g1'])),
    })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(signed.has('s1')).toBe(true)
    expect(writes).toEqual([
      { op: { kind: 'nick', userId: 's1', nick: 'Name 1' }, reason: 'anchovy-52918 trainee nickname' },
      { op: { kind: 'removeRole', userId: 'g1', roleId: NOOB }, reason: 'anchovy-52918 completed missions Level 2' },
    ])
    expect(r).toMatchObject({ healed: 1, roleRemoved: 1 })
  })

  it('fails closed when the L2 lookup throws: no role adds or removals, nicks still enforced', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps, writes } = setup({ completedL2: vi.fn(async () => { throw new Error('db') }) })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(writes.map((w) => w.op.kind)).toEqual(['nick', 'nick'])
    expect(r.stoppedReason).toBe('l2_lookup_failed')
  })
})

describe('runTraineeNicks: rate limits and errors', () => {
  it('waits out a short reset and continues', async () => {
    const { deps, writes } = setup()
    deps.write = vi.fn(async (op: MemberWrite, reason: string) => {
      writes.push({ op, reason })
      return res(204, { remaining: 0, resetAfterMs: 2000 })
    })
    await runTraineeNicks({ dryRun: false, deps })
    expect(deps.sleep).toHaveBeenCalledWith(2000)
    expect(writes).toHaveLength(4)
  })

  it('stops on a long reset', async () => {
    const { deps, writes } = setup()
    deps.write = vi.fn(async (op: MemberWrite, reason: string) => {
      writes.push({ op, reason })
      return res(204, { remaining: 0, resetAfterMs: 30_000 })
    })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(deps.sleep).not.toHaveBeenCalled()
    expect(writes).toHaveLength(1)
    expect(r.stoppedReason).toBe('rate_limit_reset_long')
  })

  it('retries one 429 then continues; a second 429 stops', async () => {
    const { deps, writes } = setup()
    let n = 0
    deps.write = vi.fn(async (op: MemberWrite, reason: string) => {
      writes.push({ op, reason })
      n++
      return n === 1 ? res(429, { retryAfterMs: 1500 }) : ok
    })
    await runTraineeNicks({ dryRun: false, deps })
    expect(deps.sleep).toHaveBeenCalledWith(1500)
    expect(writes).toHaveLength(5) // 1 retried + 4

    const b = setup()
    b.deps.write = vi.fn(async () => res(429, { retryAfterMs: 1000 }))
    const r = await runTraineeNicks({ dryRun: false, deps: b.deps })
    expect(b.deps.write).toHaveBeenCalledTimes(2)
    expect(r.stoppedReason).toBe('rate_limited')
  })

  it('a global or Cloudflare 429 stops at once', async () => {
    const { deps } = setup()
    deps.write = vi.fn(async () => res(429, { retryAfterMs: 1000, blocked: true }))
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(deps.write).toHaveBeenCalledTimes(1)
    expect(deps.sleep).not.toHaveBeenCalled()
    expect(r.stoppedReason).toBe('rate_limited')
  })

  it('one 403 skips, three in a row abort', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const members = [member(BOT, { roles: ['100003'] }), ...['a', 'b', 'c', 'd', 'e'].map((id) => member(id))]
    const one = setup({ listMembers: vi.fn(async () => members) })
    let first = true
    one.deps.write = vi.fn(async () => { const s = first ? 403 : 204; first = false; return res(s) })
    const r1 = await runTraineeNicks({ dryRun: false, deps: one.deps })
    expect(r1.forbidden).toBe(1)
    expect(r1.status).toBe('finished')

    const three = setup({ listMembers: vi.fn(async () => members) })
    three.deps.write = vi.fn(async () => res(403))
    const r3 = await runTraineeNicks({ dryRun: false, deps: three.deps })
    expect(r3).toMatchObject({ status: 'aborted', stoppedReason: 'permission_error' })
    expect(three.deps.write).toHaveBeenCalledTimes(3)
  })

  it('a 404 (member left) is skipped without counting as forbidden', async () => {
    const { deps } = setup()
    deps.write = vi.fn(async () => res(404))
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r.forbidden).toBe(0)
    expect(r.status).toBe('finished')
    expect(deps.write).toHaveBeenCalledTimes(2)
  })
})

describe('parseSince', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  it('rejects lenient, pre-floor and future values', () => {
    for (const v of ['0', '2026', '10/18', '2025-01-01T00:00:00Z', '2026-12-01T00:00:00Z', '2026-10-18', '', undefined, '2026-13-45T00:00:00Z']) {
      expect(parseSince(v, now)).toBeNull()
    }
  })
  it('accepts a full ISO timestamp in range', () => {
    expect(parseSince('2026-10-18T00:00:00Z', now)).toBe(Date.parse('2026-10-18T00:00:00Z'))
  })
  it('the runner is not_configured for a bad value', async () => {
    const { deps } = setup({}, { TRAINEE_NICK_SINCE: '0' })
    expect((await runTraineeNicks({ dryRun: false, deps })).status).toBe('not_configured')
  })
})

describe('write time budget', () => {
  it('stops writing after ~90s and returns partial stats', async () => {
    let t = 0
    const { deps } = setup({ now: () => t })
    deps.write = vi.fn(async () => {
      t += 60_000
      return ok
    })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r.stoppedReason).toBe('time_budget')
    expect(deps.write).toHaveBeenCalledTimes(2)
    expect(r.status).toBe('finished')
  })
})

describe('removePizzaNoobOnGraduate', () => {
  const baseEnv = { TRAINEE_NICK_SINCE: '2026-10-18T00:00:00Z', TRAINEE_NICK_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv
  const mk = (memberInfo: { status: number; member?: { roles: string[]; joined_at?: string } }, env = baseEnv) => {
    const write = vi.fn(async () => ok)
    return {
      write,
      call: () =>
        removePizzaNoobOnGraduate('u1', {
          env,
          guildInfo: async () => ({ ownerId: null, roles: ROLES }),
          fetchMember: async () => memberInfo,
          write,
        }),
    }
  }

  it('removes exactly once when enabled, holding the role, joined after since', async () => {
    const t = mk({ status: 200, member: { roles: [NOOB], joined_at: '2026-10-19T00:00:00Z' } })
    expect(await t.call()).toBe('removed')
    expect(t.write).toHaveBeenCalledTimes(1)
    expect(t.write).toHaveBeenCalledWith({ kind: 'removeRole', userId: 'u1', roleId: NOOB }, 'anchovy-52918 completed missions Level 2')
  })

  it('dry run (flag off): no removal', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const t = mk({ status: 200, member: { roles: [NOOB], joined_at: '2026-10-19T00:00:00Z' } }, { ...baseEnv, TRAINEE_NICK_ENABLED: '' } as unknown as NodeJS.ProcessEnv)
    expect(await t.call()).toBe('skipped')
    expect(t.write).not.toHaveBeenCalled()
  })

  it('no removal when the member lacks the role, joined before since, or is gone', async () => {
    for (const info of [
      { status: 200, member: { roles: [], joined_at: '2026-10-19T00:00:00Z' } },
      { status: 200, member: { roles: [NOOB], joined_at: '2026-10-01T00:00:00Z' } },
      { status: 404 },
    ]) {
      const t = mk(info)
      expect(await t.call()).toBe('skipped')
      expect(t.write).not.toHaveBeenCalled()
    }
  })

  it('does nothing without TRAINEE_NICK_SINCE and never throws', async () => {
    const t = mk({ status: 200, member: { roles: [NOOB], joined_at: '2026-10-19T00:00:00Z' } }, { TRAINEE_NICK_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)
    expect(await t.call()).toBe('skipped')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = await removePizzaNoobOnGraduate('u1', { env: baseEnv, guildInfo: async () => { throw new Error('x') } })
    expect(bad).toBe('skipped')
  })
})

describe('oregano-41907 welcome', () => {
  const TEXT = 'Welcome to PizzaDAO! Grab a name at https://app.pizzadao.org'
  const only = (id: string, over: Record<string, unknown> = {}) => async () => [
    member(BOT, { roles: ['100003'], joined_at: '2020-01-01T00:00:00Z' }),
    member(id, over),
  ]

  it('welcomes each new trainee once with the exact text, DM + channel', async () => {
    const { deps } = setup({}, { TRAINEE_WELCOME_CHANNEL_ID: 'chan1' })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(deps.welcome).toHaveBeenCalledTimes(2)
    expect(deps.welcome).toHaveBeenCalledWith('u1', TEXT, 'chan1')
    expect(r).toMatchObject({ welcomed: 2, welcomeFailed: 0 })
    // second run: rows exist, so nobody is welcomed again
    const again = setup({}, { TRAINEE_WELCOME_CHANNEL_ID: 'chan1' }, new Set(['u1', 'u2']))
    await runTraineeNicks({ dryRun: false, deps: again.deps })
    expect(again.deps.welcome).not.toHaveBeenCalled()
  })

  it('welcomes even when the role is unassignable or the L2 lookup failed', async () => {
    const a = setup({ guildInfo: vi.fn(async () => ({ ownerId: 'owner', roles: ROLES.filter((r) => r.id !== NOOB) })) })
    const ra = await runTraineeNicks({ dryRun: false, deps: a.deps })
    expect(ra.roleStatus).toBe('role_unresolved')
    expect(ra.welcomed).toBe(2)
    const b = setup({ completedL2: vi.fn(async () => { throw new Error('x') }) })
    expect((await runTraineeNicks({ dryRun: false, deps: b.deps })).welcomed).toBe(2)
  })

  it('welcomes an already-renamed member with no row, even after a mod removed the role; not again after', async () => {
    const store = new Set<string>()
    const mk = () => setup({ listMembers: vi.fn(only('u3', { nick: 'Pizza Trainee', roles: [] })) }, {}, store)
    const first = mk()
    expect((await runTraineeNicks({ dryRun: false, deps: first.deps })).welcomed).toBe(1)
    const second = mk()
    await runTraineeNicks({ dryRun: false, deps: second.deps })
    expect(second.deps.welcome).not.toHaveBeenCalled()
  })

  it('an existing row means no welcome (rejoin)', async () => {
    const { deps } = setup({ listMembers: vi.fn(only('u1')) }, {}, new Set(['u1']))
    await runTraineeNicks({ dryRun: false, deps })
    expect(deps.welcome).not.toHaveBeenCalled()
  })

  it('a failed nick write defers the welcome', async () => {
    const { deps } = setup({ listMembers: vi.fn(only('u1')), write: vi.fn(async () => res(403)) })
    await runTraineeNicks({ dryRun: false, deps })
    expect(deps.welcome).not.toHaveBeenCalled()
  })

  it('claims the row before sending', async () => {
    const calls: string[] = []
    const { deps } = setup({
      listMembers: vi.fn(only('u1')),
      claimWelcome: vi.fn(async () => { calls.push('claim'); return true }),
      welcome: vi.fn(async () => { calls.push('send'); return W_OK }),
    })
    await runTraineeNicks({ dryRun: false, deps })
    expect(calls).toEqual(['claim', 'send'])
  })

  it('a lost claim (overlapping run) sends nothing', async () => {
    const { deps } = setup({ listMembers: vi.fn(only('u1')), claimWelcome: vi.fn(async () => false) })
    await runTraineeNicks({ dryRun: false, deps })
    expect(deps.welcome).not.toHaveBeenCalled()
  })

  it('DM closed with channel sent counts as welcomed and is tallied', async () => {
    const { deps } = setup({ welcome: vi.fn(async () => ({ dm: 'closed', channel: 'sent', transient: false, rateLimited: false }) as WelcomeResult) }, { TRAINEE_WELCOME_CHANNEL_ID: 'c' })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r).toMatchObject({ welcomed: 2, welcomeFailed: 0, dmClosed: 2, channelFailed: 0 })
  })

  it('DM closed and no channel is a permanent miss: row kept, not retried', async () => {
    const store = new Set<string>()
    const { deps } = setup({ listMembers: vi.fn(only('u1')), welcome: vi.fn(async () => ({ dm: 'closed', channel: 'skipped', transient: false, rateLimited: false }) as WelcomeResult) }, {}, store)
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r).toMatchObject({ welcomed: 0, welcomeFailed: 1, dmClosed: 1 })
    expect(store.has('u1')).toBe(true)
  })

  it('a transient failure of every leg releases the row so the next run retries', async () => {
    const store = new Set<string>()
    const { deps } = setup({ listMembers: vi.fn(only('u1')), welcome: vi.fn(async () => ({ dm: 'failed', channel: 'failed', transient: true, rateLimited: false }) as WelcomeResult) }, { TRAINEE_WELCOME_CHANNEL_ID: 'c' }, store)
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r).toMatchObject({ welcomed: 0, welcomeFailed: 1, channelFailed: 1 })
    expect(store.has('u1')).toBe(false)
  })

  it('a thrown welcome releases the row and never fails the run or the role steps', async () => {
    const store = new Set<string>()
    const { deps, writes } = setup({ welcome: vi.fn(async () => { throw new Error('boom') }) }, {}, store)
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r).toMatchObject({ status: 'finished', roleAdded: 2, welcomed: 0, welcomeFailed: 2 })
    expect(writes).toHaveLength(4)
    expect(store.size).toBe(0)
  })

  it('welcomes still run after time_budget stops the writes', async () => {
    let t = 0
    const { deps } = setup({ now: () => t, write: vi.fn(async () => { t += 70_000; return ok }) })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(r.stoppedReason).toBe('time_budget')
    expect(deps.welcome).toHaveBeenCalled()
  })

  it('past the welcome deadline nothing is claimed; exactly the rest is deferred', async () => {
    let t = 0
    const { deps } = setup({ now: () => t, write: vi.fn(async () => { t += 100_000; return ok }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(deps.claimWelcome).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deferred'))
    warn.mockRestore()
    expect(r.welcomeDeferred).toBe(1) // u1 renamed; u2 never got its nick write
  })

  it('rate_limited / permission stops skip the welcome step', async () => {
    const { deps } = setup({ write: vi.fn(async () => res(429, { blocked: true })) })
    await runTraineeNicks({ dryRun: false, deps })
    expect(deps.welcome).not.toHaveBeenCalled()
    expect(deps.reclaimStaleWelcomes).not.toHaveBeenCalled()
  })

  it('stops the loop on a long 429: releases that row (undelivered) and defers the rest', async () => {
    const store = new Set<string>()
    const { deps } = setup({ welcome: vi.fn(async () => ({ dm: 'failed', channel: 'failed', transient: true, rateLimited: true }) as WelcomeResult) }, {}, store)
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(deps.welcome).toHaveBeenCalledTimes(1)
    expect(r.welcomeDeferred).toBe(1)
    expect(store.size).toBe(0)
  })

  it('reclaims stale claims at the start of the welcome step, not in dry runs', async () => {
    const a = setup({ reclaimStaleWelcomes: vi.fn(async () => 3) })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runTraineeNicks({ dryRun: false, deps: a.deps })
    expect(a.deps.reclaimStaleWelcomes).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('reclaimed 3'))
    const b = setup()
    await runTraineeNicks({ dryRun: true, deps: b.deps })
    expect(b.deps.reclaimStaleWelcomes).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('default stale reclaim only targets outcome-less claims older than 15 minutes', async () => {
    const deleteMany = vi.fn(async () => ({ count: 2 }))
    ;(prisma as any).traineeWelcome = { deleteMany }
    const { deps } = setup()
    delete (deps as any).reclaimStaleWelcomes
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const before = Date.now()
    await runTraineeNicks({ dryRun: false, deps })
    const where = (deleteMany.mock.calls[0] as any)[0].where
    expect(where.dm).toBeNull()
    expect(where.channel).toBeNull()
    const cutoff = where.welcomedAt.lt.getTime()
    expect(before - cutoff).toBeGreaterThanOrEqual(15 * 60_000 - 5)
    expect(before - cutoff).toBeLessThan(15 * 60_000 + 5_000)
  })

  it('finished rows always get a non-null dm and channel outcome', async () => {
    const { deps } = setup({ welcome: vi.fn(async () => ({ dm: 'closed', channel: 'skipped', transient: false, rateLimited: false }) as WelcomeResult) })
    await runTraineeNicks({ dryRun: false, deps })
    for (const c of (deps.recordWelcome as any).mock.calls) {
      expect(c[1]).toBeTruthy()
      expect(c[2]).toBeTruthy()
    }
    expect((deps.recordWelcome as any).mock.calls.length).toBe(2)
  })

  it('caps welcomes per run at 20 and paces channel posts', async () => {
    const many = Array.from({ length: 25 }, (_, i) => member(`n${i}`, { nick: 'Pizza Trainee', roles: [NOOB] }))
    const { deps } = setup({ listMembers: vi.fn(async () => [member(BOT, { roles: ['100003'], joined_at: '2020-01-01T00:00:00Z' }), ...many]) }, { TRAINEE_WELCOME_CHANNEL_ID: 'c' })
    const r = await runTraineeNicks({ dryRun: false, deps })
    expect(deps.welcome).toHaveBeenCalledTimes(20)
    expect(r.welcomeDeferred).toBe(5)
    expect(deps.sleep).toHaveBeenCalled()
  })

  it('dry run sends and claims nothing', async () => {
    const { deps, writes } = setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runTraineeNicks({ dryRun: true, deps })
    expect(deps.welcome).not.toHaveBeenCalled()
    expect(deps.claimWelcome).not.toHaveBeenCalled()
    expect(writes).toEqual([])
    expect(log).toHaveBeenCalledWith('[trainee-nicks] would welcome u1')
    log.mockRestore()
  })
})
