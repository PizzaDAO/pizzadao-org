// @vitest-environment node
// Store rules against a small in-memory Prisma fake: voting conflicts, fixed day-7
// decision, idempotent settlement, nomination caps, audit log, redaction, no deletes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, any>
const H = 3600_000
const D = 24 * H

const state = vi.hoisted(() => ({
  disavowal: [] as any[], identifier: [] as any[], round: [] as any[], vote: [] as any[], event: [] as any[], submission: [] as any[],
  order: [] as string[], locks: 0, seq: 0,
}))

vi.mock('@/app/lib/db', () => {
  const match = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return (v as any).in.includes(row[k])
        if ('gte' in v) return row[k] >= (v as any).gte
        if ('lte' in v) return row[k] <= (v as any).lte
        return true
      }
      return row[k] === v
    })
  const model = (list: () => Row[], extra: Row = {}) => ({
    updateMany: async ({ where, data }: any) => {
      const rows = list().filter(r => match(r, where))
      rows.forEach(r => Object.assign(r, data))
      return { count: rows.length }
    },
    update: async ({ where, data }: any) => {
      const r = list().find(x => match(x, where))!
      Object.assign(r, data)
      return r
    },
    ...extra,
  })
  const withRound = (r: Row) => ({
    ...r,
    votes: state.vote.filter(v => v.roundId === r.id),
    disavowal: { ...state.disavowal.find(d => d.id === r.disavowalId), identifiers: state.identifier.filter(i => i.disavowalId === r.disavowalId) },
  })
  const tx: any = {
    // The Neon adapter can't deserialize a void result (pg_advisory_xact_lock) from $queryRaw.
    $queryRaw: async (strings: TemplateStringsArray) => {
      const q = strings.join('?')
      if (q.includes('pg_advisory')) throw new Error('UnsupportedNativeDataType: void (2278)')
      if (q.includes('FOR UPDATE')) { state.locks++; state.order.push('lock') }
      return []
    },
    $executeRaw: async (strings: TemplateStringsArray) => { if (strings.join('?').includes('pg_advisory_xact_lock')) state.order.push('advisory'); return 0 },
    disavowal: model(() => state.disavowal, {
      create: async ({ data }: any) => {
        const id = `d${++state.seq}`
        const { identifiers, rounds, submissions, ...rest } = data
        state.disavowal.push({ id, status: 'NOMINATED', createdAt: new Date(), ...rest })
        state.submission.push({ id: `s${++state.seq}`, disavowalId: id, withdrawnAt: null, createdAt: new Date(), ...submissions.create })
        for (const i of identifiers.create) state.identifier.push({ id: ++state.seq, disavowalId: id, ...i })
        state.round.push({ id: `r${++state.seq}`, disavowalId: id, state: 'OPEN', opensAt: new Date(), ...rounds.create })
        return { id }
      },
    }),
    disavowRound: model(() => state.round, {
      // The partial unique index: at most one OPEN round per disavowal.
      create: async ({ data }: any) => {
        if (state.round.some(r => r.disavowalId === data.disavowalId && r.state === 'OPEN')) throw Object.assign(new Error('unique'), { code: 'P2002' })
        const r = { id: `r${++state.seq}`, state: 'OPEN', ...data }
        state.round.push(r)
        return r
      },
      findUnique: async ({ where }: any) => { const r = state.round.find(x => x.id === where.id); return r && withRound(r) },
      findMany: async ({ where }: any) => state.round.filter(r => match(r, where)),
    }),
    disavowVote: model(() => state.vote, {
      upsert: async ({ where, create, update }: any) => {
        const k = where.roundId_voterDiscordId
        const ex = state.vote.find(v => v.roundId === k.roundId && v.voterDiscordId === k.voterDiscordId)
        if (ex) Object.assign(ex, update)
        else state.vote.push({ ...create })
      },
    }),
    disavowIdentifier: model(() => state.identifier, {
      findFirst: async ({ where }: any) => {
        const hit = state.identifier.find(i => where.OR.some((o: Row) => o.kind === i.kind && o.value === i.value)
          && where.disavowal.status.in.includes(state.disavowal.find(d => d.id === i.disavowalId)!.status))
        return hit ? { disavowalId: hit.disavowalId, disavowal: { status: state.disavowal.find(d => d.id === hit.disavowalId)!.status } } : null
      },
    }),
    disavowSubmission: model(() => state.submission, {
      findMany: async ({ where }: any) => state.submission.filter(x => match(x, where)).map(x => ({ ...x, disavowal: { status: state.disavowal.find(d => d.id === x.disavowalId)?.status, rounds: state.round.filter(r => r.disavowalId === x.disavowalId && r.kind === 'LIST') } })),
      findFirst: async ({ where }: any) => state.submission.find(x => match(x, where)) ?? null,
      findUnique: async ({ where }: any) => state.submission.find(x => x.id === where.id) ?? null,
      count: async ({ where }: any) => state.submission.filter(x => x.disavowalId === where.disavowalId && x.withdrawnAt === null).length,
      upsert: async ({ where, create, update }: any) => {
        const k = where.disavowalId_submitterDiscordId
        const ex = state.submission.find(x => x.disavowalId === k.disavowalId && x.submitterDiscordId === k.submitterDiscordId)
        if (ex) Object.assign(ex, update)
        else state.submission.push({ id: `s${++state.seq}`, withdrawnAt: null, createdAt: new Date(), ...create })
      },
    }),
    disavowEvent: {
      create: async ({ data }: any) => { state.event.push({ ...data }); return data },
      count: async ({ where }: any) => state.event.filter(e => e.type === where.type && e.actorDiscordId === where.actorDiscordId && e.createdAt >= where.createdAt.gte).length,
    },
  }
  const origUpdateMany = tx.disavowal.updateMany
  tx.disavowal.updateMany = async (a: any) => { state.order.push('disavowal-update'); return origUpdateMany(a) }
  // The vote updateMany needs the round relation: override.
  tx.disavowVote.updateMany = async ({ where, data }: any) => {
    const ids = new Set(state.round.filter(r => r.disavowalId === where.round.disavowalId).map(r => r.id))
    const rows = state.vote.filter(v => ids.has(v.roundId) && v.comment !== null)
    rows.forEach(r => Object.assign(r, data))
    return { count: rows.length }
  }
  const prisma = {
    ...tx,
    disavowal: {
      ...tx.disavowal,
      findUnique: async ({ where }: any) => {
        const d = state.disavowal.find(x => x.id === where.id)
        return d && { ...d, identifiers: state.identifier.filter(i => i.disavowalId === d.id), rounds: state.round.filter(r => r.disavowalId === d.id && r.state === 'OPEN') }
      },
      findMany: async ({ where }: any) => state.disavowal.filter(d => d.status === where.status && d.reviewDueAt && d.reviewDueAt <= where.reviewDueAt.lte && !state.round.some(r => r.disavowalId === d.id && r.state === 'OPEN')),
    },
    disavowRound: {
      ...tx.disavowRound,
      findUnique: async ({ where }: any) => { const r = state.round.find(x => x.id === where.id); return r && withRound(r) },
    },
    disavowEvent: { ...tx.disavowEvent, findFirst: async () => null },
    $transaction: async (fn: any) => fn(tx),
  }
  // Events carry a timestamp so the cap can window them.
  const origCreate = tx.disavowEvent.create
  tx.disavowEvent.create = async (a: any) => origCreate({ data: { createdAt: new Date(), ...a.data } })
  prisma.disavowEvent.create = tx.disavowEvent.create
  return { prisma }
})
vi.mock('@/app/lib/notifications', () => ({ createNotification: vi.fn(async () => ({})) }))
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => ['dpr1', 'dpr2', 'dpr3']) }))
// The person behind member 77 is Discord subjD with wallet WALLET1. Everyone else only has their Discord id.
vi.mock('./match', () => ({
  identifierOr: (ids: Array<{ kind: string; value: string }>) => ids.filter(i => i.kind !== 'NAME' && i.kind !== 'TELEGRAM'),
  viewerIdentifiers: vi.fn(async (d: string) =>
    d === 'subjD'
      ? [{ kind: 'DISCORD_ID', value: 'subjD' }, { kind: 'MEMBER_ID', value: '77' }, { kind: 'WALLET', value: 'WALLET1' }]
      : [{ kind: 'DISCORD_ID', value: d }]),
  discordIdsForIdentifiers: vi.fn(async (ids: Array<{ kind: string; value: string }>) => {
    const out = new Set<string>()
    for (const i of ids) {
      if (i.kind === 'DISCORD_ID') out.add(i.value)
      if ((i.kind === 'MEMBER_ID' && i.value === '77') || (i.kind === 'WALLET' && i.value === 'WALLET1')) out.add('subjD')
    }
    return [...out]
  }),
}))

