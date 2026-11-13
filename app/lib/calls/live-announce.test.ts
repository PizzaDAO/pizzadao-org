// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { Settings } from '@/app/lib/settings'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/telegram/city-posts', async (orig) => ({ ...(await orig<typeof import('@/app/lib/telegram/city-posts')>()), enqueueMirror: vi.fn(), processOutbox: vi.fn() }))
const crewsMock = vi.fn()
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: () => crewsMock() }))
const sessionsMock = vi.fn(async () => [] as unknown[])
vi.mock('./live-state', async (orig) => ({ ...(await orig<typeof import('./live-state')>()), findLiveSessions: () => sessionsMock() }))
vi.mock('@/app/lib/settings', async (orig) => ({ ...(await orig<typeof import('@/app/lib/settings')>()), loadSettings: vi.fn(async () => ({})) }))

import {
  buildVars,
  canRunLive,
  liveAnnounceTick,
  occurrenceKey,
  renderTemplate,
  runLiveAnnounce,
  runLiveReminders,
  pickRandomCity,
  type AnnounceRow,
  type LiveStore,
} from './live-announce'
import { liveReplyText, resolveLiveContext, resolveSessionEvent } from './live-announce-command'
import { currentCallEvent } from './progress-command'

vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn(async () => false) }))
vi.mock('@/app/lib/settings/channels', () => ({ savedChannelId: vi.fn(async () => '') }))
vi.mock('@/app/lib/call-agenda/run', () => ({ DEFAULT_CALL_VOICE_CHANNEL_ID: '1' }))
vi.mock('./progress-command', () => ({ currentCallEvent: vi.fn(), editOriginalUrl: () => 'u' }))

const PROD = { VERCEL_ENV: 'production', DISCORD_GUILD_ID: '555', DISCORD_BOT_TOKEN: 'tok', ANNOUNCE_TIMEZONE: 'UTC' }
const START = new Date('2026-11-15T20:00:00Z')
const NOW = new Date('2026-11-15T20:01:00Z')
const CTX = { eventId: '777', voiceChannelId: '888', sessionId: 's1', startedAt: START }

const DEFAULTS: Record<string, unknown> = {
  'calls.liveAnnounceCommandEnabled': true,
  'calls.liveAnnounceAutoEnabled': true,
  'calls.liveReminderEnabled': true,
  'calls.liveReminderMinutes': 3,
  'calls.liveAnnounceChannelId': '999',
  'calls.liveAnnounceEveryone': false,
  'calls.liveAnnounceDiscordTemplate': 'Live! {eventLink} {voiceChannel}[[ stream {streamLink}]] on {date}',
  'calls.liveAnnounceTelegramTemplate': 'TG live {eventLink}[[ stream {streamLink}]]',
  'calls.liveAnnounceXTemplate': 'X live {eventLink}[[ also {streamLink}]]',
  'calls.liveReminderTemplate': 'Reminder {eventLink}',
  'calls.liveTelegramCityKeys': [],
  'telegram.announceCityKeys': [],
}
const settings = (over: Record<string, unknown> = {}): Settings => ({ get: (k: string) => ({ ...DEFAULTS, ...over })[k], isSet: () => true, readFailed: false, invalidKeys: [] }) as unknown as Settings

function memStore() {
  const rows = new Map<string, AnnounceRow>()
  const sessionStream: Record<string, string> = {}
  const store: LiveStore = {
    get: async (k) => rows.get(k) ?? null,
    claim: async (r) => (rows.has(r.occurrenceKey) ? false : (rows.set(r.occurrenceKey, { ...r }), true)),
    update: async (k, d) => void Object.assign(rows.get(k)!, d),
    release: async (k) => void (rows.get(k)?.discordMessageId ? 0 : rows.delete(k)),
    claimReminder: async (k, now) => {
      const r = rows.get(k)
      if (!r || r.reminderQueuedAt) return false
      r.reminderQueuedAt = now
      return true
    },
    dueReminders: async (now, only) => [...rows.values()].filter((r) => !r.reminderQueuedAt && r.reminderDueAt <= now && (!only || r.occurrenceKey === only)),
    setSessionStream: async (id, l) => void (sessionStream[id] = l),
    recentRandomCities: async (n) => [...rows.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, n).map((r) => r.randomCityKey).filter((k): k is string => !!k),
  }
  return { store, rows, sessionStream }
}

