// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { SETTINGS, parseSetting, type SettingKey } from './registry'
import { ECONOMY_SETTINGS, roleIncomeDailyTotal } from './economy-settings'
import { clearKnownOverrides, rememberOverride } from './known'
import { effectiveInt, envNumber } from './numbers'
import type { Settings } from './index'
import { gameConfig, assertBet } from '@/app/lib/pep-games/config'
import { crimeConfig } from '@/app/lib/pep-earn/crime'
import { workConfig } from '@/app/lib/pep-earn/work'
import { DEFAULT_ROLE_INCOME, roleIncomeConfig } from '@/app/lib/pep-earn/income'
import { adminGrantMax } from '@/app/lib/pep-admin'
import { dailyCap, maxGasGwei, minBalanceWei } from '@/app/lib/slices/config'
import { RATE_LIMITS } from '@/app/lib/rate-limit'

/** A snapshot with the given saved rows (and optionally a failed read or invalid keys). */
function snap(rows: Partial<Record<SettingKey, unknown>> = {}, opts: { readFailed?: boolean; invalid?: SettingKey[] } = {}): Settings {
  return {
    readFailed: opts.readFailed ?? false,
    invalidKeys: opts.invalid ?? [],
    isSet: (k) => !opts.readFailed && k in rows && !(opts.invalid ?? []).includes(k),
    get: ((k: SettingKey) => (k in rows ? rows[k] : SETTINGS[k].default)) as Settings['get'],
  }
}

const ENV_NAMES = [
  'GAME_MIN_BET', 'GAME_MAX_BET', 'GAME_COOLDOWN_SECONDS', 'BLACKJACK_TIMEOUT_SECONDS',
  'CRIME_MIN_PEP', 'CRIME_MAX_PEP', 'CRIME_FAIL_PERCENT', 'CRIME_FINE_MIN_PERCENT', 'CRIME_FINE_MAX_PERCENT', 'CRIME_COOLDOWN_SECONDS',
  'WORK_MIN_PEP', 'WORK_MAX_PEP', 'WORK_COOLDOWN_SECONDS', 'ROLE_INCOME_JSON', 'ADMIN_GRANT_MAX', 'JOB_REWARD_AMOUNT',
  'MISSIONS_RUN_PEP_ALERT', 'SLICES_DAILY_CAP', 'SLICES_MAX_GAS_GWEI', 'SLICES_MIN_BALANCE_ETH',
  'MAFIA_PORTRAIT_DAILY_CAP', 'MAFIA_PORTRAIT_PUBLIC_DAILY_CAP',
]

beforeEach(() => {
  for (const n of ENV_NAMES) vi.stubEnv(n, '')
  clearKnownOverrides()
})
afterEach(() => vi.unstubAllEnvs())

