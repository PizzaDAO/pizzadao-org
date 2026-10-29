/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
// Mixing: votes go to a pending hash, and the cron / settle move them into the ballot table in one sorted transaction.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/app/lib/db', () => ({ prisma: new Proxy({}, { get: (_t, k) => fake.current.db[k] }) }))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildRoles: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ hasRole: vi.fn() }))
vi.mock('@/app/lib/mission-verify/bulk', () => ({ listGuildMemberRoles: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => ''), loadSettings: vi.fn() }))
vi.mock('@/app/lib/settings/channels', () => ({ resolveConfiguredChannel: vi.fn(async () => null) }))

import { SETTINGS } from '@/app/lib/settings/registry'
import { resolvePaymentPolicy } from '@/app/lib/payments/policy'
import { castBallot, createProposal, drainPending, openProposal, settleProposal } from './store'
import { runProposalsCron } from './lifecycle'
import { makeFakeDb, makeFakePending, mintCredentials, testEnv } from './test-utils'
import { pendingKey, sortedByHash } from './pending'
import type { ProposalRules } from './rules'

const DAY = 24 * 3600_000
const t0 = new Date('2026-11-04T12:00:00Z')
const policy = resolvePaymentPolicy({ get: ((k: string) => (SETTINGS as any)[k].default) as never, readFailed: false, invalidKeys: [] })
const rules: ProposalRules = { windowDays: 7, generalAyes: 15, policy }
const env = testEnv()
const row = (id: string) => fake.current.state.proposal.find((p: any) => p.id === id)
const noPost = { channelId: async () => null, pingRoleId: async () => '', post: async () => ({ id: null }), appUrl: () => 'https://a' }

beforeEach(() => {
  fake.current = makeFakeDb()
})

async function openOne() {
  const { id } = await createProposal({ kind: 'GENERAL', title: 'T', body: 'B', amountUsdCents: null, eventDate: null, city: null, sponsorLabel: null, proposerDiscordId: 'p' })
  const r = await openProposal(id, { now: t0, deps: { voterRoleId: async () => '7', listRoleHolders: async () => ['v1'] }, rules, env, keyBits: 2048 })
  expect(r.ok).toBe(true)
  return id
}

describe('pending votes', () => {
  it('a vote is written to the pending hash, not the ballot table, and "ok" means that write succeeded', async () => {
    const id = await openOne()
    const { store, hashes } = makeFakePending()
    const creds = await mintCredentials({ id, ...row(id) }, env)
    expect(await castBallot(id, creds, 'AYE', { now: t0, env, pending: store })).toEqual({ ok: true })
    expect(fake.current.state.ballot).toHaveLength(0)
    expect([...hashes.get(id)!.values()]).toEqual(['AYE'])
    // the same token overwrites its earlier entry
    await castBallot(id, creds, 'NAY', { now: t0, env, pending: store })
    expect([...hashes.get(id)!.values()]).toEqual(['NAY'])
  })

  it('answers unavailable (and saves nothing) when the Redis write fails', async () => {
    const id = await openOne()
    const { store, state } = makeFakePending()
    state.failPut = true
    const creds = await mintCredentials({ id, ...row(id) }, env)
    expect(await castBallot(id, creds, 'AYE', { now: t0, env, pending: store })).toEqual({ ok: false, code: 'unavailable' })
    expect(fake.current.state.ballot).toHaveLength(0)
  })

  it('without Redis the vote is written straight to the table (the documented weaker mode)', async () => {
    const id = await openOne()
    const creds = await mintCredentials({ id, ...row(id) }, env)
    expect(await castBallot(id, creds, 'AYE', { now: t0, env, pending: null })).toEqual({ ok: true })
    expect(fake.current.state.ballot.map((b: any) => b.choice)).toEqual(['AYE'])
  })

  it('still refuses votes after closesAt', async () => {
    const id = await openOne()
    const { store, hashes } = makeFakePending()
    const creds = await mintCredentials({ id, ...row(id) }, env)
    expect(await castBallot(id, creds, 'AYE', { now: new Date(t0.getTime() + 7 * DAY), env, pending: store })).toEqual({ ok: false, code: 'closed' })
    expect(hashes.size).toBe(0)
  })
})

