// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { Settings } from '@/app/lib/settings'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn() }))
vi.mock('@/app/lib/settings', async (orig) => ({ ...(await orig<typeof import('@/app/lib/settings')>()), loadSettings: vi.fn(async () => ({})) }))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: vi.fn(), processOutbox: vi.fn(), targetCityKeys: vi.fn() }))

import { releaseWelcomeForSession, renderWelcome, safeHttpsUrl, welcomeDate, welcomeOrderForSession, type WelcomeSession, type WelcomeStore } from './welcome'

const PROD = { VERCEL_ENV: 'production', ANNOUNCE_TIMEZONE: 'UTC' }
const START = new Date('2026-11-15T20:00:00Z')
const TEMPLATE = "Welcome to the {date} {call}![[ We'll be following the [agenda](<{agenda}>).]][[ We're also streaming on X: {stream}]]"
const AGENDA = 'https://docs.google.com/spreadsheets/d/abc/edit?gid=0#gid=0'
const STREAM = 'https://x.com/i/broadcasts/1abc'

const DEFAULTS: Record<string, unknown> = {
  'calls.startWelcomeEnabled': true,
  'calls.startWelcomeCrews': ['community_call'],
  'calls.startWelcomeTemplate': TEMPLATE,
  'calls.startWelcomeWaitMinutes': 20,
  'calls.startWelcomeWithoutStream': true,
  'calls.liveStreamLinks': '',
}
const settings = (over: Record<string, unknown> = {}): Settings => ({ get: (k: string) => ({ ...DEFAULTS, ...over })[k], isSet: () => true, readFailed: false, invalidKeys: [] }) as unknown as Settings

const session = (over: Partial<WelcomeSession> = {}): WelcomeSession => ({
  sessionId: 's1',
  eventId: '777',
  eventName: 'Community Call - Nov 15',
  channelId: '888',
  crewId: 'community_call',
  crewLabel: 'Community Call',
  hidden: false,
  endedAt: null,
  startedAt: START,
  streamLink: null,
  streamLinkOverride: null,
  ...over,
})

function harness(over: Record<string, unknown> = {}, minutesIn = 1, env: Record<string, string> = PROD) {
  const claimed = new Set<string>()
  const store: WelcomeStore = {
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    release: async (k) => void claimed.delete(k),
  }
  const deps = { store, settings: settings(over), env, now: () => new Date(START.getTime() + minutesIn * 60_000), agendaFor: async () => AGENDA }
  return { deps, claimed }
}

describe('renderWelcome', () => {
  const vars = { date: 'November 15, 2026', call: 'Community Call', agenda: AGENDA, stream: STREAM }
  it('fills every placeholder and links the agenda as markdown', () => {
    expect(renderWelcome(TEMPLATE, vars)).toBe(
      `Welcome to the November 15, 2026 Community Call! We'll be following the [agenda](<${AGENDA}>). We're also streaming on X: ${STREAM}`,
    )
  })
  it('drops a sentence whose placeholder is empty and never leaves a raw placeholder', () => {
    expect(renderWelcome(TEMPLATE, { ...vars, stream: '' })).toBe(`Welcome to the November 15, 2026 Community Call! We'll be following the [agenda](<${AGENDA}>).`)
    expect(renderWelcome(TEMPLATE, { ...vars, agenda: '' })).toBe(`Welcome to the November 15, 2026 Community Call! We're also streaming on X: ${STREAM}`)
    expect(renderWelcome('Hi {nope} {stream}', { ...vars, stream: '' })).toBe('Hi')
    expect(renderWelcome(TEMPLATE, vars)).not.toMatch(/\{\w+\}/)
  })
})

describe('helpers', () => {
  it('formats the date as Month D, YYYY in the calls time zone', () => {
    expect(welcomeDate(START, { ANNOUNCE_TIMEZONE: 'UTC' })).toBe('November 15, 2026')
    expect(welcomeDate(new Date('2026-11-16T02:00:00Z'), { ANNOUNCE_TIMEZONE: 'America/New_York' })).toBe('November 15, 2026')
  })
  it('only lets https links without spaces or angle brackets into the agenda link', () => {
    expect(safeHttpsUrl(AGENDA)).toBe(AGENDA)
    expect(safeHttpsUrl('http://x.test')).toBe('')
    expect(safeHttpsUrl('https://x.test/a>b')).toBe('')
    expect(safeHttpsUrl('not a url')).toBe('')
    expect(safeHttpsUrl(undefined)).toBe('')
  })
})