describe('economy settings: lock to today\'s values', () => {
  it('the defaults are today\'s constants (a change here is a deliberate, reviewed change)', () => {
    expect(Object.entries(ECONOMY_SETTINGS).filter(([k]) => k !== 'economy.roleIncome').map(([k, d]) => [k, d.default])).toEqual([
      ['games.minBet', 10],
      ['games.maxBet', 5000],
      ['games.cooldownSeconds', 3],
      ['games.blackjackTimeoutSeconds', 300],
      ['crime.minPep', 2],
      ['crime.maxPep', 420],
      ['crime.failPercent', 60],
      ['crime.fineMinPercent', 5],
      ['crime.fineMaxPercent', 55],
      ['crime.cooldownSeconds', 30],
      ['work.minPep', 10],
      ['work.maxPep', 100],
      ['work.cooldownSeconds', 30],
      ['economy.jobRewardAmount', 50],
      ['economy.dailyJobsCount', 3],
      ['economy.adminGrantMax', 10_000],
      ['missions.runPepAlert', 50_000],
      ['slices.dailyCap', 1000],
      ['slices.maxGasMilliGwei', 500],
      ['slices.minBalanceMilliEth', 3],
      ['portrait.dailyCap', 300],
      ['portrait.publicDailyCap', 100],
    ])
    expect(SETTINGS['economy.roleIncome'].default).toEqual(DEFAULT_ROLE_INCOME)
    expect(SETTINGS['portrait.publicDailyCap'].default).toBe(RATE_LIMITS['mafia-portrait-public'].limit)
    expect(SETTINGS['portrait.dailyCap'].default).toBe(RATE_LIMITS['mafia-portrait-global'].limit)
  })

  it('with no saved rows and no env, every config equals today\'s behaviour', () => {
    for (const s of [undefined, snap()]) {
      expect(gameConfig(s)).toEqual({ minBet: 10, maxBet: 5000, cooldownMs: 3000, blackjackTimeoutMs: 300_000 })
      expect(crimeConfig(s)).toEqual({ min: 2, max: 420, failPercent: 60, fineMinPercent: 5, fineMaxPercent: 55, cooldownMs: 30_000 })
      expect(workConfig(s)).toEqual({ min: 10, max: 100, cooldownMs: 30_000 })
      expect(roleIncomeConfig(undefined, s)).toBe(DEFAULT_ROLE_INCOME)
      expect(adminGrantMax({}, s)).toBe(10_000)
      expect(effectiveInt('economy.jobRewardAmount', s)).toBe(50)
      expect(effectiveInt('economy.dailyJobsCount', s)).toBe(3)
      expect(effectiveInt('missions.runPepAlert', s)).toBe(50_000)
      expect(dailyCap({} as NodeJS.ProcessEnv, s)).toBe(1000)
      expect(maxGasGwei({} as NodeJS.ProcessEnv, s)).toBe(0.5)
      expect(minBalanceWei({} as NodeJS.ProcessEnv, s)).toBe(BigInt('3000000000000000'))
    }
  })

  it('env values stay in force while no row is saved (the legacy value)', () => {
    vi.stubEnv('GAME_MAX_BET', '1000')
    vi.stubEnv('CRIME_MAX_PEP', '100')
    vi.stubEnv('WORK_COOLDOWN_SECONDS', '60')
    vi.stubEnv('JOB_REWARD_AMOUNT', '20')
    expect(gameConfig(snap()).maxBet).toBe(1000)
    expect(crimeConfig(snap()).max).toBe(100)
    expect(workConfig(snap()).cooldownMs).toBe(60_000)
    expect(effectiveInt('economy.jobRewardAmount', snap(), envNumber('20'))).toBe(20)
    // an env value above the code default is still honoured with no row (as before)
    vi.stubEnv('GAME_MAX_BET', '9000')
    expect(gameConfig(snap()).maxBet).toBe(9000)
  })
})

describe('economy settings: bounds', () => {
  it('every payout, cap and limit is stricter-only: only tighter values are accepted', () => {
    const tighter: Array<[SettingKey, number, number]> = [
      // key, a looser value (rejected), a tighter value (accepted)
      ['games.maxBet', 5001, 100],
      ['games.cooldownSeconds', 2, 10],
      ['crime.minPep', 3, 1],
      ['crime.maxPep', 421, 100],
      ['crime.failPercent', 59, 80],
      ['crime.fineMinPercent', 4, 10],
      ['crime.fineMaxPercent', 54, 70],
      ['crime.cooldownSeconds', 29, 60],
      ['work.minPep', 11, 5],
      ['work.maxPep', 101, 50],
      ['work.cooldownSeconds', 29, 60],
      ['economy.jobRewardAmount', 51, 25],
      ['economy.dailyJobsCount', 4, 1],
      ['economy.adminGrantMax', 10_001, 500],
      ['missions.runPepAlert', 50_001, 1000],
      ['slices.dailyCap', 1001, 10],
      ['slices.maxGasMilliGwei', 501, 100],
      ['slices.minBalanceMilliEth', 2, 10],
      ['portrait.dailyCap', 301, 50],
      ['portrait.publicDailyCap', 101, 20],
    ]
    for (const [key, loose, tight] of tighter) {
      expect(SETTINGS[key].stricterOnly, key).toBe(true)
      expect(parseSetting(key, loose).ok, `${key} ${loose}`).toBe(false)
      expect(parseSetting(key, tight).ok, `${key} ${tight}`).toBe(true)
    }
  })

  it('rejects fractions, strings, zero and negatives', () => {
    for (const bad of [1.5, '5', 0, -1, null, NaN]) expect(parseSetting('games.maxBet', bad).ok).toBe(false)
  })

  it('the two knobs with no spend risk take the full range', () => {
    expect(parseSetting('games.minBet', 1).ok).toBe(true)
    expect(parseSetting('games.minBet', 1000).ok).toBe(true)
    expect(parseSetting('games.minBet', 1001).ok).toBe(false)
    expect(parseSetting('games.blackjackTimeoutSeconds', 29).ok).toBe(false)
    expect(parseSetting('games.blackjackTimeoutSeconds', 3600).ok).toBe(true)
    expect(SETTINGS['games.minBet'].stricterOnly).toBeFalsy()
  })
})