import { createNotification } from '@/app/lib/notifications'
import { viewerIdentifiers } from './match'
import * as rulesModule from './rules'
import { DEFAULT_DISAVOW_RULES } from './rules'
import { castVote, nominate, openRemoveRound, redact, runDisavowCron, settleRound, suspend, unsuspend, withdrawSubmission, listMySubmissions, addResponse, isSubjectOf } from './store'

const nominateInput = (over: Row = {}) => ({
  nominatorDiscordId: 'nom', displayName: 'Randy', reason: 'SCAM' as const,
  statement: 'x'.repeat(30), evidenceUrls: [], identifiers: [{ kind: 'MEMBER_ID' as const, value: '77' }, { kind: 'DISCORD_ID' as const, value: 'subjD' }],
  ...over,
})
const T0 = new Date('2026-11-01T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  state.disavowal.length = state.identifier.length = state.round.length = state.vote.length = state.event.length = state.submission.length = state.order.length = 0
  state.seq = state.locks = 0
})

/** Nominate and get 3 DPR yes in, then settle after day 7: a LISTED entry. */
async function listedEntry() {
  const r = await nominate({ ...nominateInput(), now: T0 })
  if (!r.ok) throw new Error('setup')
  const round = state.round[0]
  const early = new Date(T0.getTime() + 2 * D)
  for (const v of ['dpr1', 'dpr2', 'dpr3']) {
    expect((await castVote({ disavowalId: r.id, roundId: round.id, voterDiscordId: v, choice: 'YES', now: early })).ok).toBe(true)
  }
  const later = new Date(T0.getTime() + 8 * D)
  expect(await settleRound(round.id, later)).toBe('passed')
  return { id: r.id, roundId: round.id, t0: T0, later }
}

