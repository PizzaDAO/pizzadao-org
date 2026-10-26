// @vitest-environment node
// Store rules against a small in-memory Prisma fake: voting conflicts, thresholds,
// idempotent settlement, nomination limits, audit log, redaction, no deletes.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, any>
const H = 3600_000

const state = vi.hoisted(() => ({
  disavowal: [] as any[], identifier: [] as any[], round: [] as any[], vote: [] as any[], event: [] as any[],
  seq: 0,
}))

vi.mock('@/app/lib/db', () => {
  const match = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return (v as any).in.includes(row[k])
        if ('gte' in v) return row[k] >= (v as any).gte
        if ('lte' in v) return row[k] <= (v as any).lte
        if ('none' in v) return true
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
  const tx: any = {
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
      create: async ({ data }: any) => { const r = { id: `r${++state.seq}`, state: 'OPEN', ...data }; state.round.push(r); return r },
    }),
    disavowVote: {
      upsert: async ({ where, create, update }: any) => {
        const k = where.roundId_voterDiscordId
        const ex = state.vote.find(v => v.roundId === k.roundId && v.voterDiscordId === k.voterDiscordId)
        if (ex) Object.assign(ex, update)
        else state.vote.push({ ...create })
      },
    },
    disavowIdentifier: model(() => state.identifier),
    disavowEvent: { create: async ({ data }: any) => { state.event.push({ ...data }); return data } },
  }
  const withRound = (r: Row) => ({
    ...r,
    votes: state.vote.filter(v => v.roundId === r.id),
    disavowal: { ...state.disavowal.find(d => d.id === r.disavowalId), identifiers: state.identifier.filter(i => i.disavowalId === r.disavowalId) },
  })
  const prisma = {
    ...tx,
    disavowal: {
      ...tx.disavowal,
      count: async ({ where }: any) => state.disavowal.filter(d => match(d, where)).length,
      findMany: async ({ where }: any) => state.disavowal.filter(d => d.status === where.status && d.reviewDueAt && d.reviewDueAt <= where.reviewDueAt.lte && !state.round.some(r => r.disavowalId === d.id && r.state === 'OPEN')),
      findUnique: async ({ where }: any) => {
        const d = state.disavowal.find(x => x.id === where.id)
        return d && { ...d, identifiers: state.identifier.filter(i => i.disavowalId === d.id), rounds: state.round.filter(r => r.disavowalId === d.id && r.state === 'OPEN') }
      },
    },
    disavowRound: { ...tx.disavowRound, findMany: async ({ where }: any) => state.round.filter(r => match(r, where)), findUnique: async ({ where }: any) => { const r = state.round.find(x => x.id === where.id); return r && withRound(r) } },
    disavowIdentifier: {
      ...tx.disavowIdentifier,
      findFirst: async ({ where }: any) => {
        const hit = state.identifier.find(i => where.OR.some((o: Row) => o.kind === i.kind && o.value === i.value)
          && where.disavowal.status.in.includes(state.disavowal.find(d => d.id === i.disavowalId)!.status))
        return hit ? { disavowalId: hit.disavowalId } : null
      },
    },
    $transaction: async (fn: any) => fn(tx),
  }
  return { prisma }
})
vi.mock('@/app/lib/notifications', () => ({ createNotification: vi.fn(async () => ({})) }))
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => ['dpr1', 'dpr2', 'dpr3']) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberById: vi.fn(async (id: string) => (id === '77' ? { discordId: 'subjD' } : null)),
  fetchMemberIdByDiscordId: vi.fn(async (d: string) => (d === 'subjD' ? '77' : d === 'nom' ? '1' : null)),
}))

import { createNotification } from '@/app/lib/notifications'
import { castVote, nominate, openRemoveRound, redact, runDisavowCron, settleRound, suspend, withdraw, addResponse } from './store'

