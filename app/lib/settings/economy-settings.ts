/**
 * Economy, games and spend-cap settings (plans/app-settings.md, phase 4). Kept in its own file so the
 * registry only carries one spread line for the whole `economy` group.
 *
 * Rules for this group:
 * - Every payout, spend cap and limit is stricter-only: the schema bound stops at today's value, so
 *   the admin page can tighten (pay less, cap lower, slow down) but loosening needs a code change.
 *   The effective value also never loosens an env value that is already stricter (see numbers.ts).
 * - Env vars that used to set these stay the legacy value while no row is saved.
 * - If a value cannot be read, readers use the last saved value, then today's value (numbers.ts).
 * - The few knobs that carry no spend risk (minimum bet, blackjack timeout) take the full range.
 *
 * This file imports only types from ./registry, so there is no runtime import cycle.
 */
import { z } from 'zod'
import { DEFAULT_ROLE_INCOME, normalizeRoleName, roleIncomeBaseline, type RoleIncome } from '@/app/lib/pep-earn/income-defaults'
import type { SettingArea, SettingDef } from './registry'

function num(o: {
  key: string
  area?: SettingArea
  label: string
  help: string
  min: number
  max: number
  default: number
  unit?: string
  /** Set for stricter-only knobs: which direction is looser. Omit for a two-way knob. */
  looserWhen?: 'higher' | 'lower'
}): SettingDef<number> {
  const strict = o.looserWhen
    ? `Can only be ${o.looserWhen === 'higher' ? 'lowered' : 'raised'} here; ${o.looserWhen === 'higher' ? 'raising it above' : 'lowering it below'} ${o.default}${o.unit ? ` ${o.unit}` : ''} needs a code change.`
    : ''
  return {
    key: o.key,
    area: o.area ?? 'economy',
    label: o.label,
    help: [o.help, strict].filter(Boolean).join(' '),
    schema: z.number().int().min(o.min).max(o.max),
    default: o.default,
    onReadFailure: 'lastKnownGood',
    input: { type: 'int', min: o.min, max: o.max, ...(o.unit ? { unit: o.unit } : {}) },
    stricterOnly: o.looserWhen ? true : undefined,
    looserWhen: o.looserWhen,
  }
}

/** Value paid per day for a table: each role's amount scaled to 24 hours. */
export function roleIncomeDailyTotal(rows: ReadonlyArray<Pick<RoleIncome, 'amount' | 'intervalHours'>>): number {
  return rows.reduce((sum, r) => sum + (r.amount * 24) / r.intervalHours, 0)
}

const roleIncomeEntry = z.object({
  name: z.string().trim().min(1).max(60),
  amount: z.number().int().min(1).max(1_000_000),
  intervalHours: z.number().int().min(1).max(720),
  roleId: z.string().regex(/^\d{5,25}$/, 'Not a Discord id').optional(),
})

/**
 * Stricter-only table, judged against the table in force when nothing is saved (ROLE_INCOME_JSON if set
 * and valid, else the built-in one): every row must be a role of that table (same id), may pay no more
 * than its amount and no more often than its interval. Dropping a row is allowed.
 */
const roleIncomeSchema: z.ZodType<RoleIncome[]> = z
  .array(roleIncomeEntry)
  .min(1)
  .superRefine((rows, ctx) => {
    const baseline = roleIncomeBaseline()
    const byName = new Map(baseline.map((r) => [normalizeRoleName(r.name), r]))
    if (rows.length > baseline.length) ctx.addIssue({ code: 'custom', message: `at most ${baseline.length} rows` })
    const seen = new Set<string>()
    rows.forEach((row, i) => {
      const key = normalizeRoleName(row.name)
      const base = byName.get(key)
      const bad = (message: string) => ctx.addIssue({ code: 'custom', path: [i], message: `${row.name}: ${message}` })
      if (seen.has(key)) bad('listed twice')
      seen.add(key)
      if (!base) return bad('not a role in the income table in force; adding a role needs a code change')
      if (row.amount > base.amount) bad(`pays at most ${base.amount}; raising it needs a code change`)
      if (row.intervalHours < base.intervalHours) bad(`pays at most every ${base.intervalHours} hours; shortening it needs a code change`)
      if ((row.roleId ?? undefined) !== base.roleId) bad('the role id is fixed by the income table in force')
    })
  })

