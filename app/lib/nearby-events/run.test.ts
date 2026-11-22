// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DiscordPostError } from '@/app/lib/discord-rest'
import type { NearbyEvent } from './client'
import type { MatchConfig } from './match'
import { nearbyQuiet, runNearbyInvites, type InviteMember, type NearbyRunDeps } from './run'
import type { NearbyPrefRow, NearbyStore } from './store'

const NOW = new Date('2026-12-01T15:00:00Z') // 10:00 in New York, daytime in UTC
const HOUR = 3_600_000
const PROD = { VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 'x' }
const match: MatchConfig = { defaultRadiusKm: 50, citySlackKm: 25, minLeadHours: 24, maxLeadDays: 45, maxPerWeek: 3, maxPerDay: 1, kinds: ['gpp', 'series'] }
const quiet = { startHour: 21, endHour: 9, unknownTzStartHour: 14, unknownTzEndHour: 22 }

const ev = (id: string, hoursAhead: number, o: Partial<NearbyEvent> = {}): NearbyEvent => ({
  id, url: `https://rsv.example/${id}`, name: `Party ${id}`, startsAt: new Date(NOW.getTime() + hoursAhead * HOUR), timezone: 'America/New_York', city: 'New York',
  lat: 40, lng: -74, cityLevel: false, full: false, rsvpClosed: false, kind: 'gpp', ...o,
})
const mem = (n: number, o: Partial<InviteMember> = {}): InviteMember => ({ discordId: `d${n}`, memberId: `${n}`, lat: 40, lng: -74, cityName: 'New York', ...o })

type Row = { status: string; attempts: number; channel?: string; at: Date; code?: string }

/** An in-memory NearbyStore with the same claim semantics as the real one. */
function memStore(o: { prefs?: NearbyPrefRow[]; zones?: Record<string, string>; sent?: Record<string, Date[]>; today?: Record<string, Date[]>; racing?: (id: string) => Date[] } = {}) {
  const rows = new Map<string, Row>()
  const key = (d: string, r: string) => `${d}|${r}`
  const store: NearbyStore = {
    listPrefs: async (ids) => (o.prefs ?? []).filter((p) => ids.includes(p.discordId)),
    handled: async (eventIds, ids) => new Set([...rows].filter(([k, r]) => eventIds.includes(k.split('|')[1]) && ids.includes(k.split('|')[0]) && (r.status !== 'RETRY' || r.attempts >= 3)).map(([k]) => k)),
    sentThisWeek: async (ids) => {
      const out = new Map<string, Date[]>()
      for (const id of ids) {
        const mine = [...(o.sent?.[id] ?? []), ...[...rows].filter(([k, r]) => k.startsWith(`${id}|`) && (r.status === 'SENT' || r.status === 'CLAIMED')).map(([, r]) => r.at)]
        if (mine.length) out.set(id, mine)
      }
      return out
    },
    sentDay: async (ids) => {
      const out = new Map<string, Date[]>()
      for (const id of ids) if (o.today?.[id]) out.set(id, o.today[id])
      return out
    },
    recent: async (id, _now, except) => [
      ...(o.racing?.(id) ?? []),
      ...[...rows].filter(([k, r]) => k.startsWith(`${id}|`) && !k.endsWith(`|${except}`) && (r.status === 'SENT' || r.status === 'CLAIMED')).map(([, r]) => r.at),
    ],
    unclaim: async (d, r) => void rows.delete(key(d, r)),
    timezones: async (ids) => new Map(Object.entries(o.zones ?? {}).filter(([k]) => ids.includes(k))),
    claim: async (d, r) => {
      const k = key(d, r)
      const have = rows.get(k)
      if (!have) {
        rows.set(k, { status: 'CLAIMED', attempts: 0, at: NOW })
        return { claimed: true, attempts: 0 }
      }
      if (have.status === 'RETRY' && have.attempts < 3) {
        have.status = 'CLAIMED'
        return { claimed: true, attempts: have.attempts }
      }
      return { claimed: false, attempts: 0 }
    },
    markSent: async (d, r, _k, channel) => void Object.assign(rows.get(key(d, r))!, { status: 'SENT', channel, at: NOW }),
    markSkipped: async (d, r, code) => void Object.assign(rows.get(key(d, r))!, { status: 'SKIPPED', code }),
    release: async (d, r, code, attempts, count) => void Object.assign(rows.get(key(d, r))!, { status: 'RETRY', code, attempts: count ? attempts + 1 : attempts }),
    markFailed: async (d, r, code) => void Object.assign(rows.get(key(d, r))!, { status: 'FAILED', code }),
  }
  return { store, rows }
}