function harness(over: Record<string, unknown> = {}, env: Record<string, string> = PROD) {
  const m = memStore()
  const postDiscord = vi.fn(async () => ({ id: '4242' }))
  const editDiscord = vi.fn(async () => undefined)
  const enqueue = vi.fn(async () => ({ queued: 2 }))
  const deps = { store: m.store, settings: settings(over), env, now: () => NOW, postDiscord, editDiscord, enqueue }
  return { ...m, postDiscord, editDiscord, enqueue, deps }
}

describe('renderTemplate', () => {
  it('fills placeholders and drops [[optional]] parts with an empty value', () => {
    expect(renderTemplate('A {x}[[ B {y}]]', { x: '1', y: '2' })).toBe('A 1 B 2')
    expect(renderTemplate('A {x}[[ B {y}]]', { x: '1', y: '' })).toBe('A 1')
    expect(renderTemplate('A {x} {nope}', { x: '1' })).toBe('A 1')
  })
})

describe('occurrence key and vars', () => {
  it('is the event plus the local day, else the session', () => {
    expect(occurrenceKey(CTX, PROD)).toBe('777:2026-11-15')
    expect(occurrenceKey({ eventId: null, sessionId: 's1', startedAt: START }, PROD)).toBe('session:s1')
    expect(occurrenceKey({ eventId: null, sessionId: null, startedAt: START }, PROD)).toBeNull()
  })
  it('builds links from the guild env; a channel mention only for Discord', () => {
    const row = { eventId: '777', voiceChannelId: '888', startedAt: START, streamLink: null }
    expect(buildVars(row, 'discord', PROD)).toMatchObject({ eventLink: 'https://discord.com/events/555/777', voiceChannel: '<#888>', streamLink: '' })
    expect(buildVars(row, 'plain', PROD).voiceChannel).toBe('https://discord.com/channels/555/888')
  })
})

describe('canRunLive', () => {
  it('admins, Roberts and host roles pass; others do not', () => {
    const base = { isAdmin: false, isRoberts: false, hostRoleSetting: '123456789012345678\n' }
    expect(canRunLive([], { ...base, isAdmin: true })).toBe(true)
    expect(canRunLive([], { ...base, isRoberts: true })).toBe(true)
    expect(canRunLive(['123456789012345678'], base)).toBe(true)
    expect(canRunLive(['999999999999999999'], base)).toBe(false)
    expect(canRunLive(['123456789012345678'], { ...base, hostRoleSetting: '' })).toBe(false)
  })
})

