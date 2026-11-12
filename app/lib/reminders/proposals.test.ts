import { describe, expect, it, vi } from 'vitest'
import { DiscordPostError } from '@/app/lib/discord-rest'
import { nextClosed, type DmReach } from './reach'
import { proposalUrl, runProposalReminders, closingStart, type ProposalRunDeps } from './proposals'
import { STOP_PROPOSALS_ID } from './messages'
import { MAX_ATTEMPTS, type SendKind } from './store'
import type { OpenProposalLite, ProposalPrefLite } from './proposal-store'
import { NO_PILOT, type PilotState } from '@/app/lib/proposals/pilot-state'

const HOUR = 3600_000
const now = new Date('2026-11-10T12:00:00Z')
const PROD = { VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 'x' }

const prop = (o: Partial<OpenProposalLite> = {}): OpenProposalLite => ({
  id: 'p1',
  title: 'Fund a thing',
  isTest: false,
  opensAt: new Date(now.getTime() - 2 * HOUR),
  closesAt: new Date(now.getTime() + 5 * 24 * HOUR),
  fingerprint: 'ab cd ef',
  ...o,
})
const pref = (id: string, o: Partial<ProposalPrefLite> = {}): ProposalPrefLite => ({ discordId: id, opened: true, closing: true, ...o })

/** In-memory stores with the same claim semantics as the database ones. `voters` maps proposal id -> [member, tokenIssued]. */
function setup(o: { prefs?: ProposalPrefLite[]; proposals?: OpenProposalLite[]; voters?: Record<string, Array<[string, boolean]>>; over?: Partial<ProposalRunDeps> } = {}) {
  const rows = new Map<string, { status: string; attempts: number; at: Date }>()
  const key = (d: string, r: string, k: SendKind = 'CALL') => `${d}|${k}|${r}`
  const voters = o.voters ?? { p1: [['m1', false]] }
  const calls = { listVoters: [] as Array<[string, boolean]> }
  const reach = new Map<string, DmReach>()
  const store: ProposalRunDeps['store'] = {
    listProposalPrefs: async () => o.prefs ?? [pref('m1')],
    listOpenProposals: async () => o.proposals ?? [prop()],
    listVoters: async (id, noTokenOnly) => {
      calls.listVoters.push([id, noTokenOnly])
      return (voters[id] ?? []).filter(([, tok]) => !noTokenOnly || !tok).map(([m]) => m)
    },
    sentSince: async (ids, since) => {
      const out = new Map<string, Date[]>()
      for (const [k, v] of rows) {
        const d = k.split('|')[0]
        if (v.status === 'SENT' && ids.includes(d) && v.at >= since) out.set(d, [...(out.get(d) ?? []), v.at])
      }
      return out
    },
    claimCall: async (d, r, k) => {
      const row = rows.get(key(d, r, k))
      if (!row) {
        rows.set(key(d, r, k), { status: 'CLAIMED', attempts: 0, at: now })
        return { claimed: true, attempts: 0 }
      }
      if (row.status === 'RETRY' && row.attempts < MAX_ATTEMPTS) {
        row.status = 'CLAIMED'
        return { claimed: true, attempts: row.attempts }
      }
      return { claimed: false, attempts: 0 }
    },
    markSent: async (d, r, k) => void Object.assign(rows.get(key(d, r, k))!, { status: 'SENT', at: now }),
    markSkipped: async (d, r, code, k) => void Object.assign(rows.get(key(d, r, k))!, { status: 'SKIPPED' }),
    release: async (d, r, _c, attempts, count, k) => void Object.assign(rows.get(key(d, r, k))!, { status: 'RETRY', attempts: count ? attempts + 1 : attempts }),
    markFailed: async (d, r, _c, k) => void Object.assign(rows.get(key(d, r, k))!, { status: 'FAILED' }),
  }
  const d: ProposalRunDeps = {
    now,
    env: PROD,
    config: { enabled: true, closingHours: 24, maxSends: 40, maxPerMemberPerDay: 6 },
    proposalsOn: true,
    pilot: NO_PILOT,
    siteUrl: 'https://app.example',
    store,
    getReach: async (id) => reach.get(id) ?? null,
    setClosed: async (id, prev, at) => void reach.set(id, nextClosed(prev, at)),
    setOk: async (id) => void reach.set(id, { state: 'OK', failures: 0, recheckAt: null }),
    send: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })),
    settingsUrl: async () => 'https://app.example/profile/1/edit',
    sleep: async () => undefined,
    ...o.over,
  }
  return { d, rows, calls, reach }
}

const lastText = (d: ProposalRunDeps, i = 0) => vi.mocked(d.send).mock.calls[i][1]

