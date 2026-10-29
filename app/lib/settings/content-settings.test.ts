// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { SETTINGS, parseSetting, type SettingKey } from './registry'
import { CONTENT_SETTINGS } from './content-settings'
import { clearSettingsCache, loadSettings, type Settings } from './index'
import { clearKnownOverrides, rememberOverride } from './known'
import { listChanges, listSettingViews, maskPrivate, ROLE_INCOME_NOT_IN_FORCE } from './store'
import { mafiaRanks, mafiaSources } from './mafia'
import { MAFIA_POINT_SOURCES, MAFIA_RANKS, getRankForPoints } from '@/app/lib/mafia-points/config'
import { DEFAULT_RECAP_LIMITS, buildRecapText, recapBullets, recapLimits } from '@/app/lib/calls/recap'
import { DEFAULT_AGENDA_LIMITS, agendaLeadMs, agendaLimits, buildAgendaBullets } from '@/app/lib/call-agenda/rank'
import { POST_LEAD_MS } from '@/app/lib/call-agenda/run'
import { DEFAULT_SUMMARY_MODEL, SUMMARY_SYSTEM_PROMPT, summaryModel, summarySystemPrompt } from '@/app/lib/calls/summarize'
import { clampBatch, DEFAULT_BATCH } from '@/app/lib/reengage/run'
import { isReengageSendDay } from '@/app/lib/reengage/send-day'
import { DEFAULT_WORK_PROMPTS, workPrompts } from '@/app/lib/pep-earn/work'
import { INACTIVE_MONTHS, MIN_CALLS_FOR_SUGGESTION, auditLevels } from '@/app/lib/roster-audit'
import { MAX_OPEN_TICKETS, MAX_TICKETS_PER_DAY } from '@/app/lib/support-tickets'
import { MAX_PENDING, MAX_SUBMISSIONS_PER_DAY } from '@/app/lib/spotlight'
import { cleanList, MAX_FILTER_ENTRIES } from '@/app/lib/calls/post-filter-lists'
import { loadPostFilter, clearPostFilterCache } from '@/app/lib/calls/post-filters'
import { CALL_WINDOW_MS } from '@/app/lib/reengage/digest'

const env = (o: Record<string, string> = {}) => o as unknown as NodeJS.ProcessEnv
const m = (f: unknown) => f as ReturnType<typeof vi.fn>

