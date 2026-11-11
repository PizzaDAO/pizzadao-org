import { describe, expect, it, vi } from 'vitest'
import { DiscordPostError } from '@/app/lib/discord-rest'
import { runCallReminders, type RunDeps } from './run'
import { backoffDays, canTryDm, nextClosed, type DmReach } from './reach'
import { classifyDmError, reminderSendAllowed } from './deliver'
import { callReminderComponents, callReminderText, STOP_CALLS_ID } from './messages'
import { refKeyFor, type CallOccurrence, type PrefLite } from './schedule'
import { MAX_ATTEMPTS, type ReminderStore } from './store'

const now = new Date('2026-11-10T12:00:00Z')
const start = new Date(now.getTime() + 50 * 60_000)
const occ = (eventId = 'e1', crewId = 'community_call', s = start): CallOccurrence => ({ eventId, startsAt: s, crewId, crewLabel: 'Community Call', refKey: refKeyFor(eventId, s) })
const pref = (id: string, calls: PrefLite['calls'] = 'COMMUNITY'): PrefLite => ({ discordId: id, calls, crewIds: [] })
const PROD = { VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 'x' }

/** An in-memory store with the same claim semantics as the database one (unique per member + key). */
function fakeStore(prefs: PrefLite[]) {
  const rows = new Map<string, { status: string; attempts: number; code?: string; at: Date }>()
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
    sentForEventSince: async (d, eventId, since) =>
      [...rows].some(([k, v]) => k.startsWith(`${d}|${eventId}:`) && v.status === 'SENT' && v.at >= since),
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
      return { claimed: false, attempts: 0 }
    },
    markSent: async (d, r) => void Object.assign(rows.get(key(d, r))!, { status: 'SENT', at: now }),
    markSkipped: async (d, r, code) => void Object.assign(rows.get(key(d, r))!, { status: 'SKIPPED', code }),
    release: async (d, r, code, attempts, count) => void Object.assign(rows.get(key(d, r))!, { status: 'RETRY', code, attempts: count ? attempts + 1 : attempts }),
    markFailed: async (d, r, code) => void Object.assign(rows.get(key(d, r))!, { status: 'FAILED', code }),
  }
  return store
}

function deps(o: Partial<RunDeps> & { prefs?: PrefLite[]; occs?: CallOccurrence[]; store?: ReturnType<typeof fakeStore> } = {}) {
  const store = o.store ?? fakeStore(o.prefs ?? [pref('m1')])
  const reach = new Map<string, DmReach>()
  const d: RunDeps = {
    now,
    env: PROD,
    config: { enabled: true, leadMinutes: 60, maxSendsPerRun: 40, maxPerMemberPerDay: 6 },
    store,
    loadOccurrences: async () => o.occs ?? [occ()],
    memberCrewIds: async () => [],
    getReach: async (id) => reach.get(id) ?? null,
    setClosed: async (id, prev, at) => void reach.set(id, nextClosed(prev, at)),
    setOk: async (id) => void reach.set(id, { state: 'OK', failures: 0, recheckAt: null }),
    send: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })),
    settingsUrl: async () => 'https://example.test/profile/1/edit',
    guildId: 'g1',
    sleep: async () => undefined,
    ...o,
  }
  return { d, store, reach }
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
    expect(text).toContain(`<t:${t}:R>`)
    expect(text).toContain(`<t:${t}:t>`)
    expect(text).toContain('https://discord.com/events/g1/e1')
    const rows = callReminderComponents('https://example.test/s') as Array<{ components: Array<{ custom_id?: string; url?: string }> }>
    expect(rows[0].components[0].custom_id).toBe('rm:stop:calls')
    expect(rows[0].components[1].url).toBe('https://example.test/s')
    expect((callReminderComponents(null) as typeof rows)[0].components).toHaveLength(1)
  })
})
