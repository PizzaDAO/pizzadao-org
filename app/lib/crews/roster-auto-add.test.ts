import { describe, expect, it, vi, beforeEach } from 'vitest'

const settingValues = new Map<string, unknown>()
const toggle = vi.fn(async () => true)
vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn() }))
vi.mock('@/app/lib/sheets/members-list', () => ({ fetchAllMembers: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ writeGuildMember: vi.fn(), getBotUserId: vi.fn() }))
vi.mock('@/app/lib/roster-writeback', () => ({
  updateMemberCrews: vi.fn(),
  RosterWritebackError: class extends Error {
    constructor(m: string, readonly status: number) {
      super(m)
    }
  },
}))
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => ({ get: (k: string) => settingValues.get(k) }) }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: () => toggle() }))

import { parseExcludeIds, planRosterAdds, roundRobinByCrew, runRosterAutoAdd, type AttendanceRow, type PageRoster, type RosterAutoAddDeps, type RosterMember } from './roster-auto-add'

const id = (n: number) => `1000000000000000${String(n).padStart(3, '0')}`
const day = (n: number) => new Date(Date.UTC(2026, 9, n))
const row = (n: number, crewId: string, d: number): AttendanceRow => ({ discordId: id(n), crewId, callDate: day(d) })
const member = (n: number, crews: string[] = []): RosterMember => ({ id: `m${n}`, discordId: id(n), crews: new Set(crews) })
const rule = { minCalls: 2, windowCalls: 4 }
const known = new Set(['ops', 'comms'])
const pageOf = (ids: string[] = [], o: Partial<Record<'names' | 'removedMemberIds' | 'removedNames', string[]>> = {}): PageRoster => ({
  memberIds: new Set(ids),
  names: new Set(o.names),
  removedMemberIds: new Set(o.removedMemberIds),
  removedNames: new Set(o.removedNames),
})

const plan = (rows: AttendanceRow[], members: RosterMember[], extra: Partial<Parameters<typeof planRosterAdds>[0]> = {}) =>
  planRosterAdds({ rows, members, knownCrews: known, excluded: new Set(), rule, ...extra })

describe('planRosterAdds', () => {
  it('adds a member who attended 2 of the last 4 calls', () => {
    const rows = [row(1, 'ops', 1), row(1, 'ops', 8), row(2, 'ops', 15), row(2, 'ops', 22)]
    expect(plan(rows, [member(1), member(2)])).toEqual([
      { crewId: 'ops', memberId: 'm1', discordId: id(1), cell: true, page: false, role: false },
      { crewId: 'ops', memberId: 'm2', discordId: id(2), cell: true, page: false, role: false },
    ])
  })

  it('does not add one attendance, or attendance outside the last 4 calls', () => {
    const rows = [row(1, 'ops', 1), row(1, 'ops', 8), row(9, 'ops', 15), row(9, 'ops', 22), row(9, 'ops', 23), row(9, 'ops', 24), row(3, 'ops', 24)]
    // Calls: days 1, 8, 15, 22, 23, 24 -> the last 4 are 15, 22, 23, 24. Member 1 only attended outside; member 3 once.
    expect(plan(rows, [member(1), member(3), member(9)]).map((p) => p.memberId)).toEqual(['m9'])
  })

  it('counts a call once however many rows it has', () => {
    expect(plan([row(1, 'ops', 1), row(1, 'ops', 1)], [member(1)])).toEqual([])
  })

  it('never touches a member already on the crew (and never removes anyone)', () => {
    const rows = [row(1, 'ops', 1), row(1, 'ops', 8)]
    expect(plan(rows, [member(1, ['ops'])])).toEqual([])
    // Attendance elsewhere does not matter to the roster they have: only 'add' plans exist.
    expect(plan(rows, [member(1, ['comms'])]).every((p) => p.crewId === 'ops')).toBe(true)
  })

  it('requires a member record', () => {
    expect(plan([row(5, 'ops', 1), row(5, 'ops', 8)], [member(1)])).toEqual([])
  })

  it('skips excluded ids, bots and unknown or non-roster crews', () => {
    const rows = [row(1, 'ops', 1), row(1, 'ops', 8), row(2, 'ops', 1), row(2, 'ops', 8), row(3, 'community_call', 1), row(3, 'community_call', 8), row(3, 'ghost', 1), row(3, 'ghost', 8)]
    const members = [member(1), member(2), member(3)]
    expect(plan(rows, members, { excluded: new Set([id(1)]), botIds: new Set([id(2)]) })).toEqual([])
  })

  it('applies the configured rule', () => {
    const rows = [row(1, 'ops', 1), row(1, 'ops', 8), row(1, 'ops', 15)]
    expect(plan(rows, [member(1)], { rule: { minCalls: 3, windowCalls: 4 } })).toHaveLength(1)
    expect(plan(rows, [member(1)], { rule: { minCalls: 4, windowCalls: 4 } })).toHaveLength(0)
  })
})

