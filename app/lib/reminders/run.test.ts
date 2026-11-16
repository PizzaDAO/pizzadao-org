import { describe, expect, it, vi } from 'vitest'
import { DiscordPostError } from '@/app/lib/discord-rest'
import { runCallReminders, type RunDeps } from './run'
import { backoffDays, canTryDm, nextClosed, type DmReach } from './reach'
import { classifyDmError, reminderSendAllowed } from './deliver'
import { callReminderComponents, callReminderTelegramButtons, callReminderTelegramText, callReminderText, STOP_CALLS_ID } from './messages'
import { telegramKeyFor } from './deliver'
import type { DmResult } from '@/app/lib/telegram/rsv-client'
import type { ReachRow } from '@/app/lib/telegram/reach'
import { refKeyFor, type CallOccurrence, type PrefLite } from './schedule'
import { MAX_ATTEMPTS, type ReminderStore } from './store'

const now = new Date('2026-11-10T12:00:00Z')
const start = new Date(now.getTime() + 50 * 60_000)
const occ = (eventId = 'e1', crewId = 'community_call', s = start): CallOccurrence => ({ eventId, startsAt: s, crewId, crewLabel: 'Community Call', refKey: refKeyFor(eventId, s) })
const pref = (id: string, calls: PrefLite['calls'] = 'COMMUNITY'): PrefLite => ({ discordId: id, calls, crewIds: [] })
const PROD = { VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 'x' }
const PROD_TG = { ...PROD, RSV_PIZZA_TELEGRAM_KEY: 'k' }

/** An in-memory store with the same claim semantics as the database one (unique per member + key). */
function fakeStore(prefs: PrefLite[]) {
  const rows = new Map<string, { status: string; attempts: number; code?: string; at: Date; channel?: string }>()
  const key = (d: string, r: string) => `${d}|${r}`
  const store: ReminderStore & { rows: typeof rows } = {
    rows,
    listCallPrefs: async () => prefs,
    sentSince: async (ids, since) => {
      const out = new Map<string, Date[]>()
      for (const [k, v] of rows) {
        const d = k.split('|')[0]
        if (v.status === 'SENT' && ids.includes(d) && v.at >= since) out.set(d, [...(out.get(d) ?? []), v.at])
      }
      return out
    },
    sentForEventsSince: async (ids, eventIds, since) => {
      const out = new Set<string>()
      for (const [k, v] of rows) {
        const [d, ref] = k.split('|')
        const e = ref.split(':')[0]
        if (v.status === 'SENT' && ids.includes(d) && eventIds.includes(e) && v.at >= since) out.add(`${d}|${e}`)
      }
      return out
    },
    handledCalls: async (ids, refs) => {
      const out = new Set<string>()
      for (const [k, v] of rows) {
        const [d, ...rest] = k.split('|')
        if (ids.includes(d) && refs.includes(rest.join('|')) && v.status !== 'RETRY_TG' && (v.status !== 'RETRY' || v.attempts >= MAX_ATTEMPTS)) out.add(k)
      }
      return out
    },
    claimCall: async (d, r) => {
      const row = rows.get(key(d, r))
      if (!row) {
        rows.set(key(d, r), { status: 'CLAIMED', attempts: 0, at: now })
        return { claimed: true, attempts: 0 }
      }
      if (row.status === 'RETRY' && row.attempts < MAX_ATTEMPTS) {
        row.status = 'CLAIMED'
        return { claimed: true, attempts: row.attempts }
      }
      if (row.status === 'RETRY_TG') {
        row.status = 'CLAIMED'
        return { claimed: true, attempts: 0, telegramOnly: true }
      }
      return { claimed: false, attempts: 0 }
    },
    markSent: async (d, r, _k, channel) => void Object.assign(rows.get(key(d, r))!, { status: 'SENT', at: now, channel }),
    markPartial: async (d, r, channel, code) => void Object.assign(rows.get(key(d, r))!, { status: 'RETRY_TG', channel, code }),
    markSkipped: async (d, r, code) => void Object.assign(rows.get(key(d, r))!, { status: 'SKIPPED', code }),
    release: async (d, r, code, attempts, count) => void Object.assign(rows.get(key(d, r))!, { status: 'RETRY', code, attempts: count ? attempts + 1 : attempts }),
    markFailed: async (d, r, code) => void Object.assign(rows.get(key(d, r))!, { status: 'FAILED', code }),
  }
  return store
}

