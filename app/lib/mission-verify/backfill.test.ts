// @vitest-environment node
// Backfill dry-run math, the CSV and the --confirm-total guard (pure).
import { describe, it, expect } from 'vitest'
import { backfillRows, checkConfirmTotal, summarizeBackfill, toCsv } from './backfill'
import { buildCatalog, type MemberOutcome } from './bulk'
import type { MissionCheck, RunReport } from './engine'

const catalog = buildCatalog([
  { id: 1, level: 1, index: 0, title: 'Link X', reward: 69, verifierKey: 'x_linked', verifierParams: {} },
  { id: 2, level: 2, index: 0, title: 'Say hi', reward: 420, verifierKey: 'attendance_count', verifierParams: { min: 1 } },
  { id: 3, level: 2, index: 1, title: 'Post', reward: 420, verifierKey: null, verifierParams: null },
  { id: 4, level: 3, index: 0, title: 'Share, in #show-and-tell', reward: 1337, verifierKey: 'discord_message', verifierParams: {} },
  { id: 6, level: 6, index: 0, title: 'Pepperoni Mafia', reward: 6942, verifierKey: 'discord_role', verifierParams: { roleIds: ['823266914834841610'] } },
])

const c = (missionId: number, outcome: MissionCheck['outcome'], extra: Partial<MissionCheck> = {}): MissionCheck => {
  const m = catalog.byId.get(missionId)!
  return { missionId, level: m.level, index: m.index, title: m.title, verifierKey: m.verifierKey ?? '', result: { status: 'pass', evidence: { ok: 1 } }, outcome, ...extra }
}
const dry = (discordId: string, checks: MissionCheck[], over: Partial<RunReport> = {}): RunReport => ({
  discordId,
  enabled: false,
  dryRun: true,
  trigger: 'backfill',
  checks,
  approved: [],
  held: [],
  reopened: [],
  flagged: [],
  unflagged: [],
  wouldFlag: [],
  wouldUnflag: [],
  levelsPaid: [],
  errors: [],
  ...over,
})
const member = (discordId: string, report: RunReport | null, payouts: MemberOutcome['payouts'] = [], extra: Partial<MemberOutcome> = {}): MemberOutcome => ({
  discordId,
  memberId: `m-${discordId}`,
  report,
  payouts,
  legacyWouldFail: [],
  ...extra,
})

const OUTCOMES: MemberOutcome[] = [
  // L1 + L2 newly approved; L2.1 was already approved by hand -> pays L1 + L2
  member('100000000000000001', dry('100000000000000001', [c(1, 'would_approve'), c(2, 'would_approve')]), [
    { level: 1, reward: 69 },
    { level: 2, reward: 420 },
  ]),
  // L1 only (L2.1 missing)
  member('100000000000000002', dry('100000000000000002', [c(1, 'would_approve'), c(2, 'not_yet', { result: { status: 'fail', reason: '0/1 calls' } })]), [
    { level: 1, reward: 69 },
  ]),
  // L6 role passes but needs a human release; their lower levels were paid long ago
  member('100000000000000003', dry('100000000000000003', [c(6, 'would_hold', { holdReason: 'HIGH_LEVEL' })])),
  // young account: held; previously rejected: reopened
  member('100000000000000004', dry('100000000000000004', [c(1, 'would_hold', { holdReason: 'NEW_ACCOUNT' })])),
  member('100000000000000005', dry('100000000000000005', [c(1, 'rejected')])),
  // a rejected mission whose verifier still fails: nothing
  member('100000000000000006', dry('100000000000000006', [c(1, 'rejected', { result: { status: 'fail', reason: 'No X account linked' } })])),
  // role lost on an approved row: flag; plus a legacy 'auto' L3.0 approval that would fail (information only)
  member('100000000000000007', dry('100000000000000007', [c(6, 'already_approved', { result: { status: 'fail', reason: 'Required Discord role not held' } })], { wouldFlag: [6] }), [], {
    legacyWouldFail: [{ missionId: 4, reason: 'No #show-and-tell message link submitted' }],
  }),
  // nothing to do; and one error
  member('100000000000000008', dry('100000000000000008', [c(1, 'already_approved')])),
  member('100000000000000009', null, [], { error: 'db timeout' }),
]