describe('planRosterAdds: crew page and role', () => {
  const rows = [row(1, 'ops', 1), row(1, 'ops', 8)]
  it('plans a page row and a role for a member already in the Crews cell (heal, additive)', () => {
    const p = plan(rows, [member(1, ['ops'])], {
      pageRosters: new Map([['ops', pageOf()]]),
      roleIds: new Map([['ops', '555']]),
      heldRoles: new Map([[id(1), new Set<string>()]]),
    })
    expect(p).toEqual([{ crewId: 'ops', memberId: 'm1', discordId: id(1), cell: false, page: true, role: true }])
  })
  it('plans nothing once cell, page and role are all there', () => {
    expect(
      plan(rows, [member(1, ['ops'])], {
        pageRosters: new Map([['ops', pageOf(['m1'])]]),
        roleIds: new Map([['ops', '555']]),
        heldRoles: new Map([[id(1), new Set(['555'])]]),
      }),
    ).toEqual([])
  })
  it('an archived page row means a deliberate removal: no cell, page or role is planned', () => {
    const p = plan(rows, [member(1)], { pageRosters: new Map([['ops', pageOf([], { removedMemberIds: ['m1'] })]]), roleIds: new Map([['ops', '555']]), heldRoles: new Map([[id(1), new Set<string>()]]) })
    expect(p).toEqual([])
  })
  it('an active row wins over an archived one for the same member', () => {
    const p = plan(rows, [member(1, ['ops'])], { pageRosters: new Map([['ops', pageOf(['m1'], { removedMemberIds: ['m1'] })]]) })
    expect(p).toEqual([])
  })
  it('a legacy name-keyed row counts as present (no duplicate page row); an archived one as removed', () => {
    const named = { ...member(1, ['ops']), name: 'Tony  Pepperoni' }
    expect(plan(rows, [named], { pageRosters: new Map([['ops', pageOf([], { names: ['tony pepperoni'] })]]) })).toEqual([])
    expect(plan(rows, [{ ...named, crews: new Set<string>() }], { pageRosters: new Map([['ops', pageOf([], { removedNames: ['tony pepperoni'] })]]) })).toEqual([])
  })
  it('sheet-sourced crews (absent from pageRosters) get no page row; unknown roles plan no role grant', () => {
    const p = plan(rows, [member(1, ['ops'])], { roleIds: new Map([['ops', '555']]), heldRoles: null })
    expect(p).toEqual([])
  })
})

describe('parseExcludeIds', () => {
  it('reads ids separated by spaces, commas and lines and drops junk', () => {
    expect([...parseExcludeIds(`${id(1)}, ${id(2)}\n${id(3)} nope 123`)]).toEqual([id(1), id(2), id(3)])
    expect(parseExcludeIds(undefined).size).toBe(0)
  })
})