describe('runLiveAnnounce', () => {
  it('posts Discord + queues Telegram once, returns the X text, no @everyone by default', async () => {
    const h = harness()
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/abc' }, h.deps)
    expect(r.status).toBe('posted')
    expect(r.xText).toBe('X live https://discord.com/events/555/777 also https://x.com/i/broadcasts/abc')
    const [target, body] = h.postDiscord.mock.calls[0] as unknown as [{ channelId: string }, { content: string; allowed_mentions: unknown }]
    expect(target.channelId).toBe('999')
    expect(body.content).toContain('<#888>')
    expect(body.content).not.toContain('@everyone')
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'live', sourceId: '777:2026-11-15' }), PROD)
    expect(h.rows.get('777:2026-11-15')?.discordMessageId).toBe('4242')
    expect(h.sessionStream.s1).toBe('https://x.com/i/broadcasts/abc')
    expect(h.rows.get('777:2026-11-15')?.reminderDueAt).toEqual(new Date(NOW.getTime() + 180_000))
  })

  it('pings @everyone only when the setting is on', async () => {
    const h = harness({ 'calls.liveAnnounceEveryone': true })
    await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    const body = (h.postDiscord.mock.calls[0] as unknown as [unknown, { content: string; allowed_mentions: unknown }])[1]
    expect(body.content.startsWith('@everyone ')).toBe(true)
    expect(body.allowed_mentions).toEqual({ parse: ['everyone'] })
  })

  it('is idempotent: a second run (command or auto) posts nothing', async () => {
    const h = harness()
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    const again = await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    const third = await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    expect(again.status).toBe('already')
    expect(third.status).toBe('already')
    expect(h.postDiscord).toHaveBeenCalledTimes(1)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })

  it('two concurrent runs: only the claim winner posts', async () => {
    const h = harness()
    const [a, b] = await Promise.all([runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps), runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)])
    expect([a.status, b.status].sort()).toEqual(['already', 'posted'])
    expect(h.postDiscord).toHaveBeenCalledTimes(1)
  })

  it('a later /live with a stream link edits the Discord message, no new post; auto never overwrites a host link', async () => {
    const h = harness()
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/abc' }, h.deps)
    expect(r.status).toBe('edited')
    expect(h.postDiscord).toHaveBeenCalledTimes(1)
    const [t, body] = h.editDiscord.mock.calls[0] as unknown as [{ messageId: string; channelId: string }, { content: string }]
    expect(t).toMatchObject({ messageId: '4242', channelId: '999' })
    expect(body.content).toContain('stream https://x.com/i/broadcasts/abc')
    expect(h.rows.get('777:2026-11-15')?.streamLink).toBe('https://x.com/i/broadcasts/abc')
    await runLiveAnnounce({ mode: 'auto', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/zzz' }, h.deps)
    expect(h.editDiscord).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-X stream link (ignored)', async () => {
    const h = harness()
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX, streamLink: 'https://evil.example/i/broadcasts/abc' }, h.deps)
    expect(r.streamLink).toBeNull()
    expect((h.postDiscord.mock.calls[0] as unknown as [unknown, { content: string }])[1].content).not.toContain('stream')
  })

  it('toggles: each mode is off unless its own switch is on; the env kill switch wins', async () => {
    const a = harness({ 'calls.liveAnnounceCommandEnabled': false })
    expect((await runLiveAnnounce({ mode: 'command', ctx: CTX }, a.deps)).status).toBe('off')
    expect((await runLiveAnnounce({ mode: 'auto', ctx: CTX }, a.deps)).status).toBe('posted')
    const b = harness({ 'calls.liveAnnounceAutoEnabled': false })
    expect((await runLiveAnnounce({ mode: 'auto', ctx: CTX }, b.deps)).status).toBe('off')
    const c = harness({}, { ...PROD, CALL_LIVE_ANNOUNCE_COMMAND_ENABLED: 'off' })
    expect((await runLiveAnnounce({ mode: 'command', ctx: CTX }, c.deps)).status).toBe('off')
    expect(c.postDiscord).not.toHaveBeenCalled()
  })

  it('previews never post or claim, but still give the X text', async () => {
    const h = harness({}, { ...PROD, VERCEL_ENV: 'preview', CALL_LIVE_ANNOUNCE_COMMAND_ENABLED: 'on' })
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    expect(r.status).toBe('preview')
    expect(r.xText).toContain('X live')
    expect(h.postDiscord).not.toHaveBeenCalled()
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.rows.size).toBe(0)
  })

  it('no channel set: Telegram still queues, Discord is skipped', async () => {
    const h = harness({ 'calls.liveAnnounceChannelId': '' })
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    expect(r.discord).toBe('no-channel')
    expect(h.postDiscord).not.toHaveBeenCalled()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })

  it('a failed Discord post frees the claim so a retry can post, and queues no Telegram', async () => {
    const h = harness()
    h.postDiscord.mockRejectedValueOnce(new Error('boom'))
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    expect(r.status).toBe('error')
    expect(h.enqueue).not.toHaveBeenCalled()
    expect((await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)).status).toBe('posted')
  })

  it('no event and no session: nothing to key on', async () => {
    const h = harness()
    expect((await runLiveAnnounce({ mode: 'command', ctx: { ...CTX, eventId: null, sessionId: null } }, h.deps)).status).toBe('no-occurrence')
  })
})

describe('runLiveReminders', () => {
  it('queues the reminder once, only when due and switched on', async () => {
    const h = harness()
    await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    h.enqueue.mockClear()
    expect(await runLiveReminders(h.deps)).toBe(0) // not due yet (3 min)
    const later = { ...h.deps, now: () => new Date(NOW.getTime() + 4 * 60_000) }
    expect(await runLiveReminders(later)).toBe(1)
    expect(await runLiveReminders(later)).toBe(0)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'liverem', sourceId: '777:2026-11-15', text: 'Reminder https://discord.com/events/555/777' }), PROD)
  })

  it('is off with its switch, the env kill switch or on a preview', async () => {
    const h = harness({ 'calls.liveReminderEnabled': false })
    await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    const later = (d: typeof h.deps) => ({ ...d, now: () => new Date(NOW.getTime() + 4 * 60_000) })
    expect(await runLiveReminders(later(h.deps))).toBe(0)
    const k = harness({}, { ...PROD })
    await runLiveAnnounce({ mode: 'command', ctx: CTX }, k.deps)
    expect(await runLiveReminders(later({ ...k.deps, env: { ...PROD, CALL_LIVE_REMINDER_ENABLED: 'off' } }))).toBe(0)
    expect(await runLiveReminders(later({ ...k.deps, env: { ...PROD, VERCEL_ENV: 'preview' } }))).toBe(0)
  })
})