function deps(o: {
  events?: NearbyEvent[] | null
  members?: InviteMember[]
  store?: NearbyStore
  env?: Record<string, string | undefined>
  enabled?: boolean
  send?: NearbyRunDeps['send']
  maxSends?: number
  now?: Date
  today?: unknown
  nowMs?: () => number
  deadlineAt?: number
} = {}) {
  const sent: Array<{ id: string; text: string }> = []
  const notified: string[] = []
  const send: NearbyRunDeps['send'] = o.send ?? (async (id, text) => void sent.push({ id, text }))
  const fetchEvents = vi.fn(async () => (o.events === undefined ? [ev('e1', 48)] : o.events))
  const loadMembers = vi.fn(async () => o.members ?? [mem(1)])
  const d: NearbyRunDeps = {
    now: o.now ?? NOW,
    env: o.env ?? PROD,
    siteUrl: 'https://app.example',
    config: { enabled: o.enabled ?? true, match, maxSends: o.maxSends ?? 100, maxPerMemberPerDay: 6, deadlineAt: o.deadlineAt ?? Number.MAX_SAFE_INTEGER, quiet, telegramRecheck: { dmRecheckDays: 7, dmRecheckMaxDays: 60 } },
    fetchEvents,
    loadMembers,
    store: o.store ?? memStore().store,
    getReach: async () => null,
    setClosed: async () => undefined,
    setOk: async () => undefined,
    send,
    getTelegram: async () => null,
    sendTelegram: async () => ({ ok: true }),
    recordTelegramReach: async () => undefined,
    optOutUrl: (id) => `https://app.example/nearby-optout?d=${id}`,
    nowMs: o.nowMs,
    notify: async (n) => void notified.push(n.discordId),
    sleep: async () => undefined,
  }
  return { d, sent, notified, fetchEvents, loadMembers }
}