function makeDeps(over: Partial<RosterAutoAddDeps> = {}) {
  const cells = new Map<string, string[]>([['m1', []], ['m2', ['ops']]])
  const page = new Set<string>(['m2'])
  const roles = new Map<string, Set<string>>([[id(1), new Set()], [id(2), new Set(['555'])]])
  const deps: RosterAutoAddDeps = {
    loadRows: async () => [row(1, 'ops', 1), row(1, 'ops', 8), row(2, 'ops', 1), row(2, 'ops', 8)],
    loadMembers: async () => [member(1, cells.get('m1')), member(2, cells.get('m2'))],
    loadCrews: async () => [{ id: 'ops', role: '<@&555>' }],
    botIds: async () => new Set(),
    loadPageRosters: async () => ({ rosters: new Map([['ops', pageOf([...page])]]), sheetSourced: [] }),
    addToCrewPage: vi.fn(async ({ memberId }) => {
      if (page.has(memberId)) return 'exists' as const
      page.add(memberId)
      return 'created' as const
    }),
    loadHeldRoles: async () => new Map([...roles].map(([k, v]) => [k, new Set(v)])),
    updateCrews: vi.fn(async (i) => {
      const cur = cells.get(i.memberId)!
      const has = cur.includes(i.crewId)
      if (i.mode === 'apply' && !has) cur.push(i.crewId)
      return { mode: i.mode ?? 'dry-run', applied: i.mode === 'apply' && !has, changed: !has, range: '', before: cur.join(','), after: '', crews: cur }
    }),
    writeRole: vi.fn(async (op) => {
      roles.get((op as { userId: string }).userId)?.add((op as { roleId: string }).roleId)
      return { status: 204, remaining: 5, resetAfterMs: 100, retryAfterMs: null, blocked: false }
    }),
    sleep: async () => {},
    now: () => new Date('2026-10-30T00:00:00Z'),
    ...over,
  }
  return { deps, cells, page }
}

beforeEach(() => {
  settingValues.clear()
  settingValues.set('crews.rosterAutoAddMinCalls', 2)
  settingValues.set('crews.rosterAutoAddWindowCalls', 4)
  settingValues.set('crews.rosterAutoAddMaxPerRun', 25)
  settingValues.set('crews.rosterAutoAddExcludeIds', '')
  toggle.mockResolvedValue(true)
})

