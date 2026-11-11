/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
// Go-live fixes against the in-memory Prisma fake: pilot (test) proposals, cancel and withdraw, beneficiary, the open
// failure log and the stuck-draft alert.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/app/lib/db', () => ({ prisma: new Proxy({}, { get: (_t, k) => fake.current.db[k] }) }))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildRoles: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ hasRole: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => ''), loadSettings: vi.fn(async () => ({ get: () => [] })) }))
vi.mock('@/app/lib/settings/channels', () => ({ resolveConfiguredChannel: vi.fn(async () => '999999999999999999'), savedChannelId: vi.fn(async () => '') }))

import { SETTINGS } from '@/app/lib/settings/registry'
import { resolvePaymentPolicy } from '@/app/lib/payments/policy'
import { announceCancelled, cancelledMessage, stuckMessage, type PostDeps } from './discord'
import { cancelAndAnnounce, noteOpenFailure, openAndAnnounce, openFailureCode, runProposalsCron, STUCK_AFTER_MS } from './lifecycle'
import { castBallot, cancelProposal, countActiveFor, createProposal, listOpenProposals, openProposal, passedFundingProposalsFor, settleProposal } from './store'
import { KeyConfigError } from './keys'
import { upstashPendingStore } from './pending'
import { makeFakeDb, makeFakePending, mintCredentials, testEnv } from './test-utils'
import type { ProposalRules } from './rules'
import type { RoleDeps } from './eligibility'

const DAY = 24 * 3600_000
const t0 = new Date('2026-11-04T12:00:00Z')
const policy = resolvePaymentPolicy({ get: ((k: string) => (SETTINGS as any)[k].default) as never, readFailed: false, invalidKeys: [] })
const rules: ProposalRules = { windowDays: 7, generalAyes: 15, pilotWindowMinutes: 45, policy }
const env = testEnv()
const roleHolders = (ids: string[]): RoleDeps => ({ voterRoleId: async () => '700000000000000001', listRoleHolders: async () => ids })
const row = (id: string) => fake.current.state.proposal.find((p: any) => p.id === id)

beforeEach(() => {
  fake.current = makeFakeDb()
})

const base = { kind: 'FUNDING' as const, title: 'Pizza party', body: 'b', amountUsdCents: 100000, eventDate: null, city: null, sponsorLabel: null, proposerDiscordId: 'prop' }

function deps(o: Partial<PostDeps> = {}) {
  const post = vi.fn<PostDeps['post']>(async () => ({ id: '555555555555555555' }))
  const edit = vi.fn(async () => {})
  const d: PostDeps = { channelId: async () => '999999999999999999', pingRoleId: async () => '', post, edit, opsChannelId: async () => '888888888888888888', appUrl: () => 'https://app.test', ...o }
  return { d, post, edit }
}

describe('pilot (test) proposals', () => {
  it('open with a short window, threshold 1 and only the pilot members as voters', async () => {
    const { id } = await createProposal({ ...base, isTest: true })
    expect(row(id).isTest).toBe(true)
    const r = await openProposal(id, { now: t0, deps: roleHolders(['a', 'b', 'c', 'z']), rules, env, keyBits: 2048, pilot: ['a', 'c', 'x'], pending: null })
    expect(r).toEqual({ ok: true, eligible: 2 })
    expect(row(id)).toMatchObject({ status: 'OPEN', ayesNeeded: 1, eligibleCount: 2 })
    expect(row(id).closesAt.getTime() - row(id).opensAt.getTime()).toBe(45 * 60_000)
    expect(fake.current.state.voter.map((v: any) => v.discordId).sort()).toEqual(['a', 'c'])
  })

  it('a real proposal ignores the pilot list entirely', async () => {
    const { id } = await createProposal(base)
    await openProposal(id, { now: t0, deps: roleHolders(['a', 'b']), rules, env, keyBits: 2048, pilot: ['a'], pending: null })
    expect(row(id)).toMatchObject({ isTest: false, eligibleCount: 2, ayesNeeded: 25 })
    expect(row(id).closesAt.getTime() - row(id).opensAt.getTime()).toBe(7 * DAY)
  })

  it('is cancelled, not opened, when the pilot has ended', async () => {
    const { id } = await createProposal({ ...base, isTest: true })
    expect(await openProposal(id, { now: t0, deps: roleHolders(['a']), rules, env, pilot: [], pending: null })).toEqual({ ok: false, code: 'pilot_over' })
    expect(row(id).status).toBe('CANCELLED')
    expect(fake.current.state.voter).toHaveLength(0)
  })

  it('never reaches the open list (unless a tester asks), the payment picker or counts', async () => {
    const real = (await createProposal(base)).id
    const test = (await createProposal({ ...base, isTest: true })).id
    const seen: any[] = []
    fake.current.db.proposal.findMany = async (q: any) => {
      seen.push(q.where)
      return fake.current.state.proposal.filter((r: any) => (q.where.isTest === false ? r.isTest === false : true)).map((r: any) => ({ ...r, createdAt: r.createdAt ?? new Date(0), historyPayments: [] }))
    }
    expect((await listOpenProposals()).map((p) => p.id)).toEqual([real])
    expect((await listOpenProposals({ includeTest: true })).map((p) => p.id).sort()).toEqual([real, test].sort())
    await passedFundingProposalsFor('someone')
    expect(seen[seen.length - 1]).toMatchObject({ isTest: false, source: 'APP', kind: 'FUNDING', status: 'PASSED' })
  })
})