const nominateInput = (over: Row = {}) => ({
  nominatorDiscordId: 'nom', displayName: 'Randy', reason: 'SCAM' as const,
  statement: 'x'.repeat(30), evidenceUrls: [], identifiers: [{ kind: 'MEMBER_ID' as const, value: '77' }, { kind: 'DISCORD_ID' as const, value: 'subjD' }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.disavowal.length = state.identifier.length = state.round.length = state.vote.length = state.event.length = 0
  state.seq = 0
})

async function listedEntry() {
  const t0 = new Date('2026-11-01T00:00:00Z')
  const r = await nominate({ ...nominateInput(), now: t0 })
  if (!r.ok) throw new Error('setup')
  const round = state.round[0]
  const later = new Date(t0.getTime() + 80 * H)
  for (const v of ['dpr1', 'dpr2', 'dpr3']) {
    expect((await castVote({ disavowalId: r.id, roundId: round.id, voterDiscordId: v, choice: 'YES', now: later })).ok).toBe(true)
  }
  return { id: r.id, roundId: round.id, t0, later }
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
  it('a different nominator is not limited by someone else\'s count', async () => {
    for (let i = 0; i < 3; i++) await nominate(nominateInput({ identifiers: [{ kind: 'NAME', value: `n${i}` }] }))
    expect((await nominate(nominateInput({ nominatorDiscordId: 'other', identifiers: [{ kind: 'NAME', value: 'zz' }] }))).ok).toBe(true)
  })
  it('refuses a duplicate active entry with a pointer to it, and self-nomination', async () => {
    const first = await nominate(nominateInput())
    const dup = await nominate(nominateInput({ nominatorDiscordId: 'someone', identifiers: [{ kind: 'DISCORD_ID', value: 'subjD' }] }))
    expect(dup).toMatchObject({ ok: false, code: 'duplicate', existingId: first.ok ? first.id : '' })
    expect(await nominate(nominateInput({ nominatorDiscordId: 'subjD', identifiers: [{ kind: 'MEMBER_ID', value: '77' }] }))).toEqual({ ok: false, code: 'self' })
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
  it('stays pending before 72h even with 3 yes, then lists at 72h', async () => {
    const t0 = new Date('2026-11-01T00:00:00Z')
    const n = await nominate({ ...nominateInput(), now: t0 })
    if (!n.ok) throw new Error()
    const roundId = state.round[0].id
    const early = new Date(t0.getTime() + 10 * H)
    for (const v of ['dpr1', 'dpr2', 'dpr3']) await castVote({ disavowalId: n.id, roundId, voterDiscordId: v, choice: 'YES', now: early })
    expect(state.disavowal[0].status).toBe('NOMINATED')
    expect(await settleRound(roundId, new Date(t0.getTime() + 72 * H))).toBe('passed')
    expect(state.disavowal[0].status).toBe('LISTED')
    expect(state.disavowal[0].reviewDueAt.getTime()).toBeGreaterThan(state.disavowal[0].listedAt.getTime())
  })
  it('lists with 3 yes + 2 no after 72h and notifies the subject without names or content', async () => {
    const t0 = new Date('2026-11-01T00:00:00Z')
    const n = await nominate({ ...nominateInput(), now: t0 })
    if (!n.ok) throw new Error()
    const roundId = state.round[0].id
    const later = new Date(t0.getTime() + 80 * H)
    vi.mocked(createNotification).mockClear()
    for (const [v, c] of [['a', 'YES'], ['b', 'YES'], ['c', 'YES'], ['d', 'NO'], ['e', 'NO']] as const) {
      await castVote({ disavowalId: n.id, roundId, voterDiscordId: v, choice: c, now: later })
    }
    expect(state.disavowal[0].status).toBe('LISTED')
    const subject = vi.mocked(createNotification).mock.calls.map(c => c[0]).filter(c => c.type === 'DISAVOW_LISTED_SUBJECT')
    expect(subject).toHaveLength(1)
    expect(subject[0].recipientId).toBe('subjD')
    expect(`${subject[0].title} ${subject[0].message}`).not.toMatch(/Randy|scam|nom/i)
  })
  it('does not list on 3 yes + 3 no; fails at the 14-day close and REJECTS', async () => {
    const t0 = new Date('2026-11-01T00:00:00Z')
    const n = await nominate({ ...nominateInput(), now: t0 })
    if (!n.ok) throw new Error()
    const roundId = state.round[0].id
    const later = new Date(t0.getTime() + 100 * H)
    for (const [v, c] of [['d', 'NO'], ['e', 'NO'], ['f', 'NO'], ['a', 'YES'], ['b', 'YES'], ['c', 'YES']] as const) {
      await castVote({ disavowalId: n.id, roundId, voterDiscordId: v, choice: c, now: later })
    }
    expect(state.disavowal[0].status).toBe('NOMINATED')
    expect(await settleRound(roundId, new Date(t0.getTime() + 14 * 24 * H))).toBe('failed')
    expect(state.disavowal[0].status).toBe('REJECTED')
  })
  it('refuses votes after the window and settles instead', async () => {
    const t0 = new Date('2026-11-01T00:00:00Z')
    const n = await nominate({ ...nominateInput(), now: t0 })
    if (!n.ok) throw new Error()
    const r = await castVote({ disavowalId: n.id, roundId: state.round[0].id, voterDiscordId: 'dpr1', choice: 'YES', now: new Date(t0.getTime() + 15 * 24 * H) })
    expect(r).toEqual({ ok: false, code: 'closed' })
    expect(state.disavowal[0].status).toBe('REJECTED')
  })
})

describe('settleRound', () => {
  it('two concurrent settles produce exactly one LISTED event and one close', async () => {
    const t0 = new Date('2026-11-01T00:00:00Z')
    const n = await nominate({ ...nominateInput(), now: t0 })
    if (!n.ok) throw new Error()
    const round = state.round[0]
    for (const v of ['a', 'b', 'c']) state.vote.push({ roundId: round.id, voterDiscordId: v, choice: 'YES' })
    const now = new Date(t0.getTime() + 100 * H)
    await Promise.all([settleRound(round.id, now), settleRound(round.id, now)])
    expect(state.event.filter(e => e.type === 'LISTED')).toHaveLength(1)
    expect(state.event.filter(e => e.type === 'ROUND_CLOSED')).toHaveLength(1)
    expect(vi.mocked(createNotification).mock.calls.filter(c => c[0].type === 'DISAVOW_LISTED_SUBJECT')).toHaveLength(1)
  })
})

describe('lifecycle', () => {
  it('suspend hides the listing, opens a REMOVE vote; a failed removal restores it', async () => {
    const { id, later } = await listedEntry()
    expect(await suspend(id, 'dpr1', later)).toBe('ok')
    expect(state.disavowal[0].status).toBe('SUSPENDED')
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    expect(remove.state).toBe('OPEN')
    expect(await settleRound(remove.id, new Date(later.getTime() + 15 * 24 * H))).toBe('failed')
    expect(state.disavowal[0].status).toBe('LISTED')
    expect(state.event.map(e => e.type)).toContain('SUSPENDED')
    expect(state.event.map(e => e.type)).toContain('UNSUSPENDED')
  })
  it('a passed REMOVE round removes (status change only)', async () => {
    const { id, later } = await listedEntry()
    expect(await openRemoveRound(id, 'dpr1', { now: later })).toBe('ok')
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    for (const v of ['x', 'y', 'z']) state.vote.push({ roundId: remove.id, voterDiscordId: v, choice: 'YES' })
    expect(await settleRound(remove.id, new Date(later.getTime() + 80 * H))).toBe('passed')
    expect(state.disavowal[0].status).toBe('REMOVED')
    expect(state.disavowal).toHaveLength(1)
  })
  it('an appeal is allowed once per 90 days', async () => {
    const { id, later } = await listedEntry()
    expect(await openRemoveRound(id, 'subjD', { appeal: true, now: later })).toBe('ok')
    const remove = state.round.find(r => r.kind === 'REMOVE')!
    await settleRound(remove.id, new Date(later.getTime() + 15 * 24 * H))
    expect(await openRemoveRound(id, 'subjD', { appeal: true, now: new Date(later.getTime() + 30 * 24 * H) })).toBe('too_soon')
    expect(await openRemoveRound(id, 'subjD', { appeal: true, now: new Date(later.getTime() + 91 * 24 * H) })).toBe('ok')
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
    const due = new Date(later.getTime() + 400 * 24 * H)
    state.disavowal[0].reviewDueAt = new Date(later.getTime() + 1000)
    const res = await runDisavowCron(due)
    expect(res.reaffirmOpened).toBe(1)
    const re = state.round.find(r => r.kind === 'REAFFIRM')!
    expect(re.state).toBe('OPEN')
    await runDisavowCron(new Date(due.getTime() + 15 * 24 * H))
    expect(state.disavowal.find(d => d.id === id)!.status).toBe('EXPIRED')
  })
})

describe('redaction and audit', () => {
  it('redact overwrites text and handles, keeps the row and logs field names only', async () => {
    const n = await nominate(nominateInput({
      statement: 'Secret details about a wallet drain 0xabc', evidenceUrls: ['https://e.com/x'],
      identifiers: [{ kind: 'NAME', value: 'randy' }, { kind: 'X_HANDLE', value: 'randyx' }, { kind: 'DISCORD_ID', value: 'subjD' }],
    }))
    if (!n.ok) throw new Error()
    expect(await redact(n.id, 'admin1')).toBe('ok')
    const d = state.disavowal[0]
    expect(d.statement).toBe('[redacted]')
    expect(d.displayName).toBe('[redacted]')
    expect(d.evidenceUrls).toEqual([])
    expect(d.redactedAt).toBeInstanceOf(Date)
    expect(state.identifier.filter(i => i.kind === 'NAME' || i.kind === 'X_HANDLE').every(i => i.value.startsWith('[redacted]'))).toBe(true)
    expect(state.identifier.find(i => i.kind === 'DISCORD_ID')!.value).toBe('subjD')
    const ev = state.event.find(e => e.type === 'REDACTED')!
    expect(ev.actorDiscordId).toBe('admin1')
    expect(JSON.stringify(ev.data)).not.toMatch(/Secret|randy|0xabc/)
    expect(state.disavowal).toHaveLength(1)
  })
  it('every mutation appends events and the store exposes no delete path', async () => {
    const { id, later } = await listedEntry()
    await suspend(id, 'dpr1', later)
    expect(state.event.every(e => e.disavowalId === id)).toBe(true)
    expect(state.event.length).toBeGreaterThanOrEqual(6)
    const src = (await import('node:fs')).readFileSync(new URL('./store.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/\.delete(Many)?\(/)
  })
})