describe('runRosterAutoAdd', () => {
  it('switch off: counts only and writes nothing, and the response carries no ids', async () => {
    toggle.mockResolvedValue(false)
    const { deps } = makeDeps()
    const r = await runRosterAutoAdd({}, deps)
    expect(r).toMatchObject({ dryRun: true, switchOff: true, planned: 1, perCrew: { crewsCell: { ops: 1 }, crewPage: { ops: 1 }, role: { ops: 1 } } })
    expect(r.adds).toBeUndefined()
    expect(deps.updateCrews).not.toHaveBeenCalled()
    expect(deps.addToCrewPage).not.toHaveBeenCalled()
    expect(deps.writeRole).not.toHaveBeenCalled()
  })

  it('dryRun with the switch on returns ids and per-piece counts per crew and writes nothing', async () => {
    const { deps } = makeDeps()
    const r = await runRosterAutoAdd({ dryRun: true }, deps)
    expect(r.adds).toEqual([{ crewId: 'ops', memberId: 'm1', crewsCell: true, crewPage: true, role: true }])
    expect(r.perCrew).toEqual({ crewsCell: { ops: 1 }, crewPage: { ops: 1 }, role: { ops: 1 } })
    expect(deps.updateCrews).not.toHaveBeenCalled()
    expect(deps.addToCrewPage).not.toHaveBeenCalled()
    expect(deps.writeRole).not.toHaveBeenCalled()
  })

  it('reports sheet-sourced crews and writes no page row for them', async () => {
    const { deps } = makeDeps({ loadPageRosters: async () => ({ rosters: new Map(), sheetSourced: ['ops'] }) })
    const r = await runRosterAutoAdd({}, deps)
    expect(r).toMatchObject({ pageSkippedSheetCrews: 1, added: 1, pageAdded: 0 })
    expect(deps.addToCrewPage).not.toHaveBeenCalled()
  })

  it('on: cell, page row and role, with a distinct actor; a rerun does nothing (idempotent)', async () => {
    const { deps, cells, page } = makeDeps()
    const first = await runRosterAutoAdd({}, deps)
    expect(first).toMatchObject({ dryRun: false, added: 1, pageAdded: 1, roleGranted: 1, planned: 1 })
    expect(cells.get('m1')).toEqual(['ops'])
    expect(page.has('m1')).toBe(true)
    expect(deps.writeRole).toHaveBeenCalledWith({ kind: 'addRole', userId: id(1), roleId: '555' }, expect.any(String))
    for (const [input] of (deps.updateCrews as ReturnType<typeof vi.fn>).mock.calls) expect(input.actor).toBe('roster-auto-add')
    const second = await runRosterAutoAdd({}, deps)
    expect(second).toMatchObject({ planned: 0, added: 0, pageAdded: 0, roleGranted: 0 })
    expect(deps.writeRole).toHaveBeenCalledTimes(1)
    expect(deps.addToCrewPage).toHaveBeenCalledTimes(1)
  })

  it('heals a missing page row and role for a member already in the Crews cell, without a cell write', async () => {
    const { deps, cells } = makeDeps()
    cells.set('m1', ['ops'])
    const r = await runRosterAutoAdd({}, deps)
    expect(r).toMatchObject({ added: 0, pageAdded: 1, roleGranted: 1 })
    // Only the live re-read before the role grant (a dry run), never an apply.
    for (const [input] of (deps.updateCrews as ReturnType<typeof vi.fn>).mock.calls) expect(input.mode).toBe('dry-run')
  })

  it('does not grant the role when the live Crews cell no longer has the crew (a deliberate removal)', async () => {
    const { deps, cells } = makeDeps()
    cells.set('m1', ['ops'])
    const live = deps.updateCrews as ReturnType<typeof vi.fn>
    live.mockImplementation(async (i: { mode?: string }) => ({ mode: i.mode, applied: false, changed: true, range: '', before: '', after: '', crews: [] }))
    const r = await runRosterAutoAdd({}, deps)
    expect(deps.writeRole).not.toHaveBeenCalled()
    expect(r).toMatchObject({ roleGranted: 0, roleSkipped: 1, pageAdded: 1 })
  })

  it('never removes: no remove action is ever sent', async () => {
    const { deps } = makeDeps()
    await runRosterAutoAdd({}, deps)
    for (const [input] of (deps.updateCrews as ReturnType<typeof vi.fn>).mock.calls) expect(input.action).toBe('add')
  })

  it('skips ids in the exclusion setting', async () => {
    settingValues.set('crews.rosterAutoAddExcludeIds', id(1))
    const { deps } = makeDeps()
    expect(await runRosterAutoAdd({ dryRun: true }, deps)).toMatchObject({ planned: 0 })
  })

  it('caps one run and reports the rest as deferred', async () => {
    settingValues.set('crews.rosterAutoAddMaxPerRun', 1)
    const { deps } = makeDeps({
      loadRows: async () => [1, 3].flatMap((n) => [row(n, 'ops', 1), row(n, 'ops', 8)]),
      loadMembers: async () => [member(1), member(3)],
      loadHeldRoles: async () => new Map(),
    })
    expect(await runRosterAutoAdd({}, deps)).toMatchObject({ planned: 2, added: 1, deferred: 1 })
  })

  it('a rate-limited role grant stops further grants but the roster changes stand; the role is retried next night', async () => {
    const limited = vi.fn(async () => ({ status: 429, remaining: 0, resetAfterMs: null, retryAfterMs: 60_000, blocked: false }))
    const { deps, cells } = makeDeps({ writeRole: limited })
    const r = await runRosterAutoAdd({}, deps)
    expect(r).toMatchObject({ added: 1, pageAdded: 1, roleFailed: 1, stoppedReason: 'discord rate limited' })
    expect(cells.get('m1')).toEqual(['ops'])
    // Tomorrow: cell and page are there, only the role is still planned.
    expect(await runRosterAutoAdd({ dryRun: true }, deps)).toMatchObject({ perCrew: { crewsCell: {}, crewPage: {}, role: { ops: 1 } } })
  })

  const crewFixture = (crewIds: string[], perCrew: number) => {
    const ms: RosterMember[] = []
    const rows: AttendanceRow[] = []
    let n = 10
    for (const c of crewIds)
      for (let k = 0; k < perCrew; k++) {
        n++
        ms.push(member(n))
        rows.push(row(n, c, 1), row(n, c, 8))
      }
    return { ms, rows }
  }

  it('round-robins across crews so one crew cannot use the whole cap', async () => {
    settingValues.set('crews.rosterAutoAddMaxPerRun', 2)
    const { ms, rows } = crewFixture(['comms', 'ops'], 3)
    const { deps, cells } = makeDeps({
      loadRows: async () => rows,
      loadMembers: async () => ms,
      loadCrews: async () => [{ id: 'comms' }, { id: 'ops' }],
      loadPageRosters: async () => ({ rosters: new Map(), sheetSourced: [] }),
      loadHeldRoles: async () => new Map(),
    })
    for (const m of ms) cells.set(m.id, [])
    const r = await runRosterAutoAdd({}, deps)
    const crewsWritten = new Set((deps.updateCrews as ReturnType<typeof vi.fn>).mock.calls.filter(([i]) => i.mode === 'apply').map(([i]) => i.crewId))
    expect(r).toMatchObject({ added: 2, deferred: 4 })
    expect(crewsWritten).toEqual(new Set(['comms', 'ops']))
  })

  it('roundRobinByCrew interleaves', () => {
    const mk = (crewId: string, n: number) => ({ crewId, memberId: `m${n}`, discordId: id(n), cell: true, page: false, role: false })
    expect(roundRobinByCrew([mk('a', 1), mk('a', 2), mk('b', 3)]).map((p) => p.memberId)).toEqual(['m1', 'm3', 'm2'])
  })

  it('failures do not use up the cap: a broken member is skipped and others still get written', async () => {
    settingValues.set('crews.rosterAutoAddMaxPerRun', 1)
    const { ms, rows } = crewFixture(['ops'], 3)
    const { RosterWritebackError } = await import('@/app/lib/roster-writeback')
    const { deps, cells } = makeDeps({
      loadRows: async () => rows,
      loadMembers: async () => ms,
      loadPageRosters: async () => ({ rosters: new Map(), sheetSourced: [] }),
      loadHeldRoles: async () => new Map(),
    })
    for (const m of ms) cells.set(m.id, [])
    const inner = deps.updateCrews
    deps.updateCrews = vi.fn(async (i) => {
      if (i.memberId === ms[0].id || i.memberId === ms[1].id) throw new RosterWritebackError('not found', 404)
      return inner(i)
    })
    const r = await runRosterAutoAdd({}, deps)
    expect(r).toMatchObject({ added: 1, failed: 2 })
    expect(cells.get(ms[2].id)).toEqual(['ops'])
  })

  it('a 403 on a crew role stops that crew\'s grants for the run, other crews continue', async () => {
    settingValues.set('crews.rosterAutoAddMaxPerRun', 10)
    const { ms, rows } = crewFixture(['comms', 'ops'], 2)
    const roleOf: Record<string, string> = { comms: '111', ops: '222' }
    const { deps, cells } = makeDeps({
      loadRows: async () => rows,
      loadMembers: async () => ms,
      loadCrews: async () => [{ id: 'comms', role: '111' }, { id: 'ops', role: '222' }],
      loadPageRosters: async () => ({ rosters: new Map(), sheetSourced: [] }),
      loadHeldRoles: async () => new Map(ms.map((m) => [m.discordId, new Set<string>()])),
      writeRole: vi.fn(async (op) => ({ status: (op as { roleId: string }).roleId === roleOf.comms ? 403 : 204, remaining: 5, resetAfterMs: null, retryAfterMs: null, blocked: false })),
    })
    for (const m of ms) cells.set(m.id, [])
    const r = await runRosterAutoAdd({}, deps)
    const calls = (deps.writeRole as ReturnType<typeof vi.fn>).mock.calls.map(([op]) => op.roleId)
    expect(calls.filter((c) => c === '111')).toHaveLength(1)
    expect(calls.filter((c) => c === '222')).toHaveLength(2)
    expect(r).toMatchObject({ crewsRoleBlocked: 1, roleFailed: 1, roleGranted: 2, added: 4 })
  })
})