function deps(o: Partial<RunDeps> & { prefs?: PrefLite[]; occs?: CallOccurrence[]; store?: ReturnType<typeof fakeStore>; linked?: Record<string, ReachRow | null> } = {}) {
  const store = o.store ?? fakeStore(o.prefs ?? [pref('m1')])
  const reach = new Map<string, DmReach>()
  const tgReach = vi.fn(async () => undefined)
  const d: RunDeps = {
    now,
    env: PROD,
    config: { enabled: true, leadMinutes: 60, maxSendsPerRun: 40, maxPerMemberPerDay: 6 },
    store,
    loadOccurrences: async () => o.occs ?? [occ()],
    memberCrewIds: async () => [],
    interestedIds: vi.fn(async () => new Set<string>()),
    getTelegram: async (id) => (o.linked && id in o.linked ? { telegramId: `tg-${id}`, reach: o.linked[id] } : null),
    sendTelegram: vi.fn(async (): Promise<DmResult> => ({ ok: true, messageId: 1 })),
    recordTelegramReach: tgReach,
    getReach: async (id) => reach.get(id) ?? null,
    setClosed: async (id, prev, at) => void reach.set(id, nextClosed(prev, at)),
    setOk: async (id) => void reach.set(id, { state: 'OK', failures: 0, recheckAt: null }),
    send: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })),
    settingsUrl: async () => 'https://example.test/profile/1/edit',
    guildId: 'g1',
    sleep: async () => undefined,
    ...o,
  }
  return { d, store, reach, tgReach }
}