describe('beneficiary', () => {
  it('is stored, and naming the proposer is the same as naming nobody', async () => {
    const a = await createProposal({ ...base, beneficiaryDiscordId: 'ben' })
    const b = await createProposal({ ...base, beneficiaryDiscordId: 'prop' })
    expect(row(a.id).beneficiaryDiscordId).toBe('ben')
    expect(row(b.id).beneficiaryDiscordId).toBeNull()
  })

  it('the payment picker lists a proposal for its proposer and for its beneficiary', async () => {
    let where: any
    fake.current.db.proposal.findMany = async (q: any) => {
      where = q.where
      return []
    }
    await passedFundingProposalsFor('ben')
    expect(where.OR).toEqual([{ proposerDiscordId: 'ben' }, { beneficiaryDiscordId: 'ben' }])
  })
})

async function openOne(opts: { pending?: any } = {}) {
  const { id } = await createProposal(base)
  await openProposal(id, { now: t0, deps: roleHolders(['v1', 'v2']), rules, env, keyBits: 2048, pending: opts.pending ?? null })
  return id
}

describe('cancel and withdraw', () => {
  it('an admin cancels a draft or an open proposal: CANCELLED, closedAt, a logged reason, ballots gone, pending hash gone, never counted', async () => {
    const pending = makeFakePending()
    const id = await openOne({ pending: pending.store })
    fake.current.state.ballot.push({ id: 'b1', proposalId: id, tokenHash: 'h'.repeat(64), choice: 'AYE' })
    await pending.store.put(id, 'a'.repeat(64), 'AYE')
    const r = await cancelProposal(id, { discordId: 'admin', admin: true }, 'duplicate of another', { now: new Date(t0.getTime() + 1000), pending: pending.store })
    expect(r).toMatchObject({ ok: true, wasOpen: true })
    expect(row(id)).toMatchObject({ status: 'CANCELLED', closedAt: new Date(t0.getTime() + 1000) })
    expect(fake.current.state.ballot).toHaveLength(0)
    expect(pending.hashes.has(id)).toBe(false)
    const ev = fake.current.state.event.find((e: any) => e.type === 'CANCELLED')
    expect(ev).toMatchObject({ actorDiscordId: 'admin', data: { by: 'admin', reason: 'duplicate of another', wasOpen: true } })
    // a later settle cannot count it
    expect(await settleProposal(id, new Date(t0.getTime() + 30 * DAY), { pending: pending.store })).toEqual({ ok: false, code: 'not_open' })

    const { id: draft } = await createProposal(base)
    expect(await cancelProposal(draft, { discordId: 'admin', admin: true }, 'typo in the amount', { pending: null })).toMatchObject({ ok: true, wasOpen: false })
  })

  it('an admin must give a reason, and cannot cancel what is already closed', async () => {
    const id = await openOne()
    expect(await cancelProposal(id, { discordId: 'admin', admin: true }, '', { pending: null })).toEqual({ ok: false, code: 'bad_reason' })
    expect(await cancelProposal(id, { discordId: 'admin', admin: true }, '  ', { pending: null })).toEqual({ ok: false, code: 'bad_reason' })
    row(id).status = 'PASSED'
    expect(await cancelProposal(id, { discordId: 'admin', admin: true }, 'too late now', { pending: null })).toEqual({ ok: false, code: 'not_cancellable' })
    expect(await cancelProposal('nope', { discordId: 'admin', admin: true }, 'whatever', { pending: null })).toEqual({ ok: false, code: 'not_found' })
  })

  it('nobody, admins included, can cancel once the window has ended (it settles instead)', async () => {
    const id = await openOne()
    const after = new Date(t0.getTime() + 7 * DAY + 1000)
    expect(await cancelProposal(id, { discordId: 'admin', admin: true }, 'too late to cancel', { now: after, pending: null })).toEqual({ ok: false, code: 'not_cancellable' })
    expect(row(id).status).toBe('OPEN')
    // an admin can still cancel inside the window, and a draft at any time
    expect(await cancelProposal(id, { discordId: 'admin', admin: true }, 'still inside window', { now: new Date(t0.getTime() + DAY), pending: null })).toMatchObject({ ok: true })
  })

  it('a vote racing a cancel leaves no orphan in Redis', async () => {
    const pending = makeFakePending()
    const id = await openOne({ pending: pending.store })
    const creds = await mintCredentials({ id, ...row(id) }, env)
    const realPut = pending.store.put
    // the cancel lands right after the vote's Redis write
    pending.store.put = async (...a: Parameters<typeof realPut>) => {
      await realPut(...a)
      row(id).status = 'CANCELLED'
    }
    expect(await castBallot(id, creds, 'AYE', { now: new Date(t0.getTime() + 1000), env, pending: pending.store })).toEqual({ ok: false, code: 'closed' })
    expect(pending.hashes.has(id)).toBe(false)
  })

  it('imported history can never be cancelled', async () => {
    fake.current.state.proposal.push({ id: 'imp1', status: 'PASSED', source: 'IMPORTED' })
    expect(await cancelProposal('imp1', { discordId: 'admin', admin: true }, 'no way', { pending: null })).toEqual({ ok: false, code: 'not_found' })
  })

  it('the proposer withdraws their own proposal any time until the window ends, not after, and nobody else can', async () => {
    const id = await openOne()
    const inside = new Date(t0.getTime() + 6 * DAY)
    expect(await cancelProposal(id, { discordId: 'other', admin: false }, '', { now: inside, pending: null })).toEqual({ ok: false, code: 'not_allowed' })
    expect(await cancelProposal(id, { discordId: 'prop', admin: false }, '', { now: new Date(t0.getTime() + 7 * DAY + 1000), pending: null })).toEqual({ ok: false, code: 'not_cancellable' })
    expect(await cancelProposal(id, { discordId: 'prop', admin: false }, '', { now: inside, pending: null })).toMatchObject({ ok: true, wasOpen: true })
    expect(fake.current.state.event.find((e: any) => e.type === 'CANCELLED').data.by).toBe('proposer')
    // a draft too
    const { id: draft } = await createProposal(base)
    expect(await cancelProposal(draft, { discordId: 'prop', admin: false }, '', { pending: null })).toMatchObject({ ok: true, wasOpen: false })
  })

  it('a failing Redis delete does not undo the cancel', async () => {
    const pending = makeFakePending()
    const id = await openOne({ pending: pending.store })
    pending.state.failRemove = true
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await cancelProposal(id, { discordId: 'admin', admin: true }, 'spam proposal', { now: new Date(t0.getTime() + 1000), pending: pending.store })).toMatchObject({ ok: true })
    expect(row(id).status).toBe('CANCELLED')
    spy.mockRestore()
  })

  it('updates the Discord post to "withdrawn" without a link, a ping or a reason', async () => {
    const id = await openOne()
    Object.assign(row(id), { discordChannelId: '999999999999999999', discordMessageId: '555555555555555555' })
    const { d, edit } = deps()
    expect(await cancelAndAnnounce(id, { discordId: 'admin', admin: true }, 'private reason text', d, { now: new Date(t0.getTime() + 1000), pending: null })).toMatchObject({ ok: true })
    expect(edit).toHaveBeenCalledTimes(1)
    const [ch, msg, body] = (edit.mock.calls[0] as unknown) as [string, string, { content: string; allowed_mentions: unknown }]
    expect([ch, msg]).toEqual(['999999999999999999', '555555555555555555'])
    expect(body.content).toContain('withdrawn')
    expect(body.content).not.toMatch(/private reason|https?:/)
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(cancelledMessage({ title: 'x' }).content).toContain('no votes were counted')
  })

  it('an edit failure is reported but never throws', async () => {
    const id = await openOne()
    Object.assign(row(id), { discordChannelId: '999999999999999999', discordMessageId: '555555555555555555' })
    const { d } = deps({ edit: async () => { throw new Error('discord down') } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await cancelAndAnnounce(id, { discordId: 'admin', admin: true }, 'reason ok', d, { now: new Date(t0.getTime() + 1000), pending: null })).ok).toBe(true)
    expect(await announceCancelled(id, d)).toBe('failed')
    spy.mockRestore()
  })

  it('counts a member\'s waiting and open proposals (the per-proposer cap)', async () => {
    await createProposal(base)
    await openOne()
    const { id } = await createProposal(base)
    row(id).status = 'PASSED'
    expect(await countActiveFor('prop')).toBe(2)
    expect(await countActiveFor('nobody')).toBe(0)
  })
})

