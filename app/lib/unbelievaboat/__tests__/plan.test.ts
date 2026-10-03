// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildSnapshot } from '../snapshot'
import { buildMigrationPlan, formatPlanReport, parseRate, planToCsv, PEP_INT_MAX } from '../plan'
import { mergeKnownMembers, parseMembersCsv } from '../members-source'
import { FIXTURE_GUILD, fixtureUsers } from './mock-ub'

const crewCsv = readFileSync(path.join(__dirname, '../__fixtures__/crew.csv'), 'utf8')
const snapshot = buildSnapshot({ guildId: FIXTURE_GUILD, users: fixtureUsers, pages: 4, apiBase: 'mock' })
// 100000000000000007 has an app account (User row) but no sheet row.
const known = mergeKnownMembers(parseMembersCsv(crewCsv), ['100000000000000007'])
const BOT = '100000000000000005'

function byId(plan: ReturnType<typeof buildMigrationPlan>) {
  return Object.fromEntries(plan.entries.map((e) => [e.discordId.slice(-1), e]))
}

describe('members CSV', () => {
  it('finds the header under banner rows and maps discordId -> memberId (column A fallback)', () => {
    const m = parseMembersCsv(crewCsv)
    expect(m.get('100000000000000001')).toBe('1')
    expect(m.get('100000000000000008')).toBe('8')
    expect(m.size).toBe(3) // blank and non-snowflake Discord IDs are skipped
  })

  it('throws when there is no header', () => {
    expect(() => parseMembersCsv('a,b\n1,2\n')).toThrow(/header/)
  })
})

describe('buildMigrationPlan', () => {
  it('categorizes every user at rate 1 on total', () => {
    const plan = buildMigrationPlan(snapshot, known, { exclude: [BOT] })
    const e = byId(plan)
    expect(e['1']).toMatchObject({ status: 'credit', amount: 1054, memberId: '1' })
    expect(e['2']).toMatchObject({ status: 'negative', amount: 0 })
    expect(e['3']).toMatchObject({ status: 'pending', amount: 500, memberId: null })
    expect(e['4']).toMatchObject({ status: 'zero', amount: 0 })
    expect(e['5']).toMatchObject({ status: 'excluded' })
    expect(e['6']).toMatchObject({ status: 'invalid' })
    expect(e['7']).toMatchObject({ status: 'credit', amount: 10, memberId: null })
    expect(e['8']).toMatchObject({ status: 'credit', amount: 450 }) // negative cash nets against bank
    expect(e['1'].migrationKey).toBe(`unbelievaboat:${FIXTURE_GUILD}:100000000000000001`)

    const s = plan.summary
    expect(s.pepToCredit).toBe(1054 + 10 + 450)
    expect(s.pepToHold).toBe(500)
    expect(s.pepTotal).toBe(2014)
    expect(s.negativeForgiven).toBe('-20')
    expect(s.byStatus).toEqual({ credit: 3, pending: 1, zero: 1, negative: 1, excluded: 1, invalid: 1 })
  })

  it('applies a fractional rate with floor and reports rounding loss', () => {
    const plan = buildMigrationPlan(snapshot, known, { rate: '0.01', exclude: [BOT] })
    const e = byId(plan)
    expect(e['1'].amount).toBe(10) // 1054 * 0.01 = 10.54 -> 10
    expect(e['3'].amount).toBe(5)
    expect(e['8'].amount).toBe(4)
    expect(e['7'].status).toBe('zero') // 0.1 PEP rounds to 0
    expect(plan.summary.roundingLossPep).toBe('1') // .54 + .5 + .1 + .0 = 1.14 -> 1
  })

  it('can convert only cash or only bank', () => {
    const cash = byId(buildMigrationPlan(snapshot, known, { basis: 'cash', exclude: [BOT] }))
    expect(cash['1'].amount).toBe(54)
    expect(cash['8'].status).toBe('negative')
    const bank = byId(buildMigrationPlan(snapshot, known, { basis: 'bank', exclude: [BOT] }))
    expect(bank['1'].amount).toBe(1000)
  })

  it('flags Discord bots from export annotations', () => {
    const annotated = buildSnapshot({
      guildId: FIXTURE_GUILD,
      users: fixtureUsers,
      pages: 1,
      apiBase: 'mock',
      discord: new Map([[BOT, { username: 'somebot', bot: true, inGuild: true }]]),
    })
    expect(byId(buildMigrationPlan(annotated, known))['5'].status).toBe('excluded')
  })

  it('marks amounts above the Int column as invalid', () => {
    const big = buildSnapshot({
      guildId: FIXTURE_GUILD,
      users: [{ rank: 1, user_id: '100000000000000001', cash: 0, bank: PEP_INT_MAX + 1, total: PEP_INT_MAX + 1 }],
      pages: 1,
      apiBase: 'mock',
    })
    expect(buildMigrationPlan(big, known).entries[0].status).toBe('invalid')
  })

  it('parses rates strictly', () => {
    expect(parseRate('2.5')).toEqual({ num: BigInt(25), den: BigInt(10) })
    expect(() => parseRate('0')).toThrow()
    expect(() => parseRate('-1')).toThrow()
    expect(() => parseRate('1e3')).toThrow()
  })

  it('renders a report and CSV', () => {
    const plan = buildMigrationPlan(snapshot, known, { exclude: [BOT] })
    const report = formatPlanReport(plan)
    expect(report).toContain('matched (credit now):')
    expect(report).toContain('PEP total to mint:        2014')
    const csv = planToCsv(plan).trim().split('\n')
    expect(csv).toHaveLength(9)
    expect(csv[0]).toMatch(/^discord_id,member_id,status/)
  })
})