/** A snapshot with the given saved rows (and optionally a failed read or invalid keys). */
function snap(rows: Partial<Record<SettingKey, unknown>> = {}, opts: { readFailed?: boolean; invalid?: SettingKey[] } = {}): Settings {
  return {
    readFailed: opts.readFailed ?? false,
    invalidKeys: opts.invalid ?? [],
    isSet: (k) => !opts.readFailed && k in rows && !(opts.invalid ?? []).includes(k),
    get: ((k: SettingKey) => (k in rows ? rows[k] : SETTINGS[k].default)) as Settings['get'],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache({ all: true })
  clearKnownOverrides()
  clearPostFilterCache()
  vi.stubEnv('REENGAGE_BATCH_SIZE', '')
  vi.stubEnv('CALL_SUMMARY_MODEL', '')
  vi.stubEnv('WORK_PROMPTS_JSON', '')
  m(prisma.appSetting.findMany).mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())

describe('content settings: lock to today\'s values', () => {
  it('the defaults are today\'s constants', () => {
    const plain = Object.entries(CONTENT_SETTINGS)
      .filter(([k]) => !['calls.postFilter', 'work.prompts', 'mafia.sourcePoints', 'mafia.ranks'].includes(k))
      .map(([k, d]) => [k, d.default])
    expect(plain).toEqual([
      ['calls.recapMaxBullets', 5],
      ['calls.recapMaxActions', 5],
      ['calls.recapBulletChars', 220],
      ['calls.summaryModel', ''],
      ['calls.summaryPromptExtra', ''],
      ['calls.agendaLeadMinutes', 30],
      ['calls.agendaMaxBullets', 7],
      ['calls.agendaMaxTasks', 5],
      ['calls.agendaMaxFollowups', 2],
      ['calls.agendaItemChars', 110],
      ['reengage.batchSize', 60],
      ['reengage.callWindowDays', 7],
      ['reengage.sendWeekday', 2],
      ['spotlight.maxPerDay', 3],
      ['spotlight.maxPending', 5],
      ['support.maxTicketsPerDay', 5],
      ['support.maxOpenTickets', 10],
      ['roster.minCallsForSuggestion', 3],
      ['roster.inactiveMonths', 6],
      ['missions.celebrationMinLevel', 2],
    ])
    expect(SETTINGS['calls.postFilter'].default).toEqual({ excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] })
    expect(SETTINGS['work.prompts'].default).toEqual(DEFAULT_WORK_PROMPTS)
    expect(SETTINGS['mafia.sourcePoints'].default).toEqual(MAFIA_POINT_SOURCES.map((s) => ({ id: s.id, points: s.points })))
    expect(SETTINGS['mafia.ranks'].default).toEqual(MAFIA_RANKS)
  })

  it('with no saved rows (or no snapshot), every reader equals today\'s behaviour', () => {
    for (const s of [undefined, snap()]) {
      expect(recapLimits(s)).toEqual(DEFAULT_RECAP_LIMITS)
      expect(agendaLimits(s)).toEqual(DEFAULT_AGENDA_LIMITS)
      expect(agendaLeadMs(s)).toBe(POST_LEAD_MS)
      expect(summaryModel({}, s)).toBe(DEFAULT_SUMMARY_MODEL)
      expect(summarySystemPrompt(s)).toBe(SUMMARY_SYSTEM_PROMPT)
      expect(clampBatch(undefined, env(), s)).toBe(DEFAULT_BATCH)
      expect(isReengageSendDay(new Date('2026-11-03T16:00:00Z'), s)).toBe(true) // a Tuesday
      expect(isReengageSendDay(new Date('2026-11-04T16:00:00Z'), s)).toBe(false)
      expect(workPrompts(s)).toBe(DEFAULT_WORK_PROMPTS)
      expect(auditLevels(s)).toEqual({ minCalls: MIN_CALLS_FOR_SUGGESTION, inactiveMonths: INACTIVE_MONTHS })
      expect(mafiaSources(s)).toBe(MAFIA_POINT_SOURCES)
      expect(mafiaRanks(s)).toBe(MAFIA_RANKS)
    }
    expect(MAX_TICKETS_PER_DAY).toBe(SETTINGS['support.maxTicketsPerDay'].default)
    expect(MAX_OPEN_TICKETS).toBe(SETTINGS['support.maxOpenTickets'].default)
    expect(MAX_SUBMISSIONS_PER_DAY).toBe(SETTINGS['spotlight.maxPerDay'].default)
    expect(MAX_PENDING).toBe(SETTINGS['spotlight.maxPending'].default)
    expect(CALL_WINDOW_MS).toBe(SETTINGS['reengage.callWindowDays'].default * 24 * 60 * 60 * 1000)
  })

  it('output is unchanged at the defaults (recap and agenda)', () => {
    const summary = 'One sentence here. Two sentence here. Three sentence here. Four sentence here. Five sentence here. Six sentence here.'
    const rec = { id: 'r1', title: 'T', crewLabel: 'C', summary, actionItems: Array.from({ length: 7 }, (_, i) => ({ text: `Action ${i}` })) }
    expect(buildRecapText(rec, 'https://x.test', undefined, recapLimits(snap()))).toBe(buildRecapText(rec, 'https://x.test'))
    expect(recapBullets(summary, [], undefined, recapLimits(snap()))).toHaveLength(5)
  })
})