describe('economy settings: effective values', () => {
  it('a saved cap tightens, never loosens, an env value', () => {
    // saved 100 < env 1000: the saved value wins
    vi.stubEnv('GAME_MAX_BET', '1000')
    expect(gameConfig(snap({ 'games.maxBet': 100 })).maxBet).toBe(100)
    // saved 3000 > env 1000: the env value stays
    expect(gameConfig(snap({ 'games.maxBet': 3000 })).maxBet).toBe(1000)
    // lower-is-looser knobs go the other way
    vi.stubEnv('CRIME_COOLDOWN_SECONDS', '120')
    expect(crimeConfig(snap({ 'crime.cooldownSeconds': 600 })).cooldownMs).toBe(600_000)
    expect(crimeConfig(snap({ 'crime.cooldownSeconds': 45 })).cooldownMs).toBe(120_000)
  })

  it('a saved two-way knob replaces the env value', () => {
    vi.stubEnv('GAME_MIN_BET', '50')
    expect(gameConfig(snap({ 'games.minBet': 5 })).minBet).toBe(5)
  })

  it('keeps the largest bet at or above the smallest', () => {
    expect(gameConfig(snap({ 'games.minBet': 500, 'games.maxBet': 100 }))).toMatchObject({ minBet: 500, maxBet: 500 })
    expect(crimeConfig(snap({ 'crime.fineMinPercent': 90 }))).toMatchObject({ fineMinPercent: 90, fineMaxPercent: 90 })
  })

  it('assertBet follows the saved limits', () => {
    const cfg = gameConfig(snap({ 'games.maxBet': 100, 'games.minBet': 20 }))
    expect(() => assertBet(100, cfg)).not.toThrow()
    expect(() => assertBet(101, cfg)).toThrow(/Bet must be/)
    expect(() => assertBet(19, cfg)).toThrow(/Bet must be/)
  })

  it('unreadable settings: the last saved value, then env, then the default', () => {
    const failed = snap({}, { readFailed: true })
    expect(workConfig(failed).max).toBe(100)
    rememberOverride('work.maxPep', 40)
    expect(workConfig(failed).max).toBe(40)
    // an invalid stored value behaves the same way
    const invalid = snap({ 'work.maxPep': 9999 }, { invalid: ['work.maxPep'] })
    expect(workConfig(invalid).max).toBe(40)
    // with nothing remembered, the env value stays in force
    clearKnownOverrides()
    vi.stubEnv('WORK_MAX_PEP', '60')
    expect(workConfig(failed).max).toBe(60)
  })

  it('admin grant cap: lower of env/default and the saved value', () => {
    expect(adminGrantMax({ ADMIN_GRANT_MAX: '500' }, snap({ 'economy.adminGrantMax': 2000 }))).toBe(500)
    expect(adminGrantMax({ ADMIN_GRANT_MAX: '5000' }, snap({ 'economy.adminGrantMax': 2000 }))).toBe(2000)
    expect(adminGrantMax({}, snap({ 'economy.adminGrantMax': 2000 }))).toBe(2000)
    expect(adminGrantMax({ ADMIN_GRANT_MAX: 'lots' }, snap())).toBe(10_000)
  })

  it('slices caps tighten the env value only', () => {
    const s = snap({ 'slices.dailyCap': 100, 'slices.maxGasMilliGwei': 200, 'slices.minBalanceMilliEth': 10 })
    expect(dailyCap({} as NodeJS.ProcessEnv, s)).toBe(100)
    expect(dailyCap({ SLICES_DAILY_CAP: '50' } as unknown as NodeJS.ProcessEnv, s)).toBe(50)
    expect(maxGasGwei({} as NodeJS.ProcessEnv, s)).toBe(0.2)
    expect(maxGasGwei({ SLICES_MAX_GAS_GWEI: '0.1' } as unknown as NodeJS.ProcessEnv, s)).toBe(0.1)
    expect(minBalanceWei({} as NodeJS.ProcessEnv, s)).toBe(BigInt('10000000000000000'))
    expect(minBalanceWei({ SLICES_MIN_BALANCE_ETH: '0.05' } as unknown as NodeJS.ProcessEnv, s)).toBe(BigInt('50000000000000000'))
    // no saved row: the env value is used untouched
    expect(maxGasGwei({ SLICES_MAX_GAS_GWEI: '0.0004' } as unknown as NodeJS.ProcessEnv, snap())).toBe(0.0004)
  })
})

