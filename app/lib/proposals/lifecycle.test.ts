/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
// The daily run and the Discord posts: closes what is due, posts once, retries what failed, posts no counts while open.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/app/lib/db', () => ({ prisma: new Proxy({}, { get: (_t, k) => fake.current.db[k] }) }))
vi.mock('@/app/lib/rare-pizza-box', () => ({ checkRarePizzaBox: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberById: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => ''), loadSettings: vi.fn() }))
vi.mock('@/app/lib/settings/channels', () => ({ resolveConfiguredChannel: vi.fn(async () => '999999999999999999') }))

import { DiscordPostError } from '@/app/lib/discord-rest'
import { announceOpen, openMessage, resultMessage, type PostDeps } from './discord'
import { runProposalsCron } from './lifecycle'
import { createProposal } from './store'
import { makeFakeDb } from './test-utils'

const DAY = 24 * 3600_000
const t0 = new Date('2026-11-04T12:00:00Z')

function deps(o: Partial<PostDeps> = {}) {
  const post = vi.fn<PostDeps['post']>(async () => ({ id: '555555555555555555' }))
  const d: PostDeps = { channelId: async () => '999999999999999999', pingRoleId: async () => '', post, appUrl: () => 'https://app.test', ...o }
  return { d, post }
}

async function seedOpen(over: Record<string, any> = {}) {
  const { id } = await createProposal({ kind: 'FUNDING', title: 'Pizza party', body: 'b', amountUsdCents: 100000, eventDate: null, city: null, sponsorLabel: null, proposerDiscordId: 'p' })
  Object.assign(fake.current.state.proposal.find((r: any) => r.id === id), { status: 'OPEN', opensAt: t0, closesAt: new Date(t0.getTime() + 7 * DAY), ayesNeeded: 25, ...over })
  return id
}

beforeEach(() => {
  fake.current = makeFakeDb()
})

describe('Discord posts', () => {
  it('posts a new proposal once, with the vote link and no counts', async () => {
    const id = await seedOpen()
    const { d, post } = deps({ pingRoleId: async () => '777777777777777777' })
    expect(await announceOpen(id, d)).toBe('posted')
    expect(await announceOpen(id, d)).toBe('skipped')
    expect(post).toHaveBeenCalledTimes(1)
    const body = post.mock.calls[0][1]
    expect(body.content).toContain(`https://app.test/proposals/${id}`)
    expect(body.content).toContain('<@&777777777777777777>')
    expect(body.content).toContain('$1,000')
    expect(body.allowed_mentions).toEqual({ parse: [], roles: ['777777777777777777'] })
    expect(body.content).not.toMatch(/\b\d+ aye\b/)
    expect(fake.current.state.proposal[0]).toMatchObject({ discordChannelId: '999999999999999999', discordMessageId: '555555555555555555' })
  })

  it('never pings anyone but the configured role, even if the title tries', () => {
    const m = openMessage({ id: 'x', title: '@everyone <@&1>', kind: 'GENERAL', amountUsdCents: null, closesAt: t0, ayesNeeded: 15 }, 'https://a', '')
    expect(m.allowed_mentions).toEqual({ parse: [] })
  })

  it('posts nothing without a channel', async () => {
    const id = await seedOpen()
    const { d, post } = deps({ channelId: async () => null })
    expect(await announceOpen(id, d)).toBe('skipped')
    expect(post).not.toHaveBeenCalled()
  })

  it('releases the claim when Discord rejects the post, so the next run retries', async () => {
    const id = await seedOpen()
    const { d } = deps({ post: async () => { throw new DiscordPostError('nope', 403) } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await announceOpen(id, d)).toBe('failed')
    expect(fake.current.state.proposal[0].discordChannelId).toBeNull()
  })

  it('keeps the claim after an ambiguous failure (it may have posted)', async () => {
    const id = await seedOpen()
    const { d } = deps({ post: async () => { throw new DiscordPostError('boom', 502) } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await announceOpen(id, d)).toBe('failed')
    expect(fake.current.state.proposal[0].discordChannelId).toBe('999999999999999999')
  })

  it('the result post carries the counts and the verdict', () => {
    const m = resultMessage({ id: 'x', title: 'Pizza party', status: 'PASSED', ayes: 20, nays: 3, abstains: 5, ayesNeeded: 25 }, 'https://a')
    expect(m.content).toContain('passed')
    expect(m.content).toContain('20 aye, 3 nay, 5 abstain')
  })
})

describe('daily run', () => {
  it('closes due proposals, posts the result once, and leaves open ones alone', async () => {
    const due = await seedOpen({ closesAt: new Date(t0.getTime() - 1000) })
    const later = await seedOpen({ closesAt: new Date(t0.getTime() + 3 * DAY) })
    for (let i = 0; i < 30; i++) fake.current.state.ballot.push({ id: `b${i}`, proposalId: due, tokenHash: `h${i}`, choice: 'AYE' })
    const { d, post } = deps()
    const r = await runProposalsCron(t0, d)
    expect(r).toMatchObject({ settled: 1, resultPosts: 1 })
    const byId = (id: string) => fake.current.state.proposal.find((p: any) => p.id === id)
    expect(byId(due)).toMatchObject({ status: 'PASSED', ayes: 30 })
    expect(byId(later).status).toBe('OPEN')
    // the still-open one gets its (missed) announcement, without counts; the closed one gets only the result
    const contents = post.mock.calls.map((c) => c[1].content as string)
    expect(contents.some((c) => c.includes('Proposal passed'))).toBe(true)
    const opens = contents.filter((c) => c.includes('New proposal'))
    expect(opens).toHaveLength(1)
    expect(opens[0]).not.toMatch(/\d+ aye,/)
    // a second run changes nothing
    post.mockClear()
    expect(await runProposalsCron(t0, d)).toMatchObject({ settled: 0, resultPosts: 0, openPosts: 0 })
    expect(post).not.toHaveBeenCalled()
  })

  it('a proposal with too few votes fails at close', async () => {
    const id = await seedOpen({ closesAt: new Date(t0.getTime() - 1000) })
    for (let i = 0; i < 10; i++) fake.current.state.ballot.push({ id: `b${i}`, proposalId: id, tokenHash: `h${i}`, choice: 'AYE' })
    await runProposalsCron(t0, deps().d)
    expect(fake.current.state.proposal[0].status).toBe('FAILED')
  })
})
