// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { Settings } from '@/app/lib/settings'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: vi.fn() }))

import {
  buildVars,
  canRunLive,
  liveAnnounceTick,
  occurrenceKey,
  renderTemplate,
  runLiveAnnounce,
  runLiveReminders,
  type AnnounceRow,
  type LiveStore,
} from './live-announce'
import { liveReplyText } from './live-announce-command'

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