describe('runCallReminders', () => {
  it('sends one DM to an opted-in member and records it', async () => {
    const { d, store } = deps()
    const r = await runCallReminders(d)
    expect(r).toMatchObject({ dryRun: false, occurrences: 1, due: 1, sent: 1 })
    expect(d.send).toHaveBeenCalledTimes(1)
    const [to, text, opts] = vi.mocked(d.send).mock.calls[0]
    expect(to).toBe('m1')
    expect(text).toMatch(/<t:\d+:R>/)
    expect(JSON.stringify(opts)).toContain(STOP_CALLS_ID)
    expect([...store.rows.values()][0].status).toBe('SENT')
  })

  it('never DMs twice for the same event: a second run, and two overlapping runs', async () => {
    const { d, store } = deps()
    await runCallReminders(d)
    await runCallReminders({ ...d, now: new Date(now.getTime() + 5 * 60_000) })
    expect(d.send).toHaveBeenCalledTimes(1)

    const fresh = fakeStore([pref('m1')])
    const a = deps({ store: fresh })
    const b = deps({ store: fresh })
    await Promise.all([runCallReminders(a.d), runCallReminders(b.d)])
    expect(vi.mocked(a.d.send).mock.calls.length + vi.mocked(b.d.send).mock.calls.length).toBe(1)
    expect(store.rows.size).toBe(1)
  })

  it('a moved call that was already reminded for does not DM again', async () => {
    const { d } = deps()
    await runCallReminders(d)
    const moved = occ('e1', 'community_call', new Date(start.getTime() + 15 * 60_000))
    await runCallReminders({ ...d, loadOccurrences: async () => [moved] })
    expect(d.send).toHaveBeenCalledTimes(1)
  })

  it('does nothing for members who did not opt in or do not want that crew', async () => {
    const none = deps({ prefs: [] })
    expect((await runCallReminders(none.d)).due).toBe(0)
    const ops = deps({ prefs: [pref('m1', 'COMMUNITY')], occs: [occ('e2', 'ops')] })
    expect((await runCallReminders(ops.d)).due).toBe(0)
    expect(ops.d.send).not.toHaveBeenCalled()
    const mine = deps({ prefs: [pref('m1', 'MY_CREWS')], occs: [occ('e2', 'ops')], memberCrewIds: async () => ['ops'] })
    expect((await runCallReminders(mine.d)).sent).toBe(1)
  })

  it('opt-out: a member who stopped (calls NONE) is not in the opted-in list and gets nothing', async () => {
    const { d } = deps({ prefs: [] })
    await runCallReminders(d)
    expect(d.send).not.toHaveBeenCalled()
  })

  it('kill switch off: dry run, counts only, nothing claimed or sent', async () => {
    const { d, store } = deps({ config: { enabled: false, leadMinutes: 60, maxSendsPerRun: 40, maxPerMemberPerDay: 6 } })
    const r = await runCallReminders(d)
    expect(r).toMatchObject({ dryRun: true, due: 1, sent: 0 })
    expect(d.send).not.toHaveBeenCalled()
    expect(store.rows.size).toBe(0)
  })

  it('previews never send, even with the switch on', async () => {
    const { d, store } = deps({ env: { VERCEL_ENV: 'preview', DISCORD_BOT_TOKEN: 'x' } })
    const r = await runCallReminders(d)
    expect(r.dryRun).toBe(true)
    expect(d.send).not.toHaveBeenCalled()
    expect(store.rows.size).toBe(0)
  })

  it('caps one run at maxSendsPerRun', async () => {
    const prefs = ['a', 'b', 'c', 'd'].map((x) => pref(x))
    const { d } = deps({ prefs, config: { enabled: true, leadMinutes: 60, maxSendsPerRun: 2, maxPerMemberPerDay: 6 } })
    const r = await runCallReminders(d)
    expect(r.sent).toBe(2)
    expect(r.stoppedEarly).toBe(true)
  })

  it('caps reminders per member per day (all calls together)', async () => {
    const occs = [occ('e1', 'community_call'), occ('e2', 'community_call', new Date(start.getTime() + 3 * 60_000)), occ('e3', 'community_call', new Date(start.getTime() + 6 * 60_000))]
    const { d } = deps({ occs, config: { enabled: true, leadMinutes: 60, maxSendsPerRun: 40, maxPerMemberPerDay: 2 } })
    const r = await runCallReminders(d)
    expect(r.sent).toBe(2)
    expect(r.skipped.cap).toBe(1)
  })

  it('403 marks DMs closed with a 7 day backoff and does not retry; the next run does not try again', async () => {
    const send = vi.fn(async () => {
      throw new DiscordPostError('Cannot send messages to this user', 403)
    })
    const { d, store, reach } = deps({ send })
    const r = await runCallReminders(d)
    expect(r.sent).toBe(0)
    expect(r.skipped.dm_closed).toBe(1)
    expect(reach.get('m1')).toMatchObject({ state: 'CLOSED', failures: 1 })
    expect(reach.get('m1')!.recheckAt!.getTime()).toBe(now.getTime() + 7 * 24 * 3600_000)
    expect([...store.rows.values()][0]).toMatchObject({ status: 'SKIPPED', code: 'dm_closed' })
    // Another occurrence later in the week, still within the backoff: no attempt at all.
    const later = occ('e9', 'community_call', new Date(start.getTime() + 60_000))
    await runCallReminders({ ...d, loadOccurrences: async () => [later] })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a closed member is tried again once the backoff has passed, and a good send clears it', async () => {
    const { d, reach } = deps()
    reach.set('m1', { state: 'CLOSED', failures: 2, recheckAt: new Date(now.getTime() - 1000) })
    await runCallReminders(d)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(reach.get('m1')).toMatchObject({ state: 'OK', failures: 0 })
  })

  it('429 stops the run and leaves the rest for the next one, without using up an attempt', async () => {
    const send = vi.fn(async () => {
      throw new DiscordPostError('rate limited', 429, 30_000)
    })
    const { d, store } = deps({ send, prefs: [pref('a'), pref('b')] })
    const r = await runCallReminders(d)
    expect(send).toHaveBeenCalledTimes(1)
    expect(r.stoppedEarly).toBe(true)
    expect([...store.rows.values()].filter((v) => v.status === 'RETRY' && v.attempts === 0)).toHaveLength(1)
    // The next run picks the released one up again (and only it, the other never got a row).
    const ok = vi.fn(async () => ({ channelId: 'c', messageId: 'm' }))
    const r2 = await runCallReminders({ ...d, send: ok })
    expect(r2.sent).toBe(2)
  })

  it('an uncertain failure releases the claim, and gives up after 3 attempts', async () => {
    const send = vi.fn(async () => {
      throw new Error('network')
    })
    const { d, store } = deps({ send })
    expect((await runCallReminders(d)).retried).toBe(1)
    expect((await runCallReminders(d)).retried).toBe(1)
    const third = await runCallReminders(d)
    expect(third.failed).toBe(1)
    expect([...store.rows.values()][0].status).toBe('FAILED')
    await runCallReminders(d)
    expect(send).toHaveBeenCalledTimes(3)
  })
})