describe('content settings: saved values apply', () => {
  it('recap and agenda sizes follow the saved limits', () => {
    const summary = 'One sentence here. Two sentence here. Three sentence here. Four sentence here. Five sentence here.'
    const limits = recapLimits(snap({ 'calls.recapMaxBullets': 2, 'calls.recapMaxActions': 1, 'calls.recapBulletChars': 80 }))
    expect(limits).toEqual({ bullets: 2, actions: 1, chars: 80 })
    expect(recapBullets(summary, [], undefined, limits)).toHaveLength(2)
    const text = buildRecapText({ id: 'r1', title: 'T', crewLabel: 'C', summary, actionItems: [{ text: 'A1' }, { text: 'A2' }] }, 'https://x.test', undefined, limits)
    expect(text).toContain('A1')
    expect(text).not.toContain('A2')

    const tasks = Array.from({ length: 6 }, (_, i) => ({ label: `Task ${i}`, priority: 'Top', isActive: false, url: `https://t/${i}` })) as never
    const now = new Date('2026-11-01T12:00:00Z')
    expect(buildAgendaBullets({ tasks, now })).toHaveLength(5)
    expect(buildAgendaBullets({ tasks, now, limits: agendaLimits(snap({ 'calls.agendaMaxTasks': 2 })) })).toHaveLength(2)
    expect(buildAgendaBullets({ tasks, now, limits: agendaLimits(snap({ 'calls.agendaMaxBullets': 3 })) })).toHaveLength(3)
    expect(agendaLeadMs(snap({ 'calls.agendaLeadMinutes': 60 }))).toBe(60 * 60 * 1000)
  })

  it('the summary model: saved wins over env, env wins over the built-in, unreadable keeps the last saved one', () => {
    expect(summaryModel({ CALL_SUMMARY_MODEL: 'openai/gpt-x' }, snap())).toBe('openai/gpt-x')
    expect(summaryModel({ CALL_SUMMARY_MODEL: 'openai/gpt-x' }, snap({ 'calls.summaryModel': 'anthropic/claude-opus-5.5' }))).toBe('anthropic/claude-opus-5.5')
    expect(summaryModel({}, snap({ 'calls.summaryModel': '' }))).toBe(DEFAULT_SUMMARY_MODEL)
    expect(summaryModel({}, snap({}, { readFailed: true }))).toBe(DEFAULT_SUMMARY_MODEL)
    rememberOverride('calls.summaryModel', 'anthropic/claude-opus-5.5')
    expect(summaryModel({}, snap({}, { readFailed: true }))).toBe('anthropic/claude-opus-5.5')
  })

  it('the private addendum is appended after the built-in rules, and an unreadable one throws', async () => {
    expect(summarySystemPrompt(snap({ 'calls.summaryPromptExtra': '  Extra line.  ' }))).toBe(`${SUMMARY_SYSTEM_PROMPT}\n\nExtra line.`)
    expect(summarySystemPrompt(snap({ 'calls.summaryPromptExtra': '' }))).toBe(SUMMARY_SYSTEM_PROMPT)
    // An unreadable database: the real loader's failure mode is 'throw' for this key.
    m(prisma.appSetting.findMany).mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = await loadSettings()
    expect(s.readFailed).toBe(true)
    expect(() => summarySystemPrompt(s)).toThrow()
  })

  it('re-engagement batch size can only lower the legacy value', () => {
    expect(parseSetting('reengage.batchSize', 61).ok).toBe(false)
    expect(parseSetting('reengage.batchSize', 0).ok).toBe(false)
    expect(parseSetting('reengage.batchSize', 30).ok).toBe(true)
    expect(clampBatch(undefined, env(), snap({ 'reengage.batchSize': 30 }))).toBe(30)
    // env 200 is honoured with no row (as before) and capped by a saved lower value
    expect(clampBatch(undefined, env({ REENGAGE_BATCH_SIZE: '200' }), snap())).toBe(200)
    expect(clampBatch(undefined, env({ REENGAGE_BATCH_SIZE: '200' }), snap({ 'reengage.batchSize': 30 }))).toBe(30)
    // an env value that is already stricter than the saved one still wins
    expect(clampBatch(undefined, env({ REENGAGE_BATCH_SIZE: '10' }), snap({ 'reengage.batchSize': 50 }))).toBe(10)
    // an explicit ?limit= is capped by the saved ceiling too
    expect(clampBatch(500, env(), snap({ 'reengage.batchSize': 30 }))).toBe(30)
    expect(clampBatch(500, env(), snap())).toBe(300)
  })

  it('the send weekday follows the saved day', () => {
    const wed = new Date('2026-11-04T16:00:00Z')
    expect(isReengageSendDay(wed, snap({ 'reengage.sendWeekday': 3 }))).toBe(true)
    expect(isReengageSendDay(new Date('2026-11-03T16:00:00Z'), snap({ 'reengage.sendWeekday': 3 }))).toBe(false)
  })

  it('work replies: saved wins over WORK_PROMPTS_JSON, which wins over the built-ins', () => {
    vi.stubEnv('WORK_PROMPTS_JSON', JSON.stringify(['Env {amount}']))
    expect(workPrompts(snap())).toEqual(['Env {amount}'])
    expect(workPrompts(snap({ 'work.prompts': ['Saved {amount}'] }))).toEqual(['Saved {amount}'])
    expect(workPrompts(snap({}, { readFailed: true }))).toEqual(['Env {amount}'])
    rememberOverride('work.prompts', ['Last {amount}'])
    expect(workPrompts(snap({}, { readFailed: true }))).toEqual(['Last {amount}'])
  })

  it('roster audit levels and mafia tables follow saved rows', () => {
    expect(auditLevels(snap({ 'roster.minCallsForSuggestion': 5, 'roster.inactiveMonths': 12 }))).toEqual({ minCalls: 5, inactiveMonths: 12 })
    const sources = mafiaSources(snap({ 'mafia.sourcePoints': [{ id: 'pizza-pop', points: 1 }] }))
    expect(sources.find((s) => s.id === 'pizza-pop')?.points).toBe(1)
    expect(sources.find((s) => s.id === 'pizza-sticks')?.points).toBe(420)
    expect(sources).toHaveLength(MAFIA_POINT_SOURCES.length)
    const ranks = mafiaRanks(snap({ 'mafia.ranks': [{ name: 'Low', minPoints: 0 }, { name: 'High', minPoints: 10 }] }))
    expect(ranks.map((r) => r.name)).toEqual(['High', 'Low'])
    expect(getRankForPoints(10, ranks).name).toBe('High')
    expect(getRankForPoints(9, ranks).name).toBe('Low')
  })
})