export const ECONOMY_SETTINGS = {
  // ---- Casino games (slots, roulette, blackjack) ----
  'games.minBet': num({
    key: 'games.minBet', label: 'Games: smallest bet', help: 'Smallest bet in PEP. The GAME_MIN_BET env var is used until this is saved.',
    min: 1, max: 1000, default: 10, unit: 'PEP',
  }),
  'games.maxBet': num({
    key: 'games.maxBet', label: 'Games: largest bet', help: 'Largest bet in PEP (never below the smallest bet). The GAME_MAX_BET env var is used until this is saved.',
    min: 10, max: 5000, default: 5000, unit: 'PEP', looserWhen: 'higher',
  }),
  'games.cooldownSeconds': num({
    key: 'games.cooldownSeconds', label: 'Games: seconds between rounds', help: 'One game start per member per this many seconds. The GAME_COOLDOWN_SECONDS env var is used until this is saved.',
    min: 3, max: 3600, default: 3, unit: 's', looserWhen: 'lower',
  }),
  'games.blackjackTimeoutSeconds': num({
    key: 'games.blackjackTimeoutSeconds', label: 'Blackjack: seconds before a hand times out', help: 'An unfinished hand is settled after this long. The BLACKJACK_TIMEOUT_SECONDS env var is used until this is saved.',
    min: 30, max: 3600, default: 300, unit: 's',
  }),

  // ---- Crime ----
  'crime.minPep': num({
    key: 'crime.minPep', label: 'Crime: smallest payout', help: 'Smallest successful crime payout. The CRIME_MIN_PEP env var is used until this is saved.',
    min: 1, max: 2, default: 2, unit: 'PEP', looserWhen: 'higher',
  }),
  'crime.maxPep': num({
    key: 'crime.maxPep', label: 'Crime: largest payout', help: 'Largest successful crime payout. The CRIME_MAX_PEP env var is used until this is saved.',
    min: 2, max: 420, default: 420, unit: 'PEP', looserWhen: 'higher',
  }),
  'crime.failPercent': num({
    key: 'crime.failPercent', label: 'Crime: chance of being fined', help: 'Percent of attempts that end in a fine. The CRIME_FAIL_PERCENT env var is used until this is saved.',
    min: 60, max: 100, default: 60, unit: '%', looserWhen: 'lower',
  }),
  'crime.fineMinPercent': num({
    key: 'crime.fineMinPercent', label: 'Crime: smallest fine (% of wallet)', help: 'The CRIME_FINE_MIN_PERCENT env var is used until this is saved.',
    min: 5, max: 100, default: 5, unit: '%', looserWhen: 'lower',
  }),
  'crime.fineMaxPercent': num({
    key: 'crime.fineMaxPercent', label: 'Crime: largest fine (% of wallet)', help: 'The CRIME_FINE_MAX_PERCENT env var is used until this is saved.',
    min: 55, max: 100, default: 55, unit: '%', looserWhen: 'lower',
  }),
  'crime.cooldownSeconds': num({
    key: 'crime.cooldownSeconds', label: 'Crime: seconds between attempts', help: 'The CRIME_COOLDOWN_SECONDS env var is used until this is saved.',
    min: 30, max: 86400, default: 30, unit: 's', looserWhen: 'lower',
  }),

  // ---- Work ----
  'work.minPep': num({
    key: 'work.minPep', label: 'Work: smallest payout', help: 'Smallest /work payout. The WORK_MIN_PEP env var is used until this is saved.',
    min: 1, max: 10, default: 10, unit: 'PEP', looserWhen: 'higher',
  }),
  'work.maxPep': num({
    key: 'work.maxPep', label: 'Work: largest payout', help: 'Largest /work payout. The WORK_MAX_PEP env var is used until this is saved.',
    min: 10, max: 100, default: 100, unit: 'PEP', looserWhen: 'higher',
  }),
  'work.cooldownSeconds': num({
    key: 'work.cooldownSeconds', label: 'Work: seconds between shifts', help: 'The WORK_COOLDOWN_SECONDS env var is used until this is saved.',
    min: 30, max: 86400, default: 30, unit: 's', looserWhen: 'lower',
  }),

  // ---- Daily jobs, role income, admin grants ----
  'economy.jobRewardAmount': num({
    key: 'economy.jobRewardAmount', label: 'Daily job reward', help: 'PEP paid for each completed daily job. The JOB_REWARD_AMOUNT env var is used until this is saved.',
    min: 1, max: 50, default: 50, unit: 'PEP', looserWhen: 'higher',
  }),
  'economy.dailyJobsCount': num({
    key: 'economy.dailyJobsCount', label: 'Daily jobs offered', help: 'How many jobs are picked each UTC day.',
    min: 1, max: 3, default: 3, looserWhen: 'higher',
  }),
  'economy.adminGrantMax': num({
    key: 'economy.adminGrantMax', label: 'Largest single admin grant', help: 'Cap on one /add-money or /remove-money. The ADMIN_GRANT_MAX env var is used until this is saved.',
    min: 1, max: 10_000, default: 10_000, unit: 'PEP', looserWhen: 'higher',
  }),
  'economy.roleIncome': {
    key: 'economy.roleIncome',
    area: 'economy',
    label: 'Role income table',
    help: 'What /collect-income pays each role, and how often. Rows can be removed or made smaller or slower here, judged against the table in force before anything is saved (the ROLE_INCOME_JSON env table if set, else the built-in one); adding a role or paying more needs a code change. Reset restores that table.',
    schema: roleIncomeSchema,
    default: DEFAULT_ROLE_INCOME.map((r) => ({ ...r })),
    onReadFailure: 'lastKnownGood',
    input: { type: 'roleIncome' },
    stricterOnly: true,
    looserWhen: 'larger',
    confirm: (from: RoleIncome[], to: RoleIncome[]) =>
      roleIncomeDailyTotal(to) > roleIncomeDailyTotal(from) ? 'This pays more PEP per day than the table in force now.' : null,
  } as SettingDef<RoleIncome[]>,

  // ---- Spend caps (lowering only) ----
  'missions.runPepAlert': num({
    key: 'missions.runPepAlert', area: 'missions', label: 'Nightly run PEP alert', help: 'A mission run that pays out more than this posts an alert to the admin log. The MISSIONS_RUN_PEP_ALERT env var is used until this is saved.',
    min: 1, max: 50_000, default: 50_000, unit: 'PEP', looserWhen: 'higher',
  }),
  'slices.dailyCap': num({
    key: 'slices.dailyCap', label: 'Slices: mints per 24 hours', help: 'Most mints in a rolling 24 hours. The SLICES_DAILY_CAP env var is used until this is saved. The saved value can only tighten it.',
    min: 1, max: 1000, default: 1000, looserWhen: 'higher',
  }),
  'slices.maxGasMilliGwei': num({
    key: 'slices.maxGasMilliGwei', label: 'Slices: highest gas price', help: 'A mint run is skipped while the gas price is above this, in thousandths of a gwei (500 = 0.5 gwei). The SLICES_MAX_GAS_GWEI env var is used until this is saved.',
    min: 1, max: 500, default: 500, unit: 'milli-gwei', looserWhen: 'higher',
  }),
  'slices.minBalanceMilliEth': num({
    key: 'slices.minBalanceMilliEth', label: 'Slices: pause below minter balance', help: 'Minting pauses and alerts when the minter holds less than this, in thousandths of an ETH (3 = 0.003 ETH). The SLICES_MIN_BALANCE_ETH env var is used until this is saved.',
    min: 3, max: 100, default: 3, unit: 'milli-ETH', looserWhen: 'lower',
  }),
  'portrait.dailyCap': num({
    key: 'portrait.dailyCap', label: 'Portraits: all draws per day', help: 'Most new portraits per day across everyone. The MAFIA_PORTRAIT_DAILY_CAP env var is used until this is saved.',
    min: 1, max: 300, default: 300, looserWhen: 'higher',
  }),
  'portrait.publicDailyCap': num({
    key: 'portrait.publicDailyCap', label: 'Portraits: signed-out draws per day', help: 'Most new portraits per day for visitors who are not signed in. The MAFIA_PORTRAIT_PUBLIC_DAILY_CAP env var is used until this is saved.',
    min: 1, max: 100, default: 100, looserWhen: 'higher',
  }),
} as const satisfies Record<string, SettingDef>