describe('open failures and stuck drafts', () => {
  it('maps failures to short codes, never messages', () => {
    expect(openFailureCode(new KeyConfigError('secret too short abc'))).toBe('key_config')
    expect(openFailureCode(new Error('voter role not resolved'))).toBe('voter_role')
    expect(openFailureCode(new Error('guild member listing incomplete'))).toBe('listing_incomplete')
    expect(openFailureCode(new Error('something with proposal-secret-token'))).toBe('error')
  })

  it('records an OPEN_FAILED event (code only) when the open throws, and when there is no Redis', async () => {
    const { id } = await createProposal(base)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('VERCEL_ENV', 'production')
    // openAndAnnounce uses the real defaults: the Discord role lookups are mocked away, so the open throws
    await openAndAnnounce(id, deps().d)
    vi.unstubAllEnvs()
    spy.mockRestore()
    const ev = fake.current.state.event.filter((e: any) => e.type === 'OPEN_FAILED')
    expect(ev).toHaveLength(1)
    expect(Object.keys(ev[0].data)).toEqual(['code'])
    expect(row(id).status).toBe('DRAFT')
  })

  it('does not repeat the same failure within hours, repeats it later, and stays quiet for previews and races', async () => {
    const { id } = await createProposal(base)
    await noteOpenFailure(id, 'no_redis', t0)
    await noteOpenFailure(id, 'no_redis', new Date(t0.getTime() + 3600_000))
    expect(fake.current.state.event.filter((e: any) => e.type === 'OPEN_FAILED')).toHaveLength(1)
    await noteOpenFailure(id, 'voter_role', new Date(t0.getTime() + 3600_000))
    await noteOpenFailure(id, 'no_redis', new Date(t0.getTime() + 7 * 3600_000))
    expect(fake.current.state.event.filter((e: any) => e.type === 'OPEN_FAILED')).toHaveLength(3)
    for (const c of ['not_production', 'not_draft', 'not_found', 'pilot_over']) await noteOpenFailure(id, c, new Date(t0.getTime() + 30 * 3600_000))
    expect(fake.current.state.event.filter((e: any) => e.type === 'OPEN_FAILED')).toHaveLength(3)
  })

  it('tells the ops channel once about drafts older than 2 hours, counts only', async () => {
    const { id } = await createProposal({ ...base, title: 'Secret title' })
    row(id).createdAt = t0
    const { d, post } = deps()
    const young = await runProposalsCron(new Date(t0.getTime() + STUCK_AFTER_MS - 1000), d, { pending: null })
    expect(young.stuckAlerted).toBe(0)
    const later = new Date(t0.getTime() + STUCK_AFTER_MS + 1000)
    const r1 = await runProposalsCron(later, d, { pending: null })
    expect(r1.stuckAlerted).toBe(1)
    const alert = post.mock.calls.find((c) => c[0] === '888888888888888888')!
    expect(alert[1].content).toContain('1 proposal has been waiting')
    expect(alert[1].content).not.toContain('Secret title')
    const r2 = await runProposalsCron(new Date(later.getTime() + 3600_000), d, { pending: null })
    expect(r2.stuckAlerted).toBe(0)
    expect(post.mock.calls.filter((c) => c[0] === '888888888888888888')).toHaveLength(1)
    expect(stuckMessage(2, 'https://a').content).toContain('2 proposals have been waiting')
  })

  it('posts no alert and records nothing without an ops channel (the admin page still lists it)', async () => {
    const { id } = await createProposal(base)
    row(id).createdAt = t0
    const { d, post } = deps({ opsChannelId: async () => null })
    const r = await runProposalsCron(new Date(t0.getTime() + 3 * 3600_000), d, { pending: null })
    expect(r.stuckAlerted).toBe(0)
    expect(post).not.toHaveBeenCalled()
    expect(fake.current.state.event.some((e: any) => e.type === 'STUCK_ALERTED')).toBe(false)
  })
})

describe('the Redis pending store', () => {
  it('clears a cancelled proposal\'s whole pending hash', async () => {
    const del = vi.fn(async () => 1)
    await upstashPendingStore({ del } as any).clear('p9')
    expect(del).toHaveBeenCalledWith('proposal-pending:p9')
  })
})