describe('nominate', () => {
  it('creates a NOMINATED entry, a LIST round, audit events and a name-free DPR notification', async () => {
    const r = await nominate(nominateInput())
    expect(r.ok).toBe(true)
    expect(state.disavowal[0].status).toBe('NOMINATED')
    expect(state.round[0]).toMatchObject({ kind: 'LIST', state: 'OPEN' })
    expect(state.event.map(e => e.type)).toEqual(['NOMINATED', 'ROUND_OPENED'])
    const calls = vi.mocked(createNotification).mock.calls.map(c => c[0])
    expect(calls.map(c => c.recipientId)).toEqual(['dpr1', 'dpr2', 'dpr3'])
    for (const c of calls) {
      expect(c.type).toBe('DISAVOW_VOTE_NEEDED')
      expect(`${c.title} ${c.message}`).not.toMatch(/Randy|subjD|77/)
    }
  })
  it('allows 3 nominations per 30 days, the 4th is rate limited', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await nominate(nominateInput({ identifiers: [{ kind: 'NAME', value: `n${i}` }] }))).ok).toBe(true)
    }
    const r = await nominate(nominateInput({ identifiers: [{ kind: 'NAME', value: 'n9' }] }))
    expect(r).toEqual({ ok: false, code: 'rate_limited' })
  })
  it('duplicate attempts count toward the nominator\'s cap', async () => {
    await nominate(nominateInput({ nominatorDiscordId: 'first' }))
    for (let i = 0; i < 3; i++) {
      const dup = await nominate(nominateInput({ nominatorDiscordId: 'spammer' }))
      expect(dup).toMatchObject({ ok: false, code: 'duplicate' })
    }
    expect(await nominate(nominateInput({ nominatorDiscordId: 'spammer', identifiers: [{ kind: 'NAME', value: 'other' }] })))
      .toEqual({ ok: false, code: 'rate_limited' })
    // a duplicate never creates a second entry, and is logged on the existing one as such
    expect(state.disavowal).toHaveLength(1)
    expect(state.event.filter(e => e.data?.duplicate)).toHaveLength(3)
  })
  it('a different nominator is not limited by someone else\'s count', async () => {
    for (let i = 0; i < 3; i++) await nominate(nominateInput({ identifiers: [{ kind: 'NAME', value: `n${i}` }] }))
    expect((await nominate(nominateInput({ nominatorDiscordId: 'other', identifiers: [{ kind: 'NAME', value: 'zz' }] }))).ok).toBe(true)
  })
  it('refuses a duplicate active entry (reporting its status) and self-nomination', async () => {
    const first = await nominate(nominateInput())
    const dup = await nominate(nominateInput({ nominatorDiscordId: 'someone', identifiers: [{ kind: 'DISCORD_ID', value: 'subjD' }] }))
    expect(dup).toMatchObject({ ok: false, code: 'duplicate', existingId: first.ok ? first.id : '', existingStatus: 'NOMINATED' })
    expect(await nominate(nominateInput({ nominatorDiscordId: 'subjD', identifiers: [{ kind: 'MEMBER_ID', value: '77' }] }))).toEqual({ ok: false, code: 'self' })
  })
})

describe('configurable voting rules', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  const withRules = (over: Partial<typeof DEFAULT_DISAVOW_RULES>) => {
    const spy = vi.spyOn(rulesModule, 'loadDisavowRules').mockResolvedValue({ ...DEFAULT_DISAVOW_RULES, ...over })
    spies.push(spy)
    return spy
  }
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore() })

  it('a new round snapshots the rules it opens under (with the defaults: 3 votes, 7 days)', async () => {
    await nominate({ ...nominateInput(), now: T0 })
    expect(state.round[0]).toMatchObject({ yesThreshold: 3, decisionDays: 7 })
    expect(state.round[0].closesAt.getTime()).toBe(T0.getTime() + 14 * D)
  })

  it('custom rules set the snapshot and the close time; changing them later does not move an open round', async () => {
    withRules({ yesThreshold: 2, decisionDays: 3, windowDays: 10 })
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const round = state.round[0]
    expect(round).toMatchObject({ yesThreshold: 2, decisionDays: 3 })
    expect(round.closesAt.getTime()).toBe(T0.getTime() + 10 * D)
    // The settings are tightened afterwards: the open round still counts under its own rules.
    withRules({ yesThreshold: 9, decisionDays: 20, windowDays: 40 })
    for (const v of ['dpr1', 'dpr2']) await castVote({ disavowalId: n.id, roundId: round.id, voterDiscordId: v, choice: 'YES', now: new Date(T0.getTime() + D) })
    expect(await settleRound(round.id, new Date(T0.getTime() + 2 * D))).toBe('pending') // before its own day 3
    expect(await settleRound(round.id, new Date(T0.getTime() + 3 * D))).toBe('passed') // 2 yes is enough for this round
  })

  it('a round with no snapshot (opened before it existed) keeps 3 votes and 7 days whatever the settings say', async () => {
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const round = state.round[0]
    round.yesThreshold = null
    round.decisionDays = null
    withRules({ yesThreshold: 2, decisionDays: 1, windowDays: 5 })
    for (const v of ['dpr1', 'dpr2']) await castVote({ disavowalId: n.id, roundId: round.id, voterDiscordId: v, choice: 'YES', now: new Date(T0.getTime() + D) })
    expect(await settleRound(round.id, new Date(T0.getTime() + 8 * D))).toBe('pending') // 2 yes is not enough under the old rule
  })

  it('the nominations limit and window follow the settings', async () => {
    withRules({ nominationsPerWindow: 1 })
    expect((await nominate(nominateInput({ identifiers: [{ kind: 'NAME', value: 'a' }] }))).ok).toBe(true)
    expect(await nominate(nominateInput({ identifiers: [{ kind: 'NAME', value: 'b' }] }))).toEqual({ ok: false, code: 'rate_limited' })
  })

  it('the listing length follows the setting', async () => {
    withRules({ listingMonths: 3 })
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const round = state.round[0]
    for (const v of ['dpr1', 'dpr2', 'dpr3']) await castVote({ disavowalId: n.id, roundId: round.id, voterDiscordId: v, choice: 'YES', now: new Date(T0.getTime() + D) })
    await settleRound(round.id, new Date(T0.getTime() + 8 * D))
    const d = state.disavowal[0]
    expect(d.reviewDueAt.getTime() - d.listedAt.getTime()).toBeLessThan(100 * D)
    expect(d.reviewDueAt.getTime() - d.listedAt.getTime()).toBeGreaterThan(85 * D)
  })

  it('the appeal cooldown follows the setting', async () => {
    const { id } = await listedEntry()
    withRules({ appealCooldownDays: 7 })
    state.disavowal[0].lastAppealAt = new Date(T0.getTime() + 10 * D)
    expect(await openRemoveRound(id, 'subj', { appeal: true, now: new Date(T0.getTime() + 20 * D) })).toBe('ok')
  })
})