describe('content settings: bounds', () => {
  const ok = (k: SettingKey, v: unknown) => parseSetting(k, v).ok
  it('numbers are bounded on both sides and whole', () => {
    const cases: Array<[SettingKey, number, number]> = [
      ['calls.recapMaxBullets', 1, 10], ['calls.recapMaxActions', 1, 10], ['calls.recapBulletChars', 80, 400],
      ['calls.agendaLeadMinutes', 10, 120], ['calls.agendaMaxBullets', 1, 10], ['calls.agendaMaxTasks', 1, 10],
      ['calls.agendaMaxFollowups', 0, 5], ['calls.agendaItemChars', 40, 200],
      ['reengage.callWindowDays', 1, 30], ['reengage.sendWeekday', 0, 6],
      ['spotlight.maxPerDay', 1, 10], ['spotlight.maxPending', 1, 20],
      ['support.maxTicketsPerDay', 1, 20], ['support.maxOpenTickets', 1, 50],
      ['roster.minCallsForSuggestion', 1, 20], ['roster.inactiveMonths', 1, 24], ['missions.celebrationMinLevel', 1, 10],
    ]
    for (const [k, lo, hi] of cases) {
      expect(ok(k, lo), `${k} min`).toBe(true)
      expect(ok(k, hi), `${k} max`).toBe(true)
      expect(ok(k, lo - 1), `${k} below`).toBe(false)
      expect(ok(k, hi + 1), `${k} above`).toBe(false)
      expect(ok(k, lo + 0.5), `${k} fraction`).toBe(false)
    }
  })

  it('the summary model must look like provider/model from a known provider', () => {
    expect(ok('calls.summaryModel', '')).toBe(true)
    expect(ok('calls.summaryModel', 'anthropic/claude-sonnet-5.5')).toBe(true)
    expect(ok('calls.summaryModel', 'claude-sonnet-5.5')).toBe(false)
    expect(ok('calls.summaryModel', 'evil/model')).toBe(false)
    expect(ok('calls.summaryModel', 'anthropic/a b')).toBe(false)
    expect(ok('calls.summaryPromptExtra', 'x'.repeat(2000))).toBe(true)
    expect(ok('calls.summaryPromptExtra', 'x'.repeat(2001))).toBe(false)
  })

  it('lists have a length and per-entry limit', () => {
    expect(ok('work.prompts', [])).toBe(false)
    expect(ok('work.prompts', Array.from({ length: 21 }, () => 'a'))).toBe(false)
    expect(ok('work.prompts', ['a {amount}'])).toBe(true)
    expect(ok('work.prompts', ['x'.repeat(501)])).toBe(false)
    expect(ok('mafia.sourcePoints', [{ id: 'nope', points: 1 }])).toBe(false)
    expect(ok('mafia.sourcePoints', [{ id: 'pizza-pop', points: -1 }])).toBe(false)
    expect(ok('mafia.sourcePoints', [{ id: 'pizza-pop', points: 1_000_001 }])).toBe(false)
    expect(ok('mafia.sourcePoints', [{ id: 'pizza-pop', points: 5 }, { id: 'pizza-pop', points: 6 }])).toBe(false)
    expect(ok('mafia.sourcePoints', [])).toBe(false)
    expect(ok('mafia.ranks', [{ name: 'A', minPoints: 5 }])).toBe(false) // no tier at 0
    expect(ok('mafia.ranks', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 0 }])).toBe(false)
    expect(ok('mafia.ranks', [{ name: 'A', minPoints: 0 }, { name: 'a', minPoints: 5 }])).toBe(false)
    expect(ok('mafia.ranks', Array.from({ length: 13 }, (_, i) => ({ name: `R${i}`, minPoints: i })))).toBe(false)
    expect(ok('mafia.ranks', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 10_000_001 }])).toBe(false)
    expect(ok('mafia.ranks', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 5 }])).toBe(true)
  })

  it('the post filter lists are bounded and cleaned', () => {
    const f = (o: Record<string, unknown>) => ({ excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], ...o })
    expect(ok('calls.postFilter', f({}))).toBe(true)
    expect(ok('calls.postFilter', f({ blockedTerms: Array.from({ length: MAX_FILTER_ENTRIES + 1 }, (_, i) => `t${i}`) }))).toBe(false)
    expect(ok('calls.postFilter', f({ blockedTerms: ['x'.repeat(101)] }))).toBe(false)
    expect(ok('calls.postFilter', f({ blockedTerms: 'nope' }))).toBe(false)
    expect(parseSetting('calls.postFilter', f({ blockedTerms: [' a ', 'A', 'b'] }))).toEqual({ ok: true, value: f({ blockedTerms: ['a', 'b'] }) })
    expect(cleanList([' a ', 'A'])).toEqual(['a'])
  })
})

