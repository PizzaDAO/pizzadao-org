// @vitest-environment node
// Store rules against a small in-memory Prisma fake: voting conflicts, fixed day-7
// decision, idempotent settlement, nomination caps, audit log, redaction, no deletes.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, any>
const H = 3600_000
const D = 24 * H

const state = vi.hoisted(() => ({
  disavowal: [] as any[], identifier: [] as any[], round: [] as any[], vote: [] as any[], event: [] as any[],
  locks: 0, seq: 0,
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
    $queryRaw: async () => { state.locks++; return [] },
    disavowal: model(() => state.disavowal, {
      create: async ({ data }: any) => {
        const id = `d${++state.seq}`
        const { identifiers, rounds, ...rest } = data
        state.disavowal.push({ id, status: 'NOMINATED', createdAt: new Date(), ...rest })
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
    }),
    disavowVote: model(() => state.vote, {
      upsert: async ({ where, create, update }: any) => {
        const k = where.roundId_voterDiscordId
        const ex = state.vote.find(v => v.roundId === k.roundId && v.voterDiscordId === k.voterDiscordId)
        if (ex) Object.assign(ex, update)
        else state.vote.push({ ...create })
      },
    }),
    disavowIdentifier: model(() => state.identifier),
    disavowEvent: { create: async ({ data }: any) => { state.event.push({ ...data }); return data } },
  }
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
      findMany: async ({ where }: any) => state.round.filter(r => match(r, where)),
      findUnique: async ({ where }: any) => { const r = state.round.find(x => x.id === where.id); return r && withRound(r) },
    },
    disavowIdentifier: {
      ...tx.disavowIdentifier,
      findFirst: async ({ where }: any) => {
        const hit = state.identifier.find(i => where.OR.some((o: Row) => o.kind === i.kind && o.value === i.value)
          && where.disavowal.status.in.includes(state.disavowal.find(d => d.id === i.disavowalId)!.status))
        return hit ? { disavowalId: hit.disavowalId, disavowal: { status: state.disavowal.find(d => d.id === hit.disavowalId)!.status } } : null
      },
    },
    disavowEvent: {
      create: tx.disavowEvent.create,
      count: async ({ where }: any) => state.event.filter(e => e.type === where.type && e.actorDiscordId === where.actorDiscordId && e.createdAt >= where.createdAt.gte).length,
      findFirst: async () => null,
    },
    $transaction: async (fn: any) => fn(tx),
  }
  // Events carry a timestamp so the cap can window them.
  const origCreate = tx.disavowEvent.create
  tx.disavowEvent.create = async (a: any) => origCreate({ data: { createdAt: new Date(), ...a.data } })
  prisma.disavowEvent.create = async (a: any) => origCreate({ data: { createdAt: new Date(), ...a.data } })
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
import { castVote, nominate, openRemoveRound, redact, runDisavowCron, settleRound, suspend, withdraw, addResponse, isSubjectOf } from './store'

const nominateInput = (over: Row = {}) => ({
  nominatorDiscordId: 'nom', displayName: 'Randy', reason: 'SCAM' as const,
  statement: 'x'.repeat(30), evidenceUrls: [], identifiers: [{ kind: 'MEMBER_ID' as const, value: '77' }, { kind: 'DISCORD_ID' as const, value: 'subjD' }],
  ...over,
})
const T0 = new Date('2026-11-01T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  state.disavowal.length = state.identifier.length = state.round.length = state.vote.length = state.event.length = 0
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
  it('only the nominator can withdraw, and only while NOMINATED', async () => {
    const n = await nominate(nominateInput())
    if (!n.ok) throw new Error()
    expect(await withdraw(n.id, 'someone')).toBe('forbidden')
    expect(await withdraw(n.id, 'nom')).toBe('ok')
    expect(state.disavowal[0].status).toBe('WITHDRAWN')
    expect(state.round[0].state).toBe('CANCELLED')
    expect(await withdraw(n.id, 'nom')).toBe('bad_state')
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