describe('welcomeOrderForSession', () => {
  it('waits for the stream link, then posts with it', async () => {
    const h = harness()
    expect(await welcomeOrderForSession(session(), h.deps)).toBeNull()
    const out = await welcomeOrderForSession(session({ streamLinkOverride: STREAM }), h.deps)
    expect(out?.content).toContain(`streaming on X: ${STREAM}`)
    expect(out?.content).toContain(`[agenda](<${AGENDA}>)`)
    expect(out?.content).toContain('Welcome to the November 15, 2026 Community Call!')
  })

  it('uses a link found in the call chat too', async () => {
    const out = await welcomeOrderForSession(session({ streamLink: STREAM }), harness().deps)
    expect(out?.content).toContain(STREAM)
  })

  it('posts exactly once per occurrence, also for a restarted recorder (new session, same event and day)', async () => {
    const h = harness()
    expect(await welcomeOrderForSession(session({ streamLink: STREAM }), h.deps)).not.toBeNull()
    expect(await welcomeOrderForSession(session({ streamLink: STREAM }), h.deps)).toBeNull()
    expect(await welcomeOrderForSession(session({ sessionId: 's2', streamLink: STREAM }), h.deps)).toBeNull()
  })

  it('falls back to a welcome without the X sentence after the wait', async () => {
    const out = await welcomeOrderForSession(session(), harness({}, 21).deps)
    expect(out?.content).toBe(`Welcome to the November 15, 2026 Community Call! We'll be following the [agenda](<${AGENDA}>).`)
  })

  it('posts nothing without a stream link when that is switched off', async () => {
    expect(await welcomeOrderForSession(session(), harness({ 'calls.startWelcomeWithoutStream': false }, 60).deps)).toBeNull()
  })

  it('omits the agenda sentence when the call has no agenda link', async () => {
    const h = harness()
    const out = await welcomeOrderForSession(session({ streamLink: STREAM }), { ...h.deps, agendaFor: async () => '' })
    expect(out?.content).toBe(`Welcome to the November 15, 2026 Community Call! We're also streaming on X: ${STREAM}`)
  })

  it('is off unless switched on, for other calls, previews, hidden and ended sessions, and stale ones', async () => {
    const s = session({ streamLink: STREAM })
    expect(await welcomeOrderForSession(s, harness({ 'calls.startWelcomeEnabled': false }).deps)).toBeNull()
    expect(await welcomeOrderForSession(session({ streamLink: STREAM, crewId: 'tech' }), harness().deps)).toBeNull()
    expect(await welcomeOrderForSession(session({ streamLink: STREAM, crewId: 'tech' }), harness({ 'calls.startWelcomeCrews': ['tech'] }).deps)).not.toBeNull()
    expect(await welcomeOrderForSession(s, harness({}, 1, { ANNOUNCE_TIMEZONE: 'UTC' }).deps)).toBeNull()
    expect(await welcomeOrderForSession(session({ streamLink: STREAM, hidden: true }), harness().deps)).toBeNull()
    expect(await welcomeOrderForSession(session({ streamLink: STREAM, endedAt: START }), harness().deps)).toBeNull()
    expect(await welcomeOrderForSession(s, harness({}, 4 * 60).deps)).toBeNull()
    expect(await welcomeOrderForSession(null, harness().deps)).toBeNull()
  })

  it('a failed post is released and handed out again', async () => {
    const h = harness()
    const s = session({ streamLink: STREAM })
    expect(await welcomeOrderForSession(s, h.deps)).not.toBeNull()
    await releaseWelcomeForSession(s, h.deps)
    expect(await welcomeOrderForSession(s, h.deps)).not.toBeNull()
  })

  it('never throws', async () => {
    const h = harness()
    const store: WelcomeStore = { claim: async () => { throw new Error('db down') }, release: async () => undefined }
    expect(await welcomeOrderForSession(session({ streamLink: STREAM }), { ...h.deps, store })).toBeNull()
  })
})