describe('per-member lead', () => {
  const at = (min: number) => new Date(now.getTime() + min * 60_000)
  const lead = (id: string, leadMinutes: number | null): PrefLite => ({ ...pref(id), leadMinutes })

  it('each member is due by their own lead; the fetch horizon is the longest lead plus slack', async () => {
    const loadOccurrences = vi.fn(async () => [occ('e1', 'community_call', at(30))])
    const { d } = deps({ prefs: [lead('a', 5), lead('b', 30), lead('c', 60), lead('d', null)], loadOccurrences })
    const r = await runCallReminders({ ...d, config: { ...d.config, leadMinutes: 15 } })
    // 30 minutes out: b (30) and c (60) are due, a (5) and d (default 15) are not.
    expect(r).toMatchObject({ due: 2, sent: 2 })
    expect(vi.mocked(d.send).mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c'])
    expect(loadOccurrences).toHaveBeenCalledWith({ now, horizonMs: 60 * 60_000 + 2 * 60_000, leadMs: 60 * 60_000 })
  })

  it('a 5 minute lead fires at 5 minutes out, and a call under 2 minutes away is skipped', async () => {
    const near = deps({ prefs: [lead('a', 5)], occs: [occ('e1', 'community_call', at(4.5))] })
    expect((await runCallReminders(near.d)).sent).toBe(1)
    const late = deps({ prefs: [lead('a', 5)], occs: [occ('e1', 'community_call', at(1.5))] })
    expect((await runCallReminders(late.d)).due).toBe(0)
  })

  it('no one opted in: Discord is never asked for events', async () => {
    const loadOccurrences = vi.fn(async () => [occ()])
    const { d } = deps({ prefs: [], loadOccurrences })
    await runCallReminders(d)
    expect(loadOccurrences).not.toHaveBeenCalled()
  })

  it('a run every minute sends once: minute after minute, and across overlapping runs', async () => {
    const { d, store } = deps({ prefs: [lead('a', 60)], occs: [occ('e1', 'community_call', at(50))] })
    for (let i = 0; i < 5; i++) await runCallReminders({ ...d, now: new Date(now.getTime() + i * 60_000) })
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(store.rows.size).toBe(1)
    const fresh = fakeStore([lead('a', 60)])
    const x = deps({ store: fresh })
    const y = deps({ store: fresh })
    await Promise.all([runCallReminders(x.d), runCallReminders(y.d)])
    expect(vi.mocked(x.d.send).mock.calls.length + vi.mocked(y.d.send).mock.calls.length).toBe(1)
  })
})

describe('calls I am attending (Interested)', () => {
  const my = (id: string): PrefLite => pref(id, 'MY_CREWS')

  it('adds a due call the member marked Interested, though it is not one of their crews', async () => {
    const interestedIds = vi.fn(async () => new Set(['m1']))
    const { d } = deps({ prefs: [my('m1'), my('m2')], occs: [occ('e2', 'ops')], interestedIds })
    const r = await runCallReminders(d)
    expect(r).toMatchObject({ due: 1, sent: 1, viaInterested: 1 })
    expect(vi.mocked(d.send).mock.calls[0][0]).toBe('m1')
    expect(interestedIds).toHaveBeenCalledTimes(1)
    expect(interestedIds).toHaveBeenCalledWith('e2')
  })

  it('a lookup failure falls back to crews only and counts the failure', async () => {
    const interestedIds = vi.fn(async () => {
      throw new Error('discord down')
    })
    const { d } = deps({ prefs: [my('m1'), my('m2')], occs: [occ('e2', 'ops'), occ('e3', 'community_call', new Date(start.getTime() + 60_000))], memberCrewIds: async (id) => (id === 'm2' ? ['ops'] : []), interestedIds })
    const r = await runCallReminders(d)
    expect(r.interestedFailed).toBe(1)
    // m2 still gets its crew call (ops) and both get the Community Call.
    expect(r.sent).toBe(3)
  })

  it('handled pairs are not counted and not looked up; crew sends do not wait for the lookup', async () => {
    const order: string[] = []
    const interestedIds = vi.fn(async () => {
      order.push('lookup')
      return new Set(['m3'])
    })
    const send = vi.fn(async (to: string) => {
      order.push(`send:${to}`)
      return { channelId: 'c', messageId: 'm' }
    })
    const store = fakeStore([my('m1'), my('m2'), my('m3')])
    // m1 already got the event e2 on an earlier run.
    await store.claimCall('m1', occ('e2', 'ops').refKey)
    await store.markSent('m1', occ('e2', 'ops').refKey)
    const { d } = deps({ store, occs: [occ('e2', 'ops'), occ()], interestedIds, send, memberCrewIds: async () => [] })
    const r = await runCallReminders(d)
    expect(interestedIds).toHaveBeenCalledTimes(1)
    expect(r.viaInterested).toBe(1)
    // Community call to all three (m1 handled for e2 only), then the Interested send to m3 last.
    expect(order[order.length - 1]).toBe('send:m3')
    expect(order.indexOf('lookup')).toBeGreaterThan(order.indexOf('send:m1'))
    // A second run: every handled pair is dropped before counting (only m2, not interested, is looked up again).
    const r2 = await runCallReminders({ ...d, now: new Date(now.getTime() + 60_000) })
    expect(r2).toMatchObject({ due: 0, viaInterested: 0, sent: 0 })
    expect(r2.skipped.already).toBeUndefined()
  })

  it('does not ask Discord when nobody is MY_CREWS, or when the call is already theirs by crew', async () => {
    const interestedIds = vi.fn(async () => new Set<string>())
    await runCallReminders(deps({ prefs: [pref('m1', 'COMMUNITY')], occs: [occ('e2', 'ops')], interestedIds }).d)
    await runCallReminders(deps({ prefs: [my('m1')], occs: [occ()], interestedIds }).d)
    expect(interestedIds).not.toHaveBeenCalled()
  })

  it('only asks for due occurrences', async () => {
    const interestedIds = vi.fn(async () => new Set<string>())
    const far = occ('e9', 'ops', new Date(now.getTime() + 90 * 60_000))
    await runCallReminders(deps({ prefs: [my('m1')], occs: [far], interestedIds }).d)
    expect(interestedIds).not.toHaveBeenCalled()
  })
})

describe('Telegram delivery', () => {
  const tgPref = (id: string, channel: PrefLite['channel']): PrefLite => ({ ...pref(id), channel })

  it('TELEGRAM sends only on Telegram with a hashed key, a plain text body and a settings button', async () => {
    const { d, store } = deps({ prefs: [tgPref('m1', 'TELEGRAM')], env: PROD_TG, linked: { m1: null } })
    const r = await runCallReminders(d)
    expect(r).toMatchObject({ sent: 1, sentTelegram: 1 })
    expect(d.send).not.toHaveBeenCalled()
    const arg = vi.mocked(d.sendTelegram).mock.calls[0][0]
    expect(arg.telegramUserId).toBe('tg-m1')
    expect(arg.idempotencyKey).toBe(telegramKeyFor(occ().refKey, 'm1'))
    expect(arg.idempotencyKey).toMatch(/^rm:[0-9a-f]{40}$/)
    expect(arg.idempotencyKey).not.toContain('m1')
    expect(arg.text).toMatch(/starts in about 50 min/)
    expect(arg.text).not.toContain('<t:')
    expect(arg.buttons).toEqual([[{ text: expect.any(String), url: 'https://example.test/profile/1/edit' }]])
    expect([...store.rows.values()][0]).toMatchObject({ status: 'SENT', channel: 'telegram' })
    expect(d.recordTelegramReach).toHaveBeenCalledWith('tg-m1', 'ok', expect.anything(), now)
  })

  it('BOTH sends on both channels under one claim', async () => {
    const { d, store } = deps({ prefs: [tgPref('m1', 'BOTH')], env: PROD_TG, linked: { m1: null } })
    const r = await runCallReminders(d)
    expect(r).toMatchObject({ sent: 1, sentTelegram: 1 })
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.sendTelegram).toHaveBeenCalledTimes(1)
    expect(store.rows.size).toBe(1)
    expect([...store.rows.values()][0]).toMatchObject({ status: 'SENT', channel: 'discord,telegram' })
  })

  it('AUTO and DISCORD stay Discord only', async () => {
    for (const channel of ['AUTO', 'DISCORD'] as const) {
      const { d } = deps({ prefs: [tgPref('m1', channel)], env: PROD_TG, linked: { m1: null } })
      await runCallReminders(d)
      expect(d.send).toHaveBeenCalledTimes(1)
      expect(d.sendTelegram).not.toHaveBeenCalled()
    }
  })

  it('partial success is a send and is never retried: Telegram fails after Discord delivered', async () => {
    const sendTelegram = vi.fn(async (): Promise<DmResult> => ({ ok: false, code: 'uncertain' }))
    const { d, store } = deps({ prefs: [tgPref('m1', 'BOTH')], env: PROD_TG, linked: { m1: null }, sendTelegram })
    const r = await runCallReminders(d)
    expect(r).toMatchObject({ sent: 1, sentTelegram: 0, retried: 0, failed: 0 })
    expect([...store.rows.values()][0]).toMatchObject({ status: 'SENT', channel: 'discord' })
    await runCallReminders({ ...d, now: new Date(now.getTime() + 60_000) })
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(sendTelegram).toHaveBeenCalledTimes(1)
  })

  it('Discord closed but Telegram delivered is a send', async () => {
    const send = vi.fn(async () => {
      throw new DiscordPostError('Cannot send messages to this user', 403)
    })
    const { d, store, reach } = deps({ prefs: [tgPref('m1', 'BOTH')], env: PROD_TG, linked: { m1: null }, send })
    const r = await runCallReminders(d)
    expect(r.sent).toBe(1)
    expect(reach.get('m1')).toMatchObject({ state: 'CLOSED' })
    expect([...store.rows.values()][0]).toMatchObject({ status: 'SENT', channel: 'telegram' })
  })

  it('TELEGRAM without a link, or with the sender off, is skipped with a reason and claims nothing', async () => {
    const noLink = deps({ prefs: [tgPref('m1', 'TELEGRAM')], env: PROD_TG, linked: {} })
    const r = await runCallReminders(noLink.d)
    expect(r.skipped.telegram_no_link).toBe(1)
    expect(noLink.store.rows.size).toBe(0)
    const off = deps({ prefs: [tgPref('m1', 'TELEGRAM')], env: PROD, linked: { m1: null } })
    expect((await runCallReminders(off.d)).skipped.telegram_off).toBe(1)
    expect(off.d.sendTelegram).not.toHaveBeenCalled()
  })

  it('a Telegram reach that is not yet retryable is skipped; "not started" is recorded and skipped quietly', async () => {
    const blocked = deps({ prefs: [tgPref('m1', 'TELEGRAM')], env: PROD_TG, linked: { m1: { state: 'BLOCKED', failures: 0, recheckAt: null } } })
    expect((await runCallReminders(blocked.d)).skipped.telegram_unreachable).toBe(1)
    expect(blocked.d.sendTelegram).not.toHaveBeenCalled()

    const sendTelegram = vi.fn(async (): Promise<DmResult> => ({ ok: false, code: 'not_started' }))
    const ns = deps({ prefs: [tgPref('m1', 'TELEGRAM')], env: PROD_TG, linked: { m1: null }, sendTelegram })
    const r = await runCallReminders(ns.d)
    expect(r.skipped.telegram_unreachable).toBe(1)
    expect(ns.tgReach).toHaveBeenCalledWith('tg-m1', 'not_started', expect.anything(), now)
    expect([...ns.store.rows.values()][0]).toMatchObject({ status: 'SKIPPED', code: 'telegram_unreachable' })
  })

  it('an uncertain Telegram answer is final for Telegram (the proxy replays it for that key): failed, no retries', async () => {
    const sendTelegram = vi.fn(async (): Promise<DmResult> => ({ ok: false, code: 'uncertain' }))
    const { d, store } = deps({ prefs: [tgPref('m1', 'TELEGRAM')], env: PROD_TG, linked: { m1: null }, sendTelegram })
    expect((await runCallReminders(d)).failed).toBe(1)
    expect([...store.rows.values()][0]).toMatchObject({ status: 'FAILED', code: 'uncertain' })
    await runCallReminders({ ...d, now: new Date(now.getTime() + 60_000) })
    expect(sendTelegram).toHaveBeenCalledTimes(1)
  })

  it('Discord delivered but Telegram rate limited: only Telegram is retried later, with the same key', async () => {
    let tgAnswer: DmResult = { ok: false, code: 'rate_limited', retryAfter: 5 }
    const sendTelegram = vi.fn(async (): Promise<DmResult> => tgAnswer)
    const { d, store } = deps({ prefs: [tgPref('m1', 'BOTH')], env: PROD_TG, linked: { m1: null }, sendTelegram })
    const r1 = await runCallReminders(d)
    expect(r1).toMatchObject({ sent: 1, retried: 1 })
    expect([...store.rows.values()][0]).toMatchObject({ status: 'RETRY_TG', channel: 'discord' })
    tgAnswer = { ok: true, messageId: 2 }
    const r2 = await runCallReminders({ ...d, now: new Date(now.getTime() + 60_000) })
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(sendTelegram).toHaveBeenCalledTimes(2)
    const keys = sendTelegram.mock.calls.map((c) => (c as unknown as [{ idempotencyKey: string }])[0].idempotencyKey)
    expect(new Set(keys).size).toBe(1)
    expect(r2).toMatchObject({ sent: 0, sentTelegram: 1 })
    expect([...store.rows.values()][0]).toMatchObject({ status: 'SENT', channel: 'discord,telegram' })
    // Done: later minutes do nothing.
    await runCallReminders({ ...d, now: new Date(now.getTime() + 120_000) })
    expect(sendTelegram).toHaveBeenCalledTimes(2)
  })

  it('does not count dm_closed when Telegram then delivers', async () => {
    const send = vi.fn(async () => {
      throw new DiscordPostError('Cannot send messages to this user', 403)
    })
    const { d } = deps({ prefs: [tgPref('m1', 'BOTH')], env: PROD_TG, linked: { m1: null }, send })
    const r = await runCallReminders(d)
    expect(r.skipped.dm_closed).toBeUndefined()
  })

  it('a Telegram rate limit does not use up an attempt or stop the run', async () => {
    const sendTelegram = vi.fn(async (): Promise<DmResult> => ({ ok: false, code: 'rate_limited', retryAfter: 5 }))
    const { d, store } = deps({ prefs: [tgPref('a', 'TELEGRAM'), tgPref('b', 'TELEGRAM')], env: PROD_TG, linked: { a: null, b: null }, sendTelegram })
    const r = await runCallReminders(d)
    expect(r.retried).toBe(2)
    expect(r.stoppedEarly).toBe(false)
    expect([...store.rows.values()].every((v) => v.status === 'RETRY' && v.attempts === 0)).toBe(true)
  })

  it('previews never send on Telegram either', async () => {
    const { d } = deps({ prefs: [tgPref('m1', 'BOTH')], env: { VERCEL_ENV: 'preview', DISCORD_BOT_TOKEN: 'x', RSV_PIZZA_TELEGRAM_KEY: 'k' }, linked: { m1: null } })
    expect((await runCallReminders(d)).dryRun).toBe(true)
    expect(d.sendTelegram).not.toHaveBeenCalled()
  })

  it('the Telegram message is plain text with the join link', () => {
    const text = callReminderTelegramText({ crewLabel: 'Community Call', startsAt: new Date('2026-11-10T12:50:00Z'), now, guildId: 'g1', eventId: 'e1' })
    expect(text).toBe('⏰ Community call starts in about 50 min (12:50 UTC).\nJoin: https://discord.com/events/g1/e1')
    expect(callReminderTelegramButtons(null)).toBeUndefined()
  })
})