describe('liveAnnounceTick', () => {
  const session = { sessionId: 's1', eventId: '777', channelId: '888', crewId: 'community_call', hidden: false, endedAt: null, startedAt: START, streamLink: null }

  it('announces the Community Call automatically once, then fires the reminder', async () => {
    const h = harness()
    await liveAnnounceTick(session, h.deps)
    await liveAnnounceTick(session, h.deps)
    expect(h.postDiscord).toHaveBeenCalledTimes(1)
    await liveAnnounceTick(session, { ...h.deps, now: () => new Date(NOW.getTime() + 4 * 60_000) })
    expect((h.enqueue.mock.calls as unknown as Array<[{ kind: string }]>).map((c) => c[0].kind)).toEqual(['live', 'liverem'])
  })

  it('ignores other crews, hidden or ended sessions, old sessions and the off switch', async () => {
    const h = harness()
    await liveAnnounceTick({ ...session, crewId: 'ops' }, h.deps)
    await liveAnnounceTick({ ...session, hidden: true }, h.deps)
    await liveAnnounceTick({ ...session, endedAt: NOW }, h.deps)
    await liveAnnounceTick({ ...session, startedAt: new Date(NOW.getTime() - 60 * 60_000) }, h.deps)
    await liveAnnounceTick(null, h.deps)
    const off = harness({ 'calls.liveAnnounceAutoEnabled': false })
    await liveAnnounceTick(session, off.deps)
    expect(h.postDiscord).not.toHaveBeenCalled()
    expect(off.postDiscord).not.toHaveBeenCalled()
  })
})

describe('liveReplyText', () => {
  it('shows what was posted and the X text in a code block', () => {
    const r = liveReplyText({ status: 'posted', discord: 'posted', telegram: 'queued', telegramQueued: 2, xText: 'hello' })
    expect(r.body).toContain('Discord: posted')
    expect(r.body).toContain('queued for 2 groups')
    expect(r.body).toContain('```\nhello\n```')
  })
})