describe('opened reminder', () => {
  it('goes once to an opted-in voter, with the fingerprint link and a Stop button, and never twice', async () => {
    const { d, rows } = setup()
    const r = await runProposalReminders(d)
    expect(r).toMatchObject({ dryRun: false, proposals: 1, due: 1, sent: 1 })
    expect(lastText(d)).toContain('New proposal open')
    expect(lastText(d)).toContain('https://app.example/proposals/p1?fp=abcdef')
    expect(JSON.stringify(vi.mocked(d.send).mock.calls[0][2])).toContain(STOP_PROPOSALS_ID)
    expect([...rows.keys()][0]).toContain('PROPOSAL_OPENED')
    await runProposalReminders({ ...d, now: new Date(now.getTime() + 5 * 60_000) })
    expect(d.send).toHaveBeenCalledTimes(1)
  })

  it('two overlapping runs send exactly one DM', async () => {
    const a = setup()
    const b = { ...a.d, send: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })) }
    await Promise.all([runProposalReminders(a.d), runProposalReminders(b)])
    expect(vi.mocked(a.d.send).mock.calls.length + vi.mocked(b.send).mock.calls.length).toBe(1)
  })

  it('also reaches a voter who already has a ballot token (only "closing" is token-gated)', async () => {
    const { d } = setup({ voters: { p1: [['m1', true]] } })
    expect((await runProposalReminders(d)).sent).toBe(1)
  })

  it('only the voter snapshot is reminded, and only if opted in to this kind', async () => {
    const { d } = setup({
      prefs: [pref('m1'), pref('m2', { opened: false }), pref('outsider')],
      voters: { p1: [['m1', false], ['m2', false], ['m3', false]] },
    })
    const r = await runProposalReminders(d)
    expect(r.sent).toBe(1)
    expect(vi.mocked(d.send).mock.calls.map((c) => c[0])).toEqual(['m1'])
  })

  it('a proposal not yet opened, already closed, or without a window is skipped', async () => {
    const { d } = setup({
      proposals: [
        prop({ id: 'a', opensAt: new Date(now.getTime() + HOUR) }),
        prop({ id: 'b', closesAt: new Date(now.getTime() - 1) }),
        prop({ id: 'c', closesAt: null }),
      ],
      voters: { a: [['m1', false]], b: [['m1', false]], c: [['m1', false]] },
    })
    expect(await runProposalReminders(d)).toMatchObject({ proposals: 0, due: 0, sent: 0 })
  })
})