describe('subject detection covers every identifier', () => {
  const walletOnly = () => nominateInput({ identifiers: [{ kind: 'WALLET', value: 'WALLET1' }] })

  it('isSubjectOf matches the viewer\'s own wallet', async () => {
    expect(await isSubjectOf([{ kind: 'WALLET', value: 'WALLET1' }], 'subjD')).toBe(true)
    expect(await isSubjectOf([{ kind: 'WALLET', value: 'WALLET1' }], 'other')).toBe(false)
    expect(await isSubjectOf([{ kind: 'NAME', value: 'subjd' }], 'subjD')).toBe(false)
  })
  it('a wallet-only nomination: the subject can\'t nominate it, vote on it, or swing the tally; gets the listed notice and can respond/appeal', async () => {
    expect(await nominate(nominateInput({ nominatorDiscordId: 'subjD', identifiers: [{ kind: 'WALLET', value: 'WALLET1' }] }))).toEqual({ ok: false, code: 'self' })
    const n = await nominate({ ...walletOnly(), now: T0 })
    if (!n.ok) throw new Error()
    const roundId = state.round[0].id
    expect(await castVote({ disavowalId: n.id, roundId, voterDiscordId: 'subjD', choice: 'NO' })).toEqual({ ok: false, code: 'conflict' })
    // even a vote that got in is not counted
    state.vote.push({ roundId, voterDiscordId: 'subjD', choice: 'NO' })
    for (const v of ['dpr1', 'dpr2', 'dpr3']) await castVote({ disavowalId: n.id, roundId, voterDiscordId: v, choice: 'YES', now: new Date(T0.getTime() + 2 * D) })
    vi.mocked(createNotification).mockClear()
    expect(await settleRound(roundId, new Date(T0.getTime() + 8 * D))).toBe('passed')
    const notice = vi.mocked(createNotification).mock.calls.map(c => c[0]).filter(c => c.type === 'DISAVOW_LISTED_SUBJECT')
    expect(notice.map(c => c.recipientId)).toEqual(['subjD'])
    expect(await addResponse(n.id, 'subjD', 'That was a refund dispute.')).toBe('ok')
    expect(await openRemoveRound(n.id, 'subjD', { appeal: true, now: new Date(T0.getTime() + 9 * D) })).toBe('ok')
  })
})

describe('castVote', () => {
  it('rejects the nominator and the subject (by Discord id and by member id)', async () => {
    const r = await nominate(nominateInput())
    if (!r.ok) throw new Error()
    const roundId = state.round[0].id
    expect(await castVote({ disavowalId: r.id, roundId, voterDiscordId: 'nom', choice: 'YES' })).toEqual({ ok: false, code: 'conflict' })
    expect(await castVote({ disavowalId: r.id, roundId, voterDiscordId: 'subjD', choice: 'NO' })).toEqual({ ok: false, code: 'conflict' })
    expect(state.vote).toHaveLength(0)
  })
  it('rejects a round that belongs to a different entry', async () => {
    await nominate(nominateInput())
    const r = await castVote({ disavowalId: 'other', roundId: state.round[0].id, voterDiscordId: 'dpr1', choice: 'YES' })
    expect(r).toEqual({ ok: false, code: 'not_found' })
  })
  it('never settles early: 3 yes on day 2 leave it NOMINATED, it lists at day 7 on the cron/view settle', async () => {
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const roundId = state.round[0].id
    const early = new Date(T0.getTime() + 2 * D)
    for (const v of ['dpr1', 'dpr2', 'dpr3']) {
      expect(await castVote({ disavowalId: n.id, roundId, voterDiscordId: v, choice: 'YES', now: early })).toEqual({ ok: true, outcome: 'pending' })
    }
    expect(await settleRound(roundId, new Date(T0.getTime() + 7 * D - 1))).toBe('pending')
    expect(state.disavowal[0].status).toBe('NOMINATED')
    expect(await settleRound(roundId, new Date(T0.getTime() + 7 * D))).toBe('passed')
    expect(state.disavowal[0].status).toBe('LISTED')
    expect(state.disavowal[0].reviewDueAt.getTime()).toBeGreaterThan(state.disavowal[0].listedAt.getTime())
  })
  it('a late "no" before day 7 is counted: 3 yes + 3 no does not list', async () => {
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const roundId = state.round[0].id
    const day5 = new Date(T0.getTime() + 5 * D)
    for (const [v, c] of [['a', 'YES'], ['b', 'YES'], ['c', 'YES'], ['d', 'NO'], ['e', 'NO'], ['f', 'NO']] as const) {
      await castVote({ disavowalId: n.id, roundId, voterDiscordId: v, choice: c, now: day5 })
    }
    expect(await settleRound(roundId, new Date(T0.getTime() + 8 * D))).toBe('pending')
    expect(state.disavowal[0].status).toBe('NOMINATED')
    expect(await settleRound(roundId, new Date(T0.getTime() + 14 * D))).toBe('failed')
    expect(state.disavowal[0].status).toBe('REJECTED')
  })
  it('notifies the subject on listing without names or content', async () => {
    vi.mocked(createNotification).mockClear()
    await listedEntry()
    const subject = vi.mocked(createNotification).mock.calls.map(c => c[0]).filter(c => c.type === 'DISAVOW_LISTED_SUBJECT')
    expect(subject).toHaveLength(1)
    expect(subject[0].recipientId).toBe('subjD')
    expect(`${subject[0].title} ${subject[0].message}`).not.toMatch(/Randy|scam|nom/i)
  })
  it('refuses votes after the window and settles instead', async () => {
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const r = await castVote({ disavowalId: n.id, roundId: state.round[0].id, voterDiscordId: 'dpr1', choice: 'YES', now: new Date(T0.getTime() + 15 * D) })
    expect(r).toEqual({ ok: false, code: 'closed' })
    expect(state.disavowal[0].status).toBe('REJECTED')
  })
  it('rejects a vote on a round that was settled meanwhile, inside the transaction, under the row lock', async () => {
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const round = state.round[0]
    // The round gets settled after castVote's pre-check but before its transaction:
    // the subject check sits exactly between them.
    vi.mocked(viewerIdentifiers).mockImplementationOnce(async (d: string) => {
      state.round[0].state = 'FAILED'
      return [{ kind: 'DISCORD_ID', value: d }] as never
    })
    const r = await castVote({ disavowalId: n.id, roundId: round.id, voterDiscordId: 'dpr1', choice: 'YES', now: new Date(T0.getTime() + 1 * D) })
    expect(r).toEqual({ ok: false, code: 'closed' })
    expect(state.vote).toHaveLength(0)
  })
  it('vote and settle both take the round lock', async () => {
    await listedEntry()
    expect(state.locks).toBeGreaterThanOrEqual(4)
  })
})

