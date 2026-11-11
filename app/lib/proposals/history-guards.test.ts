/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
// Imported history is a record: the cron never posts, opens, settles or drains it; it never funds a payment request.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/app/lib/db', () => ({ prisma: new Proxy({}, { get: (_t, k) => fake.current.db[k] }) }))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildRoles: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ hasRole: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => ''), loadSettings: vi.fn() }))
vi.mock('@/app/lib/settings/channels', () => ({ resolveConfiguredChannel: vi.fn(async () => '999999999999999999') }))

import { announceOpen, announceResult, type PostDeps } from './discord'
import { runProposalsCron } from './lifecycle'
import { checkProposalLink } from './payment-link'
import { openProposal, passedFundingProposalsFor } from './store'
import { makeFakeDb, testEnv } from './test-utils'
import { evaluateDecision } from '@/app/lib/payments/decide'
import { computeRuleFlags } from '@/app/lib/payments/rules'

const t0 = new Date('2026-11-04T12:00:00Z')

function deps() {
  const post = vi.fn<PostDeps['post']>(async () => ({ id: '555555555555555555' }))
  const d: PostDeps = { channelId: async () => '999999999999999999', pingRoleId: async () => '', post, appUrl: () => 'https://app.test' }
  return { d, post }
}

function seedImported(status: string, over: Record<string, any> = {}) {
  const row = {
    id: `i-${fake.current.state.proposal.length + 1}`, kind: 'FUNDING', status, source: 'IMPORTED', title: 'Synthetic past proposal', body: 'b',
    amountUsdCents: 50000, proposerDiscordId: 'p1', votesRecorded: true, ayes: 1, nays: 0, abstains: 0, resultPostedAt: null, discordChannelId: null,
    createdAt: new Date(0), closesAt: null, closedAt: t0, opensAt: t0, ...over,
  }
  fake.current.state.proposal.push(row)
  return row
}

beforeEach(() => {
  fake.current = makeFakeDb()
})

describe('cron ignores imported rows', () => {
  it('posts, opens and settles nothing for imported passed, failed, unresolved, even forced draft or open rows', async () => {
    for (const s of ['PASSED', 'FAILED', 'UNRESOLVED', 'CANCELLED']) seedImported(s)
    // The database CHECK forbids these; the code must still ignore them if one ever existed.
    seedImported('DRAFT', { createdAt: new Date(0) })
    seedImported('OPEN', { closesAt: new Date(t0.getTime() - 86400_000) })
    const { d, post } = deps()
    const out = await runProposalsCron(t0, d, { pending: null })
    expect(out).toEqual({ opened: 0, settled: 0, drained: 0, openPosts: 0, resultPosts: 0, stuckAlerted: 0 })
    expect(post).not.toHaveBeenCalled()
    expect(fake.current.state.proposal.every((r: any) => r.resultPostedAt === null && r.discordChannelId === null)).toBe(true)
  })

  it('announceOpen and announceResult skip an imported row', async () => {
    const a = seedImported('PASSED')
    const b = seedImported('OPEN')
    const { d, post } = deps()
    expect(await announceResult(a.id, t0, d)).toBe('skipped')
    expect(await announceOpen(b.id, d)).toBe('skipped')
    expect(post).not.toHaveBeenCalled()
  })

  it('openProposal refuses an imported row', async () => {
    const a = seedImported('DRAFT')
    const r = await openProposal(a.id, { now: t0, env: testEnv(), pending: null })
    expect(r).toEqual({ ok: false, code: 'not_draft' })
    expect(a.status).toBe('DRAFT')
  })
})

describe('the payment picker, link and approval', () => {
  it('passedFundingProposalsFor leaves imported rows out', async () => {
    seedImported('PASSED', { proposerDiscordId: 'me' })
    fake.current.state.proposal.push({ id: 'app1', kind: 'FUNDING', status: 'PASSED', source: 'APP', isTest: false, proposerDiscordId: 'me', amountUsdCents: 1000, title: 't', closedAt: t0 })
    fake.current.db.proposal.findMany = async ({ where }: any) => fake.current.state.proposal.filter((r: any) => Object.entries(where).every(([k, v]) => (k === 'OR' ? (v as any[]).some((o) => Object.entries(o).every(([kk, vv]) => r[kk] === vv)) : typeof v === 'object' && v && 'not' in (v as any) ? r[k] !== (v as any).not : r[k] === v)))
    const out = await passedFundingProposalsFor('me')
    expect(out.map((x) => x.id)).toEqual(['app1'])
  })

  it('checkProposalLink rejects an imported proposal', () => {
    const input = { proposalId: 'x', requesterDiscordId: 'me', amountUsdCents: 1000, capUsdCents: 500 }
    const p = { kind: 'FUNDING', status: 'PASSED', proposerDiscordId: 'me', amountUsdCents: 5000 }
    expect(checkProposalLink(input, p, 0)).toBeNull()
    expect(checkProposalLink(input, { ...p, source: 'IMPORTED' }, 0)).toBe('proposal_invalid')
    expect(checkProposalLink(input, { ...p, source: 'IMPORTED', proposerDiscordId: null }, 0)).toBe('proposal_invalid')
  })

  it('rule flags do not treat an imported passed proposal as a vote', () => {
    const base: any = {
      now: t0, policy: { onApprovalCapUsd: 625 } as any, newAccountDays: 30,
      req: { source: 'APP', kind: 'EVENT_BUDGET', amountUsdCents: 100_000, currency: 'USD', eventDate: null, createdAt: t0, rsvEventSlug: null, title: 't', proposalUrl: null, requesterDiscordId: 'me', requesterMemberId: 'M', proposalsOn: true, proposal: { status: 'PASSED', amountUsdCents: 100_000 } },
      attachments: [], reusedAttachment: false, sharedPayee: false, sharedPayeeFormRow: false, repeatFormPayee: false, priorFraud: false,
      claimedFraudHint: false, restrictedMatches: [], restrictedCheckFailed: false, restrictedCheckOff: false, hashConfigured: true, rsvFlagged: false, newAccount: false, siblings: [],
    }
    const ids = (c: any) => computeRuleFlags(c).map((f: any) => f.id)
    expect(ids(base)).not.toContain('over_cap_no_vote')
    base.req = { ...base.req, proposal: { status: 'PASSED', amountUsdCents: 100_000, source: 'IMPORTED' } }
    expect(ids(base)).toContain('over_cap_no_vote')
    void evaluateDecision
  })
})