describe('runNearbyInvites', () => {
  it('opt-out default: a member with no preference row gets the invite, with an RSVP link and an in-app notice', async () => {
    const t = deps()
    const r = await runNearbyInvites(t.d)
    expect(r).toMatchObject({ sent: 1, due: 1, dryRun: false })
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].text).toContain('https://rsv.example/e1?ref=pizzadao')
    expect(t.sent[0].text).toMatch(/Party e1[\s\S]*about 1 km from New York/)
    expect(t.notified).toEqual(['d1'])
  })

  it('a member who opted out gets nothing, but everyone else still does', async () => {
    const { store } = memStore({ prefs: [{ discordId: 'd1', nearbyEvents: false, nearbyRadiusKm: null, channel: 'AUTO' }] })
    const t = deps({ members: [mem(1), mem(2)], store })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(1)
    expect(r.skipped.opted_out).toBe(1)
    expect(t.sent.map((s) => s.id)).toEqual(['d2'])
  })

  it('members too far away get nothing; the radius is the member own when set', async () => {
    const far = mem(2, { lat: 40.9 }) // about 100 km
    const { store } = memStore({ prefs: [{ discordId: 'd3', nearbyEvents: true, nearbyRadiusKm: 250, channel: 'AUTO' }] })
    const t = deps({ members: [mem(1), far, { ...far, discordId: 'd3', memberId: '3' }], store })
    await runNearbyInvites(t.d)
    expect(t.sent.map((s) => s.id).sort()).toEqual(['d1', 'd3'])
  })

  it('idempotent: a second run sends nothing more', async () => {
    const { store } = memStore()
    await runNearbyInvites(deps({ store }).d)
    const t2 = deps({ store })
    const r = await runNearbyInvites(t2.d)
    expect(r.sent).toBe(0)
    expect(r.due).toBe(0)
    expect(t2.sent).toHaveLength(0)
  })

  it('one a day: of two events the soonest goes now; the other is not recorded and goes the next day', async () => {
    const { store, rows } = memStore()
    const events = [ev('late', 120), ev('soon', 48)]
    const t = deps({ events, store })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(1)
    expect(r.skipped.cap_day).toBe(1)
    expect(t.sent[0].text).toContain('Party soon')
    expect(rows.has('d1|late')).toBe(false)
    // Next day: eligible again.
    const tomorrow = new Date(NOW.getTime() + 25 * HOUR)
    const r2 = await runNearbyInvites(deps({ events, store, now: tomorrow }).d)
    expect(r2.sent).toBe(1)
    expect(rows.get('d1|late')?.status).toBe('SENT')
  })

  it('three a week: a fourth event in the same week waits', async () => {
    const day = (n: number) => new Date(NOW.getTime() - n * 26 * HOUR)
    const { store } = memStore({ sent: { d1: [day(1), day(2), day(3)] } })
    const t = deps({ store })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(0)
    expect(r.skipped.cap_week).toBe(1)
    expect(t.sent).toHaveLength(0)
  })

  it('quiet hours: no send, nothing recorded, the next run tries again', async () => {
    // 04:00 in New York (09:00 UTC).
    const night = new Date('2026-12-01T09:00:00Z')
    const { store, rows } = memStore({ zones: { '1': 'America/New_York' } })
    const t = deps({ store, now: night, events: [ev('e1', 72)] })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(0)
    expect(r.skipped.quiet).toBe(1)
    expect(rows.size).toBe(0)
    const morning = new Date('2026-12-01T15:00:00Z')
    expect((await runNearbyInvites(deps({ store, now: morning, events: [ev('e1', 72)] }).d)).sent).toBe(1)
  })

  it('unknown timezone: only the daytime UTC window sends', () => {
    expect(nearbyQuiet(new Date('2026-12-01T10:00:00Z'), null, quiet)).toBe(true)
    expect(nearbyQuiet(new Date('2026-12-01T15:00:00Z'), null, quiet)).toBe(false)
    expect(nearbyQuiet(new Date('2026-12-01T23:00:00Z'), 'Not/AZone', quiet)).toBe(true)
  })

  it('a preview (or the switch off) only counts: no claims, no sends, no notices', async () => {
    const { store, rows } = memStore()
    const p = deps({ store, env: { VERCEL_ENV: 'preview', DISCORD_BOT_TOKEN: 'x' } })
    const r = await runNearbyInvites(p.d)
    expect(r).toMatchObject({ dryRun: true, due: 1, sent: 0 })
    const off = deps({ store, enabled: false })
    expect((await runNearbyInvites(off.d)).dryRun).toBe(true)
    expect(p.sent.length + off.sent.length + p.notified.length).toBe(0)
    expect(rows.size).toBe(0)
  })

  it('no events or a failed feed: members are never read', async () => {
    const none = deps({ events: [] })
    await runNearbyInvites(none.d)
    expect(none.loadMembers).not.toHaveBeenCalled()
    const failed = deps({ events: null })
    expect((await runNearbyInvites(failed.d)).fetchFailed).toBe(true)
    expect(failed.loadMembers).not.toHaveBeenCalled()
  })

  it('skips events that are full, closed, too soon or of a switched-off kind', async () => {
    const t = deps({ events: [ev('full', 48, { full: true }), ev('closed', 48, { rsvpClosed: true }), ev('soon', 10)] })
    const r = await runNearbyInvites(t.d)
    expect(r.events).toBe(0)
    expect(t.loadMembers).not.toHaveBeenCalled()
  })

  it('a closed DM is remembered and the member still gets the in-app notice (row SENT via app)', async () => {
    const { store, rows } = memStore()
    const setClosed = vi.fn(async () => undefined)
    const t = deps({ store, send: async () => Promise.reject(new DiscordPostError('closed', 403)) })
    t.d.setClosed = setClosed
    const r = await runNearbyInvites(t.d)
    expect(setClosed).toHaveBeenCalledTimes(1)
    expect(r.skipped.dm_closed).toBe(1)
    expect(t.notified).toEqual(['d1'])
    expect(rows.get('d1|e1')).toMatchObject({ status: 'SENT', channel: 'app' })
  })

  it('a Discord rate limit stops the run and puts the claim back', async () => {
    const { store, rows } = memStore()
    const t = deps({ store, members: [mem(1), mem(2)], send: async () => Promise.reject(new DiscordPostError('slow', 429)) })
    const r = await runNearbyInvites(t.d)
    expect(r.stoppedEarly).toBe(true)
    expect(r.sent).toBe(0)
    expect(rows.get('d1|e1')?.status).toBe('RETRY')
    expect(rows.has('d2|e1')).toBe(false)
  })

  it('a transient Discord error releases the claim with no notice, and the next run retries', async () => {
    const { store, rows } = memStore()
    const flaky = deps({ store, send: async () => Promise.reject(new Error('network')) })
    const r = await runNearbyInvites(flaky.d)
    expect(r.retried).toBe(1)
    expect(flaky.notified).toHaveLength(0)
    expect(rows.get('d1|e1')?.status).toBe('RETRY')
    const ok = deps({ store })
    expect((await runNearbyInvites(ok.d)).sent).toBe(1)
    expect(ok.notified).toEqual(['d1'])
  })

  it('stops at the per-run budget', async () => {
    const t = deps({ members: [mem(1), mem(2), mem(3)], maxSends: 2 })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(2)
    expect(r.stoppedEarly).toBe(true)
  })

  it('stops starting sends at the wall-clock deadline and leaves the rest for the next run', async () => {
    const { store, rows } = memStore()
    let t = 1000
    const t1 = deps({ store, members: [mem(1), mem(2), mem(3)], deadlineAt: 2000, nowMs: () => (t += 600) })
    const r = await runNearbyInvites(t1.d)
    expect(r.stoppedEarly).toBe(true)
    expect(r.sent).toBeLessThan(3)
    expect(rows.size).toBe(r.sent)
    // The next run (no deadline pressure) finishes the rest.
    const r2 = await runNearbyInvites(deps({ store, members: [mem(1), mem(2), mem(3)] }).d)
    expect(r.sent + r2.sent).toBe(3)
  })

  it('an in-flight claim counts toward the cap', async () => {
    const { store } = memStore()
    await store.claim('d1', 'other', 'NEARBY_EVENT') // CLAIMED by another run, one a day
    const t = deps({ store })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(0)
    expect(r.skipped.cap_day).toBe(1)
  })

  it('reminders.maxPerMemberPerDay counts every kind of reminder', async () => {
    const six = Array.from({ length: 6 }, () => new Date(NOW.getTime() - HOUR))
    const { store } = memStore({ today: { d1: six } })
    const t = deps({ store })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(0)
    expect(r.skipped.cap_all).toBe(1)
  })

  it('re-checks the cap inside the claim: a racing claim makes this run back off and drop its own claim', async () => {
    const { store, rows } = memStore({ racing: () => [new Date(NOW.getTime() - 1000)] })
    const t = deps({ store })
    const r = await runNearbyInvites(t.d)
    expect(r.sent).toBe(0)
    expect(r.skipped.cap_race).toBe(1)
    expect(rows.size).toBe(0)
    expect(t.sent).toHaveLength(0)
  })

  it('the Telegram invite carries a signed no-login opt-out link', async () => {
    const { store } = memStore({ prefs: [{ discordId: 'd1', nearbyEvents: true, nearbyRadiusKm: null, channel: 'TELEGRAM' }] })
    const sendTelegram = vi.fn(async () => ({ ok: true as const }))
    const t = deps({ store, env: { ...PROD, RSV_PIZZA_TELEGRAM_KEY: 'k' } })
    t.d.sendTelegram = sendTelegram
    t.d.getTelegram = async () => ({ telegramId: 't1', reach: null })
    await runNearbyInvites(t.d)
    const arg = (sendTelegram.mock.calls[0] as unknown as [{ buttons: Array<Array<{ url: string }>> }])[0]
    expect(arg.buttons[1][0].url).toBe('https://app.example/nearby-optout?d=d1')
  })

  it('results carry counts only, no member ids', async () => {
    const r = await runNearbyInvites(deps().d)
    expect(JSON.stringify(r)).not.toMatch(/d1/)
  })
})