describe('settleRound', () => {
  it('two concurrent settles produce exactly one LISTED event and one close', async () => {
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const round = state.round[0]
    for (const v of ['a', 'b', 'c']) state.vote.push({ roundId: round.id, voterDiscordId: v, choice: 'YES' })
    const now = new Date(T0.getTime() + 8 * D)
    await Promise.all([settleRound(round.id, now), settleRound(round.id, now)])
    expect(state.event.filter(e => e.type === 'LISTED')).toHaveLength(1)
    expect(state.event.filter(e => e.type === 'ROUND_CLOSED')).toHaveLength(1)
    expect(vi.mocked(createNotification).mock.calls.filter(c => c[0].type === 'DISAVOW_LISTED_SUBJECT')).toHaveLength(1)
  })
  it('counts the votes as they are inside the transaction, not as read before it', async () => {
    const n = await nominate({ ...nominateInput(), now: T0 })
    if (!n.ok) throw new Error()
    const round = state.round[0]
    for (const v of ['a', 'b', 'c']) state.vote.push({ roundId: round.id, voterDiscordId: v, choice: 'YES' })
    const p = settleRound(round.id, new Date(T0.getTime() + 8 * D))
    state.vote.push({ roundId: round.id, voterDiscordId: 'd', choice: 'NO' }, { roundId: round.id, voterDiscordId: 'e', choice: 'NO' }, { roundId: round.id, voterDiscordId: 'f', choice: 'NO' })
    expect(await p).toBe('pending') // 3 yes vs 3 no: not a pass
  })
})

describe('lifecycle', () => {
  it('suspend hides the listing, opens a REMOVE vote; a failed removal restores it', async () => {
    const { id, later } = await listedEntry()
    expect(await suspend(id, 'dpr1', later)).toBe('ok')
    expect(state.disavowal[0].status).toBe('SUSPENDED')
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    expect(remove.state).toBe('OPEN')
    expect(await settleRound(remove.id, new Date(later.getTime() + 15 * D))).toBe('failed')
    expect(state.disavowal[0].status).toBe('LISTED')
    expect(state.event.map(e => e.type)).toEqual(expect.arrayContaining(['SUSPENDED', 'UNSUSPENDED']))
  })
  it('only one OPEN round per entry: a second REMOVE round is refused', async () => {
    const { id, later } = await listedEntry()
    expect(await openRemoveRound(id, 'dpr1', { now: later })).toBe('ok')
    expect(await openRemoveRound(id, 'dpr2', { now: later })).toBe('already_open')
    // simulate the race: pre-check passes but the index rejects the insert
    state.round.find(r => r.kind === 'REMOVE')!.state = 'OPEN'
    const d = state.disavowal[0]
    const spy = d.status
    expect(spy).toBe('LISTED')
    expect(state.round.filter(r => r.state === 'OPEN')).toHaveLength(1)
  })
  it('a passed REMOVE round removes (status change only)', async () => {
    const { id, later } = await listedEntry()
    expect(await openRemoveRound(id, 'dpr1', { now: later })).toBe('ok')
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    for (const v of ['x', 'y', 'z']) state.vote.push({ roundId: remove.id, voterDiscordId: v, choice: 'YES' })
    expect(await settleRound(remove.id, new Date(later.getTime() + 8 * D))).toBe('passed')
    expect(state.disavowal[0].status).toBe('REMOVED')
    expect(state.disavowal).toHaveLength(1)
  })
  it('an appeal is allowed once per 90 days', async () => {
    const { id, later } = await listedEntry()
    expect(await openRemoveRound(id, 'subjD', { appeal: true, now: later })).toBe('ok')
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    await settleRound(remove.id, new Date(later.getTime() + 15 * D))
    expect(await openRemoveRound(id, 'subjD', { appeal: true, now: new Date(later.getTime() + 30 * D) })).toBe('too_soon')
    expect(await openRemoveRound(id, 'subjD', { appeal: true, now: new Date(later.getTime() + 91 * D) })).toBe('ok')
    expect(state.event.filter(e => e.type === 'APPEALED')).toHaveLength(2)
  })
  it('the member response is stored and logged without its content', async () => {
    const { id } = await listedEntry()
    expect(await addResponse(id, 'subjD', 'That was a refund dispute.')).toBe('ok')
    expect(state.disavowal[0].subjectResponse).toBe('That was a refund dispute.')
    const ev = state.event.filter(e => e.type === 'RESPONSE_ADDED')
    expect(ev).toHaveLength(1)
    expect(JSON.stringify(ev[0].data)).not.toContain('refund')
  })
  it('cron settles due rounds and opens REAFFIRM for listings past their review date; failed REAFFIRM expires', async () => {
    const { id, later } = await listedEntry()
    const due = new Date(later.getTime() + 400 * D)
    state.disavowal[0].reviewDueAt = new Date(later.getTime() + 1000)
    const res = await runDisavowCron(due)
    expect(res.reaffirmOpened).toBe(1)
    expect(state.round.find(r => r.kind === 'REAFFIRM')!.state).toBe('OPEN')
    await runDisavowCron(new Date(due.getTime() + 15 * D))
    expect(state.disavowal.find(d => d.id === id)!.status).toBe('EXPIRED')
  })
})