describe('review fixes', () => {
  const KEY = '777:2026-11-15'

  it('a failed bookkeeping write after a successful post keeps the claim and says so', async () => {
    const h = harness()
    const update = vi.spyOn(h.store, 'update').mockRejectedValueOnce(new Error('db down'))
    const release = vi.spyOn(h.store, 'release')
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)
    expect(update).toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    expect(r.status).toBe('posted')
    expect(r.note).toMatch(/could not be recorded/)
    expect(liveReplyText(r).body).toMatch(/could not be recorded/)
    expect((await runLiveAnnounce({ mode: 'command', ctx: CTX }, h.deps)).status).toBe('already')
    expect(h.postDiscord).toHaveBeenCalledTimes(1)
  })

  it('kicks the outbox after queueing, gives live and reminder rows an expiry, and holds the reminder until it is due', async () => {
    const h = harness()
    const kick = vi.fn(async () => undefined)
    await runLiveAnnounce({ mode: 'command', ctx: CTX }, { ...h.deps, kick })
    expect(kick).toHaveBeenCalledTimes(1)
    const live = (h.enqueue.mock.calls[0] as unknown as [{ expiresAt: Date }])[0]
    expect(live.expiresAt).toEqual(new Date(START.getTime() + 2 * 3_600_000))
    h.enqueue.mockClear()
    await runLiveReminders({ ...h.deps, kick, now: () => new Date(NOW.getTime() + 4 * 60_000) })
    const rem = (h.enqueue.mock.calls[0] as unknown as [{ kind: string; sendAfter: Date; expiresAt: Date }])[0]
    expect(rem.kind).toBe('liverem')
    expect(rem.sendAfter).toEqual(new Date(NOW.getTime() + 180_000))
    expect(rem.expiresAt).toEqual(new Date(START.getTime() + 2 * 3_600_000))
    expect(kick).toHaveBeenCalledTimes(2)
  })

  it('a lost claim race waits for the winner message id, then adds the stream link by editing', async () => {
    const h = harness()
    const winner: AnnounceRow = {
      occurrenceKey: KEY, eventId: '777', sessionId: 's1', voiceChannelId: '888', postedChannelId: '999', discordMessageId: null,
      streamLink: null, randomCityKey: null, source: 'auto', startedAt: START, reminderDueAt: NOW, reminderQueuedAt: null,
    }
    let gets = 0
    h.store.get = async () => {
      gets += 1
      if (gets === 1) return null
      if (gets <= 3) return { ...winner }
      return { ...winner, discordMessageId: '4242' }
    }
    h.store.claim = async () => false
    h.store.update = async () => undefined
    const sleep = vi.fn(async () => undefined)
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/abc' }, { ...h.deps, sleep })
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(r.status).toBe('edited')
    expect(h.postDiscord).not.toHaveBeenCalled()
    expect((h.editDiscord.mock.calls[0] as unknown as [{ messageId: string }])[0].messageId).toBe('4242')
  })

  it('a lost race without a stream link replies "already", and the wait is bounded', async () => {
    const h = harness()
    const winner = { occurrenceKey: KEY, eventId: '777', sessionId: 's1', voiceChannelId: '888', postedChannelId: null, discordMessageId: null, streamLink: null, randomCityKey: null, source: 'auto', startedAt: START, reminderDueAt: NOW, reminderQueuedAt: null }
    let first = true
    h.store.get = async () => (first ? ((first = false), null) : { ...winner })
    h.store.claim = async () => false
    const sleep = vi.fn(async () => undefined)
    const r = await runLiveAnnounce({ mode: 'command', ctx: CTX }, { ...h.deps, sleep })
    expect(r.status).toBe('already')
    expect(sleep.mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('only /live writes the session stream override, never the automatic path', async () => {
    const auto = harness()
    await runLiveAnnounce({ mode: 'auto', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/abc' }, auto.deps)
    expect(auto.sessionStream.s1).toBeUndefined()
    const cmd = harness()
    await runLiveAnnounce({ mode: 'command', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/abc' }, cmd.deps)
    expect(cmd.sessionStream.s1).toBe('https://x.com/i/broadcasts/abc')
    // And a later auto fill of a missing link on an existing row does not write it either.
    const later = harness()
    await runLiveAnnounce({ mode: 'command', ctx: CTX }, later.deps)
    await runLiveAnnounce({ mode: 'auto', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/abc' }, later.deps)
    expect(later.sessionStream.s1).toBeUndefined()
  })

  it('the occurrence day comes from the event scheduled start, not from now', () => {
    const late = new Date('2026-11-16T00:30:00Z') // already the next UTC day
    expect(occurrenceKey({ eventId: '777', sessionId: null, startedAt: late, dayAt: START }, PROD)).toBe(KEY)
  })

  it('a session without an event id shares the key with an earlier /live through the call-channel event', async () => {
    const h = harness()
    const ev = { id: '777', startsAt: START }
    const resolveEvent = vi.fn(async () => ev)
    // /live before the recorder: event + scheduled start, started "now" a day boundary later is irrelevant.
    await runLiveAnnounce({ mode: 'command', ctx: { eventId: '777', voiceChannelId: '888', sessionId: null, startedAt: NOW, dayAt: START } }, h.deps)
    const session = { sessionId: 's1', eventId: null, channelId: '888', crewId: 'community_call', hidden: false, endedAt: null, startedAt: NOW, streamLink: null }
    await liveAnnounceTick(session, { ...h.deps, resolveEvent })
    expect(resolveEvent).toHaveBeenCalledWith('888')
    expect(h.postDiscord).toHaveBeenCalledTimes(1) // auto found the /live row
    expect(h.rows.size).toBe(1)
  })

  it('/live outside a live session only announces the Community Call event', async () => {
    crewsMock.mockResolvedValue({ crews: [{ id: 'community_call', label: 'Community Call' }, { id: 'ops', label: 'Ops' }] })
    ;(currentCallEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: '777', name: 'Ops weekly', startsAt: START })
    expect(await resolveLiveContext(NOW)).toBeNull()
    ;(currentCallEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: '777', name: 'Community Call', startsAt: START })
    expect(await resolveLiveContext(NOW)).toMatchObject({ eventId: '777', dayAt: START, sessionId: null })
  })

  it('a session event is resolved only for the call channel and the Community Call event', async () => {
    crewsMock.mockResolvedValue({ crews: [{ id: 'community_call', label: 'Community Call' }] })
    ;(currentCallEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '777', name: 'Community Call', startsAt: START })
    expect(await resolveSessionEvent('1')).toEqual({ id: '777', startsAt: START }) // default call channel is mocked as '1'
    expect(await resolveSessionEvent('other')).toBeNull()
  })
})

describe('pickRandomCity', () => {
  it('avoids recent picks and the fixed groups', () => {
    for (let i = 0; i < 20; i++) expect(pickRandomCity(['a', 'b', 'c', 'd'], ['a', 'b'], ['c'], () => i / 20)).toBe('d')
  })
  it('avoids as many recent picks as it can when the pool is small', () => {
    expect(pickRandomCity(['a', 'b'], ['b', 'a'], [])).toBe('a')
    expect(pickRandomCity(['a', 'b'], ['a', 'b'], [])).toBe('b')
  })
  it('returns null for an empty pool or when only fixed groups remain', () => {
    expect(pickRandomCity([], [], [])).toBeNull()
    expect(pickRandomCity(['a'], [], ['A'])).toBeNull()
  })
})

describe('random city group', () => {
  const POOL = { 'calls.liveRandomCityKeys': ['paris', 'rome', 'oslo'], 'calls.liveRandomCityNoRepeat': 2 }
  const at = (n: number) => ({ ...CTX, eventId: `e${n}`, startedAt: new Date(START.getTime() + n * 86_400_000) })

  it('adds one pooled city to the queued post and stores it on the row', async () => {
    const h = harness(POOL)
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    const key = h.rows.get('777:2026-11-15')!.randomCityKey
    expect(['paris', 'rome', 'oslo']).toContain(key)
    expect((h.enqueue.mock.calls[0] as unknown as [object])[0]).toMatchObject({ kind: 'live', extraCityKeys: [key] })
  })
  it('excludes the cities of the last N calls', async () => {
    const h = harness(POOL)
    const picks: string[] = []
    for (let n = 0; n < 3; n++) {
      await runLiveAnnounce({ mode: 'auto', ctx: at(n) }, h.deps)
      picks.push([...h.rows.values()].find((r) => r.eventId === `e${n}`)!.randomCityKey!)
    }
    expect(new Set(picks).size).toBe(3)
  })
  it('never picks a city that is already in the fixed groups', async () => {
    const h = harness({ ...POOL, 'calls.liveTelegramCityKeys': ['paris', 'rome'] })
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    expect(h.rows.get('777:2026-11-15')!.randomCityKey).toBe('oslo')
  })
  it('is stable: a second run neither re-picks nor re-queues', async () => {
    const h = harness(POOL)
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    const first = h.rows.get('777:2026-11-15')!.randomCityKey
    await runLiveAnnounce({ mode: 'command', ctx: CTX, streamLink: 'https://x.com/i/broadcasts/abc' }, h.deps)
    expect(h.rows.get('777:2026-11-15')!.randomCityKey).toBe(first)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })
  it("keeps today's behaviour with an empty pool", async () => {
    const h = harness()
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    expect(h.rows.get('777:2026-11-15')!.randomCityKey).toBeNull()
    expect((h.enqueue.mock.calls[0] as unknown as [object])[0]).not.toHaveProperty('extraCityKeys')
  })
})

describe('stream link ask', () => {
  const ASK = { 'calls.liveStreamAskChannelId': '111', 'calls.liveStreamAskTemplate': 'Run /live please' }
  const asks = (h: ReturnType<typeof harness>) => h.postDiscord.mock.calls.filter((c) => (c as unknown as [{ channelId: string }])[0].channelId === '111')

  it('posts once on an auto announcement', async () => {
    const h = harness(ASK)
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, h.deps)
    expect(asks(h)).toHaveLength(1)
    expect((asks(h)[0] as unknown as [unknown, { content: string }])[1].content).toBe('Run /live please')
  })
  it('does not post for /live, with no channel, or on a preview', async () => {
    const a = harness(ASK)
    await runLiveAnnounce({ mode: 'command', ctx: CTX }, a.deps)
    expect(asks(a)).toHaveLength(0)
    const b = harness()
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, b.deps)
    expect(asks(b)).toHaveLength(0)
    const c = harness(ASK, { ...PROD, VERCEL_ENV: 'preview' })
    await runLiveAnnounce({ mode: 'auto', ctx: CTX }, c.deps)
    expect(c.postDiscord).not.toHaveBeenCalled()
  })
})