describe('private settings', () => {
  it('are marked private and fail closed when unreadable', () => {
    expect(SETTINGS['calls.summaryPromptExtra'].private).toBe(true)
    expect(SETTINGS['calls.postFilter'].private).toBe(true)
    expect(SETTINGS['calls.summaryPromptExtra'].onReadFailure).toBe('throw')
    expect(SETTINGS['calls.postFilter'].onReadFailure).toBe('throw')
  })

  it('are masked in the admin views and the audit history', async () => {
    const text = 'sample-private-text'
    const filter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ['sample-term'] }
    const at = new Date('2026-11-01T00:00:00Z')
    m(prisma.appSetting.findMany).mockResolvedValue([
      { key: 'calls.summaryPromptExtra', value: text, updatedAt: at, updatedBy: 'x' },
      { key: 'calls.postFilter', value: filter, updatedAt: at, updatedBy: 'x' },
    ])
    const views = await listSettingViews()
    const json = JSON.stringify(views.filter((v) => v.key === 'calls.summaryPromptExtra' || v.key === 'calls.postFilter'))
    expect(json).not.toContain(text)
    expect(json).not.toContain('sample-term')
    expect(views.find((v) => v.key === 'calls.summaryPromptExtra')).toMatchObject({ value: 'set', override: 'set', default: 'not set', private: true })
    expect(views.find((v) => v.key === 'calls.postFilter')).toMatchObject({ value: 'set', override: 'set', default: 'not set', private: true })

    m(prisma.appSettingChange.findMany).mockResolvedValue([
      { id: 1, key: 'calls.summaryPromptExtra', oldValue: null, newValue: text, changedBy: 'x', changedAt: at, note: null },
      { id: 2, key: 'calls.postFilter', oldValue: null, newValue: filter, changedBy: 'x', changedAt: at, note: null },
    ])
    const rows = await listChanges()
    expect(JSON.stringify(rows)).not.toContain(text)
    expect(JSON.stringify(rows)).not.toContain('sample-term')
    expect(rows[0]).toMatchObject({ newValue: 'set' })
    expect(rows[1]).toMatchObject({ newValue: 'set' })
  })

  it('maskPrivate on a group of lists', () => {
    expect(maskPrivate({ a: [], b: [] })).toBe('not set')
    expect(maskPrivate({ a: [], b: ['x'] })).toBe('set')
  })
})