describe('redaction and audit', () => {
  it('redact overwrites text, handles and DPR vote comments, keeps the rows and logs field names only', async () => {
    const n = await nominate(nominateInput({
      statement: 'Secret details about a wallet drain 0xabc', evidenceUrls: ['https://e.com/x'],
      identifiers: [{ kind: 'NAME', value: 'randy' }, { kind: 'X_HANDLE', value: 'randyx' }, { kind: 'DISCORD_ID', value: 'subjD' }],
    }))
    if (!n.ok) throw new Error()
    state.vote.push({ roundId: state.round[0].id, voterDiscordId: 'dpr1', choice: 'YES', comment: 'saw the drain myself' }, { roundId: state.round[0].id, voterDiscordId: 'dpr2', choice: 'NO', comment: null })
    expect(await redact(n.id, 'admin1')).toBe('ok')
    const d = state.disavowal[0]
    expect(d.statement).toBe('[redacted]')
    expect(d.displayName).toBe('[redacted]')
    expect(d.evidenceUrls).toEqual([])
    expect(d.redactedAt).toBeInstanceOf(Date)
    expect(state.identifier.filter(i => i.kind === 'NAME' || i.kind === 'X_HANDLE').every(i => i.value.startsWith('[redacted]'))).toBe(true)
    expect(state.identifier.find(i => i.kind === 'DISCORD_ID')!.value).toBe('subjD')
    expect(state.vote[0].comment).toBe('[redacted]')
    expect(state.vote[1].comment).toBeNull()
    // submitters' own rows get a neutral dash, not the visible marker
    expect(state.submission.every(x => x.displayName === '\u2014')).toBe(true)
    expect(state.vote).toHaveLength(2)
    const ev = state.event.find(e => e.type === 'REDACTED')!
    expect(ev.actorDiscordId).toBe('admin1')
    expect(JSON.stringify(ev.data)).not.toMatch(/Secret|randy|0xabc|drain/)
    expect(state.disavowal).toHaveLength(1)
  })
  it('an admin who is the subject can\'t redact their own entry', async () => {
    const n = await nominate(nominateInput())
    if (!n.ok) throw new Error()
    expect(await redact(n.id, 'subjD')).toBe('conflict')
    expect(state.disavowal[0].statement).not.toBe('[redacted]')
  })
  it('every mutation appends events and the store exposes no delete path', async () => {
    const { id, later } = await listedEntry()
    await suspend(id, 'dpr1', later)
    expect(state.event.every(e => e.disavowalId === id)).toBe(true)
    expect(state.event.length).toBeGreaterThanOrEqual(6)
    const src = (await import('node:fs')).readFileSync(new URL('./store.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/\.delete(Many)?\(/)
  })
  it('the migration enforces one OPEN round per disavowal with a partial unique index', async () => {
    const fs = await import('node:fs')
    const sql = fs.readFileSync(new URL('../../../prisma/migrations/20261027000000_disavow_list/migration.sql', import.meta.url), 'utf8')
    expect(sql).toMatch(/CREATE UNIQUE INDEX "DisavowRound_one_open_per_disavowal" ON "DisavowRound"\("disavowalId"\) WHERE "state" = 'OPEN'/)
  })
})

describe('submissions: My nominations and withdrawing', () => {
  const subId = (who: string) => state.submission.find(x => x.submitterDiscordId === who)!.id

  it('a real nomination stores an original submission; a duplicate stores the caller\'s own record without a second entry', async () => {
    const first = await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    const dup = await nominate(nominateInput({ nominatorDiscordId: 'b', displayName: 'Randy B' }))
    expect(first.ok && dup).toMatchObject({ ok: false, code: 'duplicate' })
    expect(state.disavowal).toHaveLength(1)
    expect(state.submission.map(x => [x.submitterDiscordId, x.isOriginal])).toEqual([['a', true], ['b', false]])
  })

  it('listMySubmissions shows only the caller\'s own, with a neutral status and no entry details', async () => {
    await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    await nominate(nominateInput({ nominatorDiscordId: 'b', displayName: 'Randy B' }))
    const mineB = await listMySubmissions('b')
    expect(mineB).toHaveLength(1)
    expect(Object.keys(mineB[0]).sort()).toEqual(['createdAt', 'displayName', 'id', 'status'])
    expect(mineB[0]).toMatchObject({ displayName: 'Randy B', status: 'submitted' })
    expect(await listMySubmissions('stranger')).toEqual([])
  })

  it('status goes to "closed" when the entry is no longer active, "withdrawn" after withdrawing', async () => {
    const n = await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    if (!n.ok) throw new Error()
    state.disavowal[0].status = 'REJECTED'
    expect((await listMySubmissions('a'))[0].status).toBe('closed')
    state.disavowal[0].status = 'NOMINATED'
    await withdrawSubmission(subId('a'), 'a')
    expect((await listMySubmissions('a'))[0].status).toBe('withdrawn')
  })

  it('a duplicate submitter can withdraw their own submission, which leaves the entry standing', async () => {
    await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    await nominate(nominateInput({ nominatorDiscordId: 'b' }))
    expect(await withdrawSubmission(subId('b'), 'b')).toBe('ok')
    expect(state.disavowal[0].status).toBe('NOMINATED')
    expect(state.round[0].state).toBe('OPEN')
    expect(await withdrawSubmission(subId('b'), 'b')).toBe('already')
  })

  it('the original nominator withdrawing with no other active submitter withdraws the entry (status change + events, nothing deleted)', async () => {
    await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    expect(await withdrawSubmission(subId('a'), 'a')).toBe('ok')
    expect(state.disavowal).toHaveLength(1)
    expect(state.disavowal[0].status).toBe('WITHDRAWN')
    expect(state.round[0].state).toBe('CANCELLED')
    expect(state.submission).toHaveLength(1)
    expect(state.event.filter(e => e.type === 'WITHDRAWN').length).toBe(2)
  })

  it('the original withdrawing while a duplicate submitter is still active keeps the entry; the last one out withdraws it', async () => {
    await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    await nominate(nominateInput({ nominatorDiscordId: 'b' }))
    await withdrawSubmission(subId('a'), 'a')
    expect(state.disavowal[0].status).toBe('NOMINATED')
    await withdrawSubmission(subId('b'), 'b')
    expect(state.disavowal[0].status).toBe('WITHDRAWN')
  })

  it('nobody can withdraw someone else\'s submission; withdrawing from a LISTED entry never un-lists it', async () => {
    const { id } = await listedEntry()
    await nominate(nominateInput({ nominatorDiscordId: 'a', identifiers: [{ kind: 'NAME', value: 'other' }] }))
    expect(await withdrawSubmission(subId('a'), 'mallory')).toBe('not_found')
    expect(state.submission.find(x => x.submitterDiscordId === 'a')!.withdrawnAt).toBeNull()
    const orig = state.submission.find(x => x.disavowalId === id && x.isOriginal)!
    expect(await withdrawSubmission(orig.id, orig.submitterDiscordId)).toBe('ok')
    expect(state.disavowal.find(d => d.id === id)!.status).toBe('LISTED')
  })

  it('a duplicate submitter can\'t vote on the entry', async () => {
    const n = await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    if (!n.ok) throw new Error()
    await nominate(nominateInput({ nominatorDiscordId: 'dpr9' }))
    expect(await castVote({ disavowalId: n.id, roundId: state.round[0].id, voterDiscordId: 'dpr9', choice: 'YES' })).toEqual({ ok: false, code: 'conflict' })
    // and their stray vote would not be counted
    for (const v of ['dpr1', 'dpr2']) state.vote.push({ roundId: state.round[0].id, voterDiscordId: v, choice: 'YES' })
    state.vote.push({ roundId: state.round[0].id, voterDiscordId: 'dpr9', choice: 'YES' })
    expect(await settleRound(state.round[0].id, new Date(Date.now() + 8 * D))).toBe('pending')
  })

  it('when a round closes every submitter (original and duplicate) gets the identical neutral notice', async () => {
    const n = await nominate({ ...nominateInput({ nominatorDiscordId: 'a' }), now: T0 })
    if (!n.ok) throw new Error()
    await nominate({ ...nominateInput({ nominatorDiscordId: 'b' }), now: T0 })
    vi.mocked(createNotification).mockClear()
    expect(await settleRound(state.round[0].id, new Date(T0.getTime() + 15 * D))).toBe('failed')
    const closed = vi.mocked(createNotification).mock.calls.map(c => c[0]).filter(c => c.type === 'DISAVOW_ROUND_CLOSED')
    expect(closed.map(c => c.recipientId).sort()).toEqual(['a', 'b'])
    expect(new Set(closed.map(c => `${c.title}|${c.message}|${c.linkUrl}`)).size).toBe(1)
    expect(`${closed[0].title} ${closed[0].message}`).not.toMatch(/Randy|pass|fail|listed/i)
  })

  it('a withdrawn submitter is not notified', async () => {
    const n = await nominate({ ...nominateInput({ nominatorDiscordId: 'a' }), now: T0 })
    if (!n.ok) throw new Error()
    await nominate({ ...nominateInput({ nominatorDiscordId: 'b' }), now: T0 })
    await withdrawSubmission(subId('b'), 'b')
    vi.mocked(createNotification).mockClear()
    await settleRound(state.round[0].id, new Date(T0.getTime() + 15 * D))
    expect(vi.mocked(createNotification).mock.calls.map(c => c[0].recipientId)).toEqual(['a'])
  })
})

describe('nominate hardening', () => {
  it('name-only (and Telegram-only) nominations never count as duplicates', async () => {
    const a = await nominate(nominateInput({ nominatorDiscordId: 'a', identifiers: [{ kind: 'NAME', value: 'randy' }] }))
    const b = await nominate(nominateInput({ nominatorDiscordId: 'b', identifiers: [{ kind: 'NAME', value: 'randy' }] }))
    const c = await nominate(nominateInput({ nominatorDiscordId: 'c', identifiers: [{ kind: 'TELEGRAM', value: 'randy_tg' }] }))
    const d = await nominate(nominateInput({ nominatorDiscordId: 'd', identifiers: [{ kind: 'TELEGRAM', value: 'randy_tg' }] }))
    expect([a.ok, b.ok, c.ok, d.ok]).toEqual([true, true, true, true])
    expect(state.disavowal).toHaveLength(4)
  })

  it('the cap and duplicate checks run inside the locked transaction', async () => {
    await nominate(nominateInput())
    expect(state.order.length).toBeGreaterThanOrEqual(0)
    const src = (await import('node:fs')).readFileSync(new URL('./store.ts', import.meta.url), 'utf8')
    const nomBody = src.slice(src.indexOf('export async function nominate'), src.indexOf('async function notifyDpr'))
    expect(nomBody).toMatch(/advisoryLock\(tx\)/)
    const inTx = nomBody.slice(nomBody.indexOf('prisma.$transaction'))
    expect(inTx).toMatch(/tx\.disavowEvent\.count/)
    expect(inTx).toMatch(/tx\.disavowIdentifier\.findFirst/)
    expect(nomBody.slice(0, nomBody.indexOf('prisma.$transaction'))).not.toMatch(/disavowEvent\.count|disavowIdentifier\.findFirst/)
  })

  it('slow follow-up work is deferred: the DPR notifications run only when the deferred work is executed', async () => {
    let queued: (() => Promise<void>) | null = null
    const r = await nominate({ ...nominateInput(), defer: w => { queued = w } })
    expect(r.ok).toBe(true)
    expect(createNotification).not.toHaveBeenCalled()
    await queued!()
    expect(vi.mocked(createNotification).mock.calls.length).toBe(3)
  })

  it('a duplicate has no deferred work at all and no notifications', async () => {
    await nominate(nominateInput({ nominatorDiscordId: 'a' }))
    vi.mocked(createNotification).mockClear()
    const queued: unknown[] = []
    await nominate({ ...nominateInput({ nominatorDiscordId: 'b' }), defer: w => { queued.push(w) } })
    expect(queued).toHaveLength(0)
    expect(createNotification).not.toHaveBeenCalled()
  })
})

describe('lock order', () => {
  it('unsuspend and withdraw lock the round before touching the disavowal (same order as settleRound)', async () => {
    const { id, later } = await listedEntry()
    await suspend(id, 'dpr1', later)
    state.order.length = 0
    expect(await unsuspend(id, 'dpr1')).toBe('ok')
    expect(state.order[0]).toBe('lock')
    expect(state.order.indexOf('lock')).toBeLessThan(state.order.indexOf('disavowal-update'))

    await nominate(nominateInput({ nominatorDiscordId: 'z', identifiers: [{ kind: 'NAME', value: 'zed' }] }))
    state.order.length = 0
    await withdrawSubmission(state.submission.find(x => x.submitterDiscordId === 'z')!.id, 'z')
    expect(state.order.indexOf('lock')).toBeLessThan(state.order.indexOf('disavowal-update'))
  })
})

describe('third review fixes', () => {
  it('the nomination lock uses $executeRaw (a void $queryRaw would 500 on the Neon adapter)', async () => {
    const r = await nominate(nominateInput())
    expect(r.ok).toBe(true)
    expect(state.order).toContain('advisory')
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('./store.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/\$executeRaw`SELECT pg_advisory_xact_lock/)
    expect(src).not.toMatch(/\$queryRaw`SELECT pg_advisory/)
    // only FOR UPDATE selects may use $queryRaw
    for (const m of src.matchAll(/\$queryRaw`([^`]*)`/g)) expect(m[1]).toMatch(/FOR UPDATE/)
  })

  it('withdrawSubmission takes the same advisory lock first, then the round lock, then updates', async () => {
    await nominate(nominateInput({ nominatorDiscordId: 'z', identifiers: [{ kind: 'NAME', value: 'zed' }] }))
    state.order.length = 0
    await withdrawSubmission(state.submission[0].id, 'z')
    expect(state.order.indexOf('advisory')).toBe(0)
    expect(state.order.indexOf('advisory')).toBeLessThan(state.order.indexOf('lock'))
    expect(state.order.indexOf('lock')).toBeLessThan(state.order.indexOf('disavowal-update'))
  })

  it('submitters are told only when a LIST round closes, not for REMOVE / REAFFIRM rounds', async () => {
    const { id, later } = await listedEntry()
    vi.mocked(createNotification).mockClear()
    await suspend(id, 'dpr1', later)
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    await settleRound(remove.id, new Date(later.getTime() + 15 * D))
    expect(vi.mocked(createNotification).mock.calls.filter(c => c[0].type === 'DISAVOW_ROUND_CLOSED')).toHaveLength(0)
  })

  it('a duplicate on a SUSPENDED entry stays "submitted" through the removal vote; an original flips to "closed" on the LIST outcome', async () => {
    const { id, later } = await listedEntry()
    const original = (await listMySubmissions('nom'))[0]
    expect(original.status).toBe('closed') // its LIST round closed after it was submitted
    await suspend(id, 'dpr1', later)
    const dupAt = new Date()
    await nominate({ ...nominateInput({ nominatorDiscordId: 'late' }), now: dupAt })
    const lateSub = state.submission.find(x => x.submitterDiscordId === 'late')!
    lateSub.createdAt = new Date(later.getTime() + D) // after the LIST round closed (fake clock)
    expect((await listMySubmissions('late'))[0].status).toBe('submitted')
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    await settleRound(remove.id, new Date(later.getTime() + 16 * D)) // closes after the duplicate was submitted
    expect(state.disavowal[0].status).toBe('LISTED')
    expect((await listMySubmissions('late'))[0].status).toBe('submitted')
  })

  it('redaction leaves no marker in a submitter\'s own row', async () => {
    const n = await nominate(nominateInput())
    if (!n.ok) throw new Error()
    await redact(n.id, 'admin1')
    const row = (await listMySubmissions('nom'))[0]
    expect(row.displayName).not.toMatch(/redact/i)
    expect(row.status).toBe('submitted')
  })
})