describe('closing reminder and ballot secrecy', () => {
  const closing = prop({ opensAt: new Date(now.getTime() - 6 * 24 * HOUR), closesAt: new Date(now.getTime() + 12 * HOUR) })

  it('asks the store for members WITHOUT a token only, and sends only to them', async () => {
    const { d, calls } = setup({
      proposals: [closing],
      voters: { p1: [['m1', false], ['m2', true]] },
      prefs: [pref('m1'), pref('m2')],
    })
    const r = await runProposalReminders(d)
    expect(calls.listVoters).toEqual([['p1', true]])
    expect(r.sent).toBe(1)
    expect(vi.mocked(d.send).mock.calls.map((c) => c[0])).toEqual(['m1'])
    expect(lastText(d)).toContain('closes <t:')
    expect(lastText(d)).toContain('If you already voted, ignore this')
    expect(lastText(d)).not.toMatch(/haven't voted|have not voted/i)
  })

  it('does not send "opened" in the closing window, and needs the closing pref', async () => {
    const { d } = setup({ proposals: [closing], prefs: [pref('m1', { closing: false })] })
    expect((await runProposalReminders(d)).sent).toBe(0)
  })

  it('a short test window starts closing halfway, after its opened DM can go', () => {
    const p = { opensAt: new Date(now.getTime()), closesAt: new Date(now.getTime() + HOUR) }
    expect(closingStart(p, 24).getTime()).toBe(now.getTime() + HOUR / 2)
    const long = { opensAt: now, closesAt: new Date(now.getTime() + 7 * 24 * HOUR) }
    expect(closingStart(long, 24).getTime()).toBe(long.closesAt.getTime() - 24 * HOUR)
  })

  it('closing DMs go out before opened DMs when the budget is tight', async () => {
    const { d } = setup({
      proposals: [prop({ id: 'open1', closesAt: new Date(now.getTime() + 6 * 24 * HOUR) }), prop({ id: 'cl1', opensAt: new Date(now.getTime() - 6 * 24 * HOUR), closesAt: new Date(now.getTime() + 3 * HOUR) })],
      voters: { open1: [['m1', false]], cl1: [['m1', false]] },
      over: { config: { enabled: true, closingHours: 24, maxSends: 1, maxPerMemberPerDay: 6 } },
    })
    const r = await runProposalReminders(d)
    expect(r).toMatchObject({ sent: 1, stoppedEarly: true })
    expect(lastText(d)).toContain('closes <t:')
  })
})

describe('pilot, proposals off, kill switch', () => {
  const pilot = (ids: string[]): PilotState => ({ running: true, unknown: false, ids })

  it('a test proposal reaches only pilot testers', async () => {
    const { d } = setup({
      proposals: [prop({ isTest: true })],
      prefs: [pref('m1'), pref('m2')],
      voters: { p1: [['m1', false], ['m2', false]] },
      over: { pilot: pilot(['m1']) },
    })
    await runProposalReminders(d)
    expect(vi.mocked(d.send).mock.calls.map((c) => c[0])).toEqual(['m1'])
  })

  it('a test proposal reaches nobody once the pilot is over, or when the tester list is unreadable', async () => {
    const a = setup({ proposals: [prop({ isTest: true })] })
    expect((await runProposalReminders(a.d)).sent).toBe(0)
    const b = setup({ proposals: [prop({ isTest: true })], over: { pilot: { running: true, unknown: true, ids: [] } } })
    expect((await runProposalReminders(b.d)).sent).toBe(0)
  })

  it('during a pilot, real proposals also follow the pilot list', async () => {
    const { d } = setup({ over: { pilot: pilot(['someone-else']) } })
    expect((await runProposalReminders(d)).sent).toBe(0)
  })

  it('nothing is sent or even listed when proposals are disabled', async () => {
    const { d, calls } = setup({ over: { proposalsOn: false } })
    const r = await runProposalReminders(d)
    expect(r).toMatchObject({ sent: 0, due: 0, skipped: { proposals_off: 1 } })
    expect(d.send).not.toHaveBeenCalled()
    expect(calls.listVoters).toEqual([])
  })

  it('switch off or a preview: counts only, claims and sends nothing', async () => {
    for (const over of [{ config: { enabled: false, closingHours: 24, maxSends: 40, maxPerMemberPerDay: 6 } }, { env: { VERCEL_ENV: 'preview', DISCORD_BOT_TOKEN: 'x' } }]) {
      const { d, rows } = setup({ over })
      const r = await runProposalReminders(d)
      expect(r).toMatchObject({ dryRun: true, due: 1, sent: 0 })
      expect(d.send).not.toHaveBeenCalled()
      expect(rows.size).toBe(0)
    }
  })
})

describe('caps, closed DMs, errors', () => {
  it('maxSends (what is left after calls) stops the run', async () => {
    const ids = ['m1', 'm2', 'm3']
    const { d } = setup({ prefs: ids.map((i) => pref(i)), voters: { p1: ids.map((i) => [i, false] as [string, boolean]) }, over: { config: { enabled: true, closingHours: 24, maxSends: 2, maxPerMemberPerDay: 6 } } })
    expect(await runProposalReminders(d)).toMatchObject({ sent: 2, stoppedEarly: true })
  })

  it('the per-member daily cap is shared with every other reminder kind', async () => {
    const { d, rows } = setup({ over: { config: { enabled: true, closingHours: 24, maxSends: 40, maxPerMemberPerDay: 1 } } })
    rows.set('m1|CALL|e1:123', { status: 'SENT', attempts: 0, at: new Date(now.getTime() - HOUR) })
    const r = await runProposalReminders(d)
    expect(r.sent).toBe(0)
    expect(r.skipped.cap).toBe(1)
    expect(d.send).not.toHaveBeenCalled()
  })

  it('a 403 marks the member closed, is not retried now, and backs off', async () => {
    const send = vi.fn(async () => {
      throw new DiscordPostError('x', 403)
    })
    const { d, reach, rows } = setup({ over: { send } })
    expect((await runProposalReminders(d)).skipped.dm_closed).toBe(1)
    expect(reach.get('m1')?.state).toBe('CLOSED')
    const second = await runProposalReminders({ ...d, now: new Date(now.getTime() + 5 * 60_000) })
    expect(send).toHaveBeenCalledTimes(1)
    expect(second.skipped.dm_closed).toBe(1)
    expect([...rows.values()][0].status).toBe('SKIPPED')
  })

  it('a 429 releases the claim and stops the run; a 500 is retried up to the attempt limit', async () => {
    const limited = setup({ over: { send: vi.fn(async () => { throw new DiscordPostError('x', 429) }) } })
    expect(await runProposalReminders(limited.d)).toMatchObject({ sent: 0, stoppedEarly: true })
    expect([...limited.rows.values()][0]).toMatchObject({ status: 'RETRY', attempts: 0 })

    const flaky = setup({ over: { send: vi.fn(async () => { throw new DiscordPostError('x', 500) }) } })
    for (let i = 0; i < MAX_ATTEMPTS; i++) await runProposalReminders({ ...flaky.d, now: new Date(now.getTime() + i * 5 * 60_000) })
    expect([...flaky.rows.values()][0].status).toBe('FAILED')
    expect(flaky.d.send).toHaveBeenCalledTimes(MAX_ATTEMPTS)
  })
})

describe('proposalUrl', () => {
  it('carries the whitespace-free fingerprint, or none', () => {
    expect(proposalUrl('https://a', { id: 'x', fingerprint: 'a b' })).toBe('https://a/proposals/x?fp=ab')
    expect(proposalUrl('https://a', { id: 'x', fingerprint: null })).toBe('https://a/proposals/x')
  })
})