describe('role income table', () => {
  const full = () => DEFAULT_ROLE_INCOME.map((r) => ({ ...r }))
  const ok = (v: unknown) => parseSetting('economy.roleIncome', v).ok

  it('accepts the built-in table, a smaller table and lower or slower rows', () => {
    expect(ok(full())).toBe(true)
    expect(ok(full().slice(2))).toBe(true)
    const t = full()
    t[0] = { ...t[0], amount: 100, intervalHours: 48 }
    expect(ok(t)).toBe(true)
  })

  it('refuses anything that pays more, pays more often, adds a role or changes an id', () => {
    const raise = full()
    raise[0] = { ...raise[0], amount: raise[0].amount + 1 }
    expect(ok(raise)).toBe(false)
    const faster = full()
    faster[0] = { ...faster[0], intervalHours: 12 }
    expect(ok(faster)).toBe(false)
    expect(ok([...full().slice(0, 3), { name: 'Somebody New', amount: 1, intervalHours: 24 }])).toBe(false)
    const swapped = full()
    swapped[1] = { ...swapped[1], roleId: '111111111111111111' }
    expect(ok(swapped)).toBe(false)
    const dropId = full()
    delete (dropId[1] as { roleId?: string }).roleId
    expect(ok(dropId)).toBe(false)
    const withId = full()
    withId[0] = { ...withId[0], roleId: '111111111111111111' }
    expect(ok(withId)).toBe(false)
  })

  it('refuses duplicates, an empty table, junk rows and bad numbers', () => {
    expect(ok([])).toBe(false)
    expect(ok([full()[0], full()[0]])).toBe(false)
    expect(ok('table')).toBe(false)
    expect(ok([{ name: '', amount: 1, intervalHours: 24 }])).toBe(false)
    const t = full()
    t[0] = { ...t[0], amount: 0 }
    expect(ok(t)).toBe(false)
    t[0] = { ...t[0], amount: 1.5 }
    expect(ok(t)).toBe(false)
    t[0] = { ...t[0], amount: 10, intervalHours: 721 }
    expect(ok(t)).toBe(false)
  })

  it('matches role names loosely, like the payout code does', () => {
    expect(ok([{ name: '  pizza-holder ', amount: 10, intervalHours: 24 }])).toBe(true)
  })

  it('asks for confirmation when a change would pay more per day', () => {
    const c = SETTINGS['economy.roleIncome'].confirm!
    const small = full().slice(5)
    expect(c(small, full())).toMatch(/more PEP/)
    expect(c(full(), small)).toBeNull()
    expect(roleIncomeDailyTotal([{ amount: 48, intervalHours: 48 }])).toBe(24)
  })

  it('a saved table replaces ROLE_INCOME_JSON; with no row the env table still applies', () => {
    const envTable = '[{"name":"Crew Member","amount":50}]'
    expect(roleIncomeConfig(envTable, snap())).toEqual([{ name: 'Crew Member', amount: 50, intervalHours: 24 }])
    const saved = [{ name: 'Crew Member', amount: 10, intervalHours: 24 }]
    expect(roleIncomeConfig(envTable, snap({ 'economy.roleIncome': saved }))).toEqual(saved)
    // unreadable settings: last saved table, else the env table
    expect(roleIncomeConfig(envTable, snap({}, { readFailed: true }))).toEqual([{ name: 'Crew Member', amount: 50, intervalHours: 24 }])
    rememberOverride('economy.roleIncome', saved)
    expect(roleIncomeConfig(envTable, snap({}, { readFailed: true }))).toEqual(saved)
  })
})