describe('draining', () => {
  const seed = async (store: any, id: string, n: number, choice: any = 'AYE') => {
    for (let i = 0; i < n; i++) await store.put(id, `${(997 * (i + 3)).toString(16).padStart(2, '0')}`.padEnd(64, '0'), choice)
  }

  it('moves pending votes into the table in tokenHash order, in one transaction, then clears them', async () => {
    const id = await openOne()
    const { store, hashes } = makeFakePending()
    // inserted in a deliberately non-sorted order
    for (const h of ['f', 'a', 'c', 'e', 'b']) await store.put(id, h.padEnd(64, '0'), 'AYE')
    const txSpy = vi.spyOn(fake.current.db, '$transaction')
    expect(await drainPending(id, { pending: store })).toBe(5)
    expect(txSpy).toHaveBeenCalledTimes(1)
    const order = fake.current.state.ballot.map((b: any) => b.tokenHash[0])
    expect(order).toEqual(['a', 'b', 'c', 'e', 'f'])
    expect(order).toEqual(sortedByHash(fake.current.state.ballot).map((b: any) => b.tokenHash[0]))
    expect(hashes.get(id)!.size).toBe(0)
  })

  it('is idempotent: draining twice changes nothing', async () => {
    const id = await openOne()
    const { store } = makeFakePending()
    await seed(store, id, 3)
    await drainPending(id, { pending: store })
    const after = JSON.stringify(fake.current.state.ballot)
    expect(await drainPending(id, { pending: store })).toBe(0)
    expect(JSON.stringify(fake.current.state.ballot)).toBe(after)
  })

  it('a changed vote replaces the earlier ballot row', async () => {
    const id = await openOne()
    const { store } = makeFakePending()
    const h = 'ab'.padEnd(64, '0')
    await store.put(id, h, 'AYE')
    await drainPending(id, { pending: store })
    await store.put(id, h, 'NAY')
    await drainPending(id, { pending: store })
    expect(fake.current.state.ballot.map((b: any) => b.choice)).toEqual(['NAY'])
  })

  it('survives a crash after the database commit: the re-run writes the same values, and a vote changed in between is kept', async () => {
    const id = await openOne()
    const { store, state, hashes } = makeFakePending()
    const h1 = 'a1'.padEnd(64, '0')
    const h2 = 'b2'.padEnd(64, '0')
    await store.put(id, h1, 'AYE')
    await store.put(id, h2, 'NAY')
    state.failRemove = true // crash between commit and cleanup
    await expect(drainPending(id, { pending: store })).rejects.toThrow()
    expect(fake.current.state.ballot).toHaveLength(2)
    expect(hashes.get(id)!.size).toBe(2) // nothing lost
    state.failRemove = false
    await store.put(id, h1, 'ABSTAIN') // a voter changes their mind before the next run
    await drainPending(id, { pending: store })
    const byHash = Object.fromEntries(fake.current.state.ballot.map((b: any) => [b.tokenHash, b.choice]))
    expect(byHash).toEqual({ [h1]: 'ABSTAIN', [h2]: 'NAY' })
    expect(hashes.get(id)!.size).toBe(0)
  })

  it('a database failure mid-transaction leaves pending untouched', async () => {
    const id = await openOne()
    const { store, hashes } = makeFakePending()
    await seed(store, id, 3)
    const realTx = fake.current.db.$transaction
    fake.current.db.$transaction = async () => { throw new Error('db down') }
    await expect(drainPending(id, { pending: store })).rejects.toThrow()
    fake.current.db.$transaction = realTx
    expect(hashes.get(id)!.size).toBe(3)
    expect(fake.current.state.ballot).toHaveLength(0)
  })

  it('uses the documented Redis key', () => {
    expect(pendingKey('abc')).toBe('proposal-pending:abc')
  })
})

describe('settle drains first', () => {
  it('counts votes that are still pending at close, under the lock, then clears them', async () => {
    const id = await openOne()
    const { store, hashes } = makeFakePending()
    for (let i = 0; i < 20; i++) await store.put(id, i.toString(16).padStart(2, '0').padEnd(64, '0'), 'AYE')
    expect(fake.current.state.ballot).toHaveLength(0)
    const r = await settleProposal(id, new Date(t0.getTime() + 7 * DAY + 1), { pending: store })
    expect(r).toMatchObject({ ok: true, outcome: 'passed', ayes: 20 })
    expect(hashes.get(id)!.size).toBe(0)
    expect(fake.current.state.ballot.map((b: any) => b.tokenHash)).toEqual(sortedByHash(fake.current.state.ballot).map((b: any) => b.tokenHash))
  })

  it('does not drain or count before the close', async () => {
    const id = await openOne()
    const { store, hashes } = makeFakePending()
    await store.put(id, 'aa'.padEnd(64, '0'), 'AYE')
    expect(await settleProposal(id, new Date(t0.getTime() + DAY), { pending: store })).toEqual({ ok: false, code: 'not_due' })
    expect(hashes.get(id)!.size).toBe(1)
    expect(fake.current.state.ballot).toHaveLength(0)
  })

  it('a cleanup failure after the commit does not undo the count', async () => {
    const id = await openOne()
    const { store, state } = makeFakePending()
    for (let i = 0; i < 16; i++) await store.put(id, i.toString(16).padStart(2, '0').padEnd(64, '0'), 'AYE')
    state.failRemove = true
    expect(await settleProposal(id, new Date(t0.getTime() + 8 * DAY), { pending: store })).toMatchObject({ ok: true, outcome: 'passed' })
    expect(row(id).status).toBe('PASSED')
  })
})

describe('hourly run', () => {
  it('drains pending votes of open proposals and settles due ones (which drain first)', async () => {
    const open = await openOne()
    const due = await openOne()
    row(due).closesAt = new Date(t0.getTime() - 1000)
    const { store, hashes } = makeFakePending()
    for (let i = 0; i < 3; i++) await store.put(open, `0${i}`.padEnd(64, '0'), 'AYE')
    for (let i = 0; i < 16; i++) await store.put(due, i.toString(16).padStart(2, '0').padEnd(64, '0'), 'AYE')
    const r = await runProposalsCron(t0, noPost, { pending: store })
    expect(r).toMatchObject({ drained: 3, settled: 1 })
    expect(row(open).status).toBe('OPEN')
    expect(fake.current.state.ballot.filter((b: any) => b.proposalId === open)).toHaveLength(3)
    expect(row(due)).toMatchObject({ status: 'PASSED', ayes: 16 })
    expect(hashes.get(open)!.size).toBe(0)
    expect(hashes.get(due)!.size).toBe(0)
  })
})