describe('call post filter: settings first, the table until then, and fail closed', () => {
  const at = new Date('2026-11-01T00:00:00Z')
  const f = { excludedCrewIds: ['crew_a'], excludedCrewLabelTerms: [], blockedTerms: ['term-a'] }
  it('uses the table while the setting has no row', async () => {
    m(prisma.callPostFilter.findUnique).mockResolvedValue({ id: 1, excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ['from-table'] })
    expect((await loadPostFilter()).blockedTerms).toEqual(['from-table'])
  })
  it('uses the saved setting once it exists (the table is not read)', async () => {
    m(prisma.appSetting.findMany).mockResolvedValue([{ key: 'calls.postFilter', value: f, updatedAt: at, updatedBy: 'x' }])
    expect(await loadPostFilter()).toEqual({ ...f, excludedCrewLabelTerms: [] })
    expect(prisma.callPostFilter.findUnique).not.toHaveBeenCalled()
  })
  it('throws when the settings cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    m(prisma.appSetting.findMany).mockRejectedValue(new Error('db down'))
    m(prisma.callPostFilter.findUnique).mockResolvedValue(null)
    await expect(loadPostFilter()).rejects.toThrow()
  })
  it('throws when the saved value is invalid, rather than falling back to the table', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    m(prisma.appSetting.findMany).mockResolvedValue([{ key: 'calls.postFilter', value: { blockedTerms: 'nope' }, updatedAt: at, updatedBy: 'x' }])
    m(prisma.callPostFilter.findUnique).mockResolvedValue(null)
    await expect(loadPostFilter()).rejects.toThrow()
  })
  it('throws when there is no saved row and the table cannot be read', async () => {
    m(prisma.callPostFilter.findUnique).mockRejectedValue(new Error('db down'))
    await expect(loadPostFilter()).rejects.toThrow('db down')
  })
})

describe('role income: a saved table that no longer validates is flagged loudly', () => {
  it('adds a warning to the admin row and keeps the env/built-in value shown', async () => {
    const at = new Date('2026-11-01T00:00:00Z')
    // A row that cannot pass today's stricter-only check (it pays more than the built-in table).
    m(prisma.appSetting.findMany).mockResolvedValue([
      { key: 'economy.roleIncome', value: [{ name: 'Crew Member', amount: 9999, intervalHours: 24 }], updatedAt: at, updatedBy: 'x' },
    ])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const v = (await listSettingViews()).find((s) => s.key === 'economy.roleIncome')!
    expect(v.invalid).toBe(true)
    expect(v.warning).toBe(ROLE_INCOME_NOT_IN_FORCE)
    expect(v.warning).toMatch(/NOT in force/)
    expect(v.warning).toMatch(/env table applies/)
    // and the value shown is the table that applies (not the saved one)
    expect(JSON.stringify(v.value)).not.toContain('9999')
  })
  it('has no warning for a valid saved table or no row', async () => {
    m(prisma.appSetting.findMany).mockResolvedValue([])
    const v = (await listSettingViews()).find((s) => s.key === 'economy.roleIncome')!
    expect(v.warning).toBeUndefined()
  })
})