describe('summarizeBackfill', () => {
  const s = summarizeBackfill(OUTCOMES, catalog)

  it('totals PEP by level and overall', () => {
    expect(s.perLevel).toEqual([
      { level: 1, members: 2, reward: 69, pep: 138 },
      { level: 2, members: 1, reward: 420, pep: 420 },
    ])
    expect(s.totalPep).toBe(558)
  })

  it('counts newly approved, held, reopened, flagged and legacy-would-fail per mission', () => {
    const by = Object.fromEntries(s.perMission.map((m) => [m.missionId, m]))
    expect(by[1]).toMatchObject({ approve: 2, hold: 1, reopen: 1, flag: 0 })
    expect(by[2]).toMatchObject({ approve: 1 })
    expect(by[4]).toMatchObject({ legacyWouldFail: 1, approve: 0 })
    expect(by[6]).toMatchObject({ hold: 1, flag: 1 })
    expect(s.perMission.map((m) => m.missionId)).toEqual([1, 2, 4, 6]) // missions with a verifier, in order
  })

  it('lists the release queue by reason', () => {
    expect(s.held).toEqual({ HIGH_LEVEL: 1, NEW_ACCOUNT: 1, PREVIOUSLY_REJECTED: 1 })
  })

  it('the members to apply exclude information-only and no-op members', () => {
    expect(s.applyMembers).toEqual(['100000000000000001', '100000000000000002', '100000000000000003', '100000000000000004', '100000000000000005', '100000000000000007'])
    expect(s.members).toBe(9)
    expect(s.membersWithChanges).toBe(6)
  })

  it('ranks the top recipients and reports errors', () => {
    expect(s.top).toEqual([
      { discordId: '100000000000000001', memberId: 'm-100000000000000001', levels: [1, 2], pep: 489 },
      { discordId: '100000000000000002', memberId: 'm-100000000000000002', levels: [1], pep: 69 },
    ])
    expect(summarizeBackfill(OUTCOMES, catalog, 1).top).toHaveLength(1)
    expect(s.errors).toEqual(['100000000000000009: db timeout'])
  })

  it('an empty plan totals 0 (a re-run after --apply)', () => {
    expect(summarizeBackfill([member('1', dry('1', [c(1, 'already_approved')]))], catalog).totalPep).toBe(0)
  })
})

describe('CSV', () => {
  it('one row per member and action, with the PEP on pay rows', () => {
    const rows = backfillRows(OUTCOMES, catalog)
    expect(rows.filter((r) => r.action === 'pay').reduce((t, r) => t + r.pep, 0)).toBe(558)
    expect(rows.map((r) => `${r.discordId.slice(-1)}:${r.action}:${r.missionId}`)).toEqual([
      '1:approve:1',
      '1:approve:2',
      '1:pay:',
      '1:pay:',
      '2:approve:1',
      '2:pay:',
      '3:hold:6',
      '4:hold:1',
      '5:reopen:1',
      '7:flag:6',
      '7:legacy_auto_would_fail:4',
    ])
    expect(rows.find((r) => r.action === 'flag')?.detail).toBe('Required Discord role not held')
  })

  it('quotes commas / quotes and neutralises spreadsheet formulas', () => {
    const csv = toCsv([
      { discordId: '1', memberId: '=HYPERLINK("x")', action: 'approve', level: 3, missionId: 4, mission: 'Share, in "#show"', holdReason: '', pep: 0, detail: '{"a":1}' },
    ])
    const [header, line] = csv.trim().split('\n')
    expect(header).toBe('discordId,memberId,action,level,missionId,mission,holdReason,pep,detail')
    expect(line).toBe(`1,"'=HYPERLINK(""x"")",approve,3,4,"Share, in ""#show""",,0,"{""a"":1}"`)
  })
})

describe('checkConfirmTotal (the --apply guard)', () => {
  it('passes only on the exact dry-run total', () => {
    expect(checkConfirmTotal(558, '558')).toBeNull()
    expect(checkConfirmTotal(558, 558)).toBeNull()
    expect(checkConfirmTotal(12345, '12,345')).toBeNull()
    expect(checkConfirmTotal(0, '0')).toBeNull()
  })
  it('refuses a missing, malformed or different total', () => {
    expect(checkConfirmTotal(558, undefined)).toMatch(/needs --confirm-total/)
    expect(checkConfirmTotal(558, true)).toMatch(/needs --confirm-total/) // "--confirm-total" with no value
    expect(checkConfirmTotal(558, '')).toMatch(/needs --confirm-total/)
    expect(checkConfirmTotal(558, 'abc')).toMatch(/whole number/)
    expect(checkConfirmTotal(558, '-558')).toMatch(/whole number/)
    expect(checkConfirmTotal(558, '558.5')).toMatch(/whole number/)
    expect(checkConfirmTotal(558, '557')).toMatch(/does not match the dry run's total of 558/)
    expect(checkConfirmTotal(558, '5580')).toMatch(/does not match/)
  })
})