describe('delivery rules', () => {
  it('only the production deploy with the bot configured may send', () => {
    expect(reminderSendAllowed({ VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 't' })).toBe(true)
    expect(reminderSendAllowed({ VERCEL_ENV: 'preview', DISCORD_BOT_TOKEN: 't' })).toBe(false)
    expect(reminderSendAllowed({ DISCORD_BOT_TOKEN: 't' })).toBe(false)
    expect(reminderSendAllowed({ VERCEL_ENV: 'production' })).toBe(false)
  })
  it('classifies Discord errors', () => {
    expect(classifyDmError(new DiscordPostError('x', 403)).kind).toBe('closed')
    expect(classifyDmError(new DiscordPostError('x', 429)).kind).toBe('rate_limited')
    expect(classifyDmError(new DiscordPostError('x', 502)).kind).toBe('retry')
    expect(classifyDmError(new DiscordPostError('x', 404)).kind).toBe('failed')
    expect(classifyDmError(new Error('boom')).kind).toBe('retry')
  })
  it('backs off 7 days, doubling, capped at 60', () => {
    expect([1, 2, 3, 4, 5].map(backoffDays)).toEqual([7, 14, 28, 56, 60])
    expect(canTryDm(null, now)).toBe(true)
    expect(canTryDm({ state: 'CLOSED', recheckAt: new Date(now.getTime() + 1) }, now)).toBe(false)
  })
})

describe('message', () => {
  it('uses Discord timestamps, the join link and a Stop button', () => {
    const text = callReminderText({ crewLabel: 'Community Call', startsAt: start, guildId: 'g1', eventId: 'e1' })
    const t = Math.floor(start.getTime() / 1000)
    expect(text).toMatch(/^⏰ Community call starts /)
    expect(callReminderText({ crewLabel: 'Ops', startsAt: start, guildId: null, eventId: 'e1' })).toMatch(/^⏰ Ops call starts /)
    expect(text).toContain(`<t:${t}:R>`)
    expect(text).toContain(`<t:${t}:t>`)
    expect(text).toContain('https://discord.com/events/g1/e1')
    const rows = callReminderComponents('https://example.test/s') as Array<{ components: Array<{ custom_id?: string; url?: string }> }>
    expect(rows[0].components[0].custom_id).toBe('rm:stop:calls')
    expect(rows[0].components[1].url).toBe('https://example.test/s')
    expect((callReminderComponents(null) as typeof rows)[0].components).toHaveLength(1)
  })
})
