// @vitest-environment node
// Ballot secrecy for proposal reminders: the reminder code never reads ballots or pending votes, and the
// per-member send rows are gone once the proposal is no longer open.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { discordId: string; kind: string; refKey: string; status: string }
const state = vi.hoisted(() => ({
  sends: [] as Array<{ discordId: string; kind: string; refKey: string; status: string }>,
  proposals: [] as Array<{ id: string; status: string }>,
  events: [] as Array<{ proposalId: string; type: string; data: unknown }>,
  voterWhere: null as unknown,
}))

const forbidden = (name: string) => () => {
  throw new Error(`reminders must never touch ${name}`)
}
vi.mock('@/app/lib/db', () => ({
  prisma: {
    proposalBallot: new Proxy({}, { get: (_t, k) => forbidden(`proposalBallot.${String(k)}`) }),
    reminderPref: { findMany: async () => [{ discordId: 'm1', proposalOpened: true, proposalClosing: true }] },
    proposal: {
      findMany: async (a: { where: { id?: { in: string[] } } }) => {
        const ids = a.where.id?.in
        return state.proposals.filter((p) => !ids || ids.includes(p.id)).map((p) => ({ ...p, title: 't', isTest: false, opensAt: null, closesAt: null, keyFingerprint: null }))
      },
    },
    proposalVoter: {
      findMany: async (a: { where: unknown; select: Record<string, boolean> }) => {
        state.voterWhere = a
        return [{ discordId: 'm1' }]
      },
    },
    $transaction: async function (this: unknown, fn: (tx: unknown) => unknown) {
      return fn(this)
    },
    proposalEvent: { findMany: async (a: { where: { proposalId: { in: string[] } } }) => state.events.filter((e) => a.where.proposalId.in.includes(e.proposalId)).map((e) => ({ proposalId: e.proposalId })), create: async (a: { data: { proposalId: string; type: string; data: unknown } }) => void state.events.push(a.data) },
    reminderSend: {
      findMany: async (a: { where: { refKey?: { in: string[] } } }) => {
        const ids = a.where.refKey?.in
        return state.sends.filter((r) => !ids || ids.includes(r.refKey))
      },
      deleteMany: async (a: { where: { refKey: { in: string[] } } }) => {
        const before = state.sends.length
        state.sends = state.sends.filter((r) => !a.where.refKey.in.includes(r.refKey))
        return { count: before - state.sends.length }
      },
    },
  },
}))

import { clearProposalReminders, clearSettledProposalReminders, prismaProposalStore } from './proposal-store'

const root = join(__dirname)
const src = (f: string) => readFileSync(join(root, f), 'utf8')

describe('static: the reminder code never reaches ballots or the pending store', () => {
  const files = ['proposals.ts', 'proposal-store.ts', 'cron.ts', 'messages.ts']
  it.each(files)('%s does not import or query ProposalBallot, pending votes or the pending store', (f) => {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/proposalBallot|ProposalBallot/)
    expect(code).not.toMatch(/proposals\/pending|PendingStore|pendingFor|defaultPendingStore/)
    expect(code).not.toMatch(/ballotBlob|tokenHash/)
    expect(code).not.toMatch(/proposals\/(store|token)['"]/)
  })

  it('the only per-member voter columns it selects are discordId (and the tokenIssuedAt filter)', () => {
    const code = src('proposal-store.ts')
    expect(code).toMatch(/proposalVoter\.findMany\(\{\s*where: \{ proposalId, \.\.\.\(noTokenOnly \? \{ tokenIssuedAt: null \} : \{\}\) \},\s*select: \{ discordId: true \}/)
  })
})

describe('database side', () => {
  beforeEach(() => {
    state.sends = []
    state.proposals = []
    state.events = []
  })

  it('closing voters are queried with tokenIssuedAt: null and only discordId is selected', async () => {
    expect(await prismaProposalStore.listVoters('p1', true)).toEqual(['m1'])
    expect(state.voterWhere).toEqual({ where: { proposalId: 'p1', tokenIssuedAt: null }, select: { discordId: true } })
    await prismaProposalStore.listVoters('p1', false)
    expect(state.voterWhere).toEqual({ where: { proposalId: 'p1' }, select: { discordId: true } })
  })

  it('listing prefs, proposals and voters works with a Prisma mock that throws on proposalBallot', async () => {
    state.proposals = [{ id: 'p1', status: 'OPEN' }]
    await expect(prismaProposalStore.listProposalPrefs()).resolves.toHaveLength(1)
    await expect(prismaProposalStore.listOpenProposals()).resolves.toHaveLength(1)
  })

  const send = (discordId: string, kind: string, refKey: string, status = 'SENT'): Row => ({ discordId, kind, refKey, status })

  it('send rows are gone after settle or cancel, leaving aggregate counts only', async () => {
    state.proposals = [{ id: 'done', status: 'PASSED' }, { id: 'live', status: 'OPEN' }, { id: 'gone', status: 'CANCELLED' }]
    state.sends = [
      send('m1', 'PROPOSAL_OPENED', 'done'),
      send('m2', 'PROPOSAL_OPENED', 'done'),
      send('m1', 'PROPOSAL_CLOSING', 'done'),
      send('m3', 'PROPOSAL_OPENED', 'done', 'SKIPPED'),
      send('m1', 'PROPOSAL_OPENED', 'live'),
      send('m1', 'PROPOSAL_OPENED', 'gone'),
    ]
    await clearProposalReminders('done')
    expect(state.sends.filter((r) => r.refKey === 'done')).toEqual([])
    expect(state.sends.filter((r) => r.refKey === 'live')).toHaveLength(1)
    expect(state.events).toEqual([{ proposalId: 'done', type: 'REMINDERS_SENT', actorDiscordId: null, data: { opened: 2, closing: 1 } }])

    // The cron sweep removes leftovers for every proposal that is not OPEN, and never an open one.
    expect(await clearSettledProposalReminders()).toBe(1)
    expect(state.sends.map((r) => r.refKey)).toEqual(['live'])
  })

  it('writes the aggregate event once even if rows reappear and are swept again', async () => {
    state.proposals = [{ id: 'done', status: 'PASSED' }]
    state.sends = [send('m1', 'PROPOSAL_OPENED', 'done')]
    await clearProposalReminders('done')
    state.sends = [send('m2', 'PROPOSAL_OPENED', 'done')]
    await clearProposalReminders('done')
    expect(state.events).toHaveLength(1)
    expect(state.sends).toEqual([])
  })

  it('a row for an OPEN proposal is never deleted, and the hook never throws', async () => {
    state.proposals = [{ id: 'live', status: 'OPEN' }]
    state.sends = [send('m1', 'PROPOSAL_OPENED', 'live')]
    await clearProposalReminders('live')
    expect(state.sends).toHaveLength(1)
    await expect(clearProposalReminders('whatever')).resolves.toBeUndefined()
  })
})
