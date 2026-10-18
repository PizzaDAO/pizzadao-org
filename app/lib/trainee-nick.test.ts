import { describe, it, expect } from 'vitest'
import {
  TRAINEE_NICK,
  isTraineeNick,
  realNick,
  resolvePizzaNoobRoleId,
  planTraineeNicks,
  pizzaNoobCandidates,
  type PlanInput,
  type PlanMember,
} from './trainee-nick'
import { computeCurrentLevel, paidLevelOf } from './missions'

const SINCE = Date.parse('2026-10-18T00:00:00Z')
const AFTER = '2026-10-19T00:00:00Z'
const BEFORE = '2026-10-01T00:00:00Z'
const NOOB = '555555'
const POS = new Map([['100001', 10], ['100002', 119], ['100003', 120], ['100004', 125], [NOOB, 5]])

const m = (id: string, over: Partial<PlanMember> = {}): PlanMember => ({
  id,
  nick: null,
  roles: [],
  joinedAt: AFTER,
  ...over,
})

const plan = (members: PlanMember[], over: Partial<PlanInput> = {}) =>
  planTraineeNicks({
    members,
    signedUp: new Map(),
    ownerId: 'owner',
    botTopPosition: 120,
    rolePositions: POS,
    since: SINCE,
    max: 50,
    pizzaNoobRoleId: NOOB,
    roleAssignable: true,
    completedL2: new Set(),
    ...over,
  })

describe('isTraineeNick / realNick', () => {
  it('matches the placeholder case-insensitively and trimmed', () => {
    expect(isTraineeNick('Pizza Trainee')).toBe(true)
    expect(isTraineeNick(' pizza trainee ')).toBe(true)
    expect(isTraineeNick('Tony')).toBe(false)
    expect(isTraineeNick(null)).toBe(false)
  })
  it('realNick hides the placeholder', () => {
    expect(realNick('Pizza Trainee')).toBeNull()
    expect(realNick('  Tony  ')).toBe('Tony')
    expect(realNick('')).toBeNull()
    expect(realNick(undefined)).toBeNull()
  })
})

describe('resolvePizzaNoobRoleId', () => {
  const roles = [{ id: '111111', name: 'Pizza Noob' }, { id: '222222', name: 'Chef' }]
  it('a valid env override wins', () => expect(resolvePizzaNoobRoleId(roles, '333333')).toBe('333333'))
  it('an invalid override falls through to the name match', () => expect(resolvePizzaNoobRoleId(roles, 'abc')).toBe('111111'))
  it('one name match works', () => expect(resolvePizzaNoobRoleId(roles)).toBe('111111'))
  it('zero matches is null', () => expect(resolvePizzaNoobRoleId([roles[1]])).toBeNull())
  it('several matches is null', () => {
    expect(resolvePizzaNoobRoleId([...roles, { id: '444444', name: 'pizza-noob' }])).toBeNull()
  })
})

describe('planTraineeNicks: nicknames', () => {
  it('enforces null, custom and near-miss nicks, but not the exact placeholder', () => {
    const p = plan([
      m('1', { nick: null, roles: [NOOB] }),
      m('2', { nick: 'Custom', roles: [NOOB] }),
      m('3', { nick: 'pizza trainee ', roles: [NOOB] }),
      m('4', { nick: TRAINEE_NICK, roles: [NOOB] }),
    ])
    expect(p.enforce.map((e) => e.id)).toEqual(['1', '2', '3'])
    expect(p.enforce.every((e) => e.setNick && !e.addRole)).toBe(true)
    expect(p.alreadyTrainee).toBe(1)
  })

  it('skips pre-since, bots, the owner, outranked (equal and higher) and signed-up members', () => {
    const p = plan(
      [
        m('old', { joinedAt: BEFORE }),
        m('bot', { bot: true }),
        m('owner'),
        m('eq', { roles: ['100003'] }),
        m('hi', { roles: ['100004'] }),
        m('lo', { roles: ['100002'] }),
        m('su', { nick: 'Real' }),
      ],
      { signedUp: new Map([['su', 'Real']]), completedL2: new Set() },
    )
    expect(p.enforce.map((e) => e.id)).toEqual(['lo'])
    expect(p.skipped).toEqual({ bot: 1, owner: 1, outranked: 2, signedUp: 1 })
    expect(p.inScope).toBe(6)
  })

  it('heals signed-up members carrying the placeholder, even pre-since; empty Name gives null', () => {
    const p = plan(
      [
        m('a', { nick: TRAINEE_NICK, joinedAt: BEFORE }),
        m('b', { nick: TRAINEE_NICK }),
        m('c', { nick: 'Fine' }),
        m('d', { nick: TRAINEE_NICK }),
      ],
      { signedUp: new Map([['a', 'Tony Pepperoni'], ['b', ''], ['c', 'Fine'], ['d', 'Pizza Trainee']]) },
    )
    expect(p.heal).toEqual([
      { id: 'a', nick: 'Tony Pepperoni' },
      { id: 'b', nick: null },
      { id: 'd', nick: null },
    ])
  })

  it('does not heal outranked signed-up members', () => {
    const p = plan([m('x', { nick: TRAINEE_NICK, roles: ['100004'] })], { signedUp: new Map([['x', 'Name']]) })
    expect(p.heal).toEqual([])
  })

  it('caps heal + sweep + enforce together, heal first, oldest first, reporting overflow', () => {
    const members = [
      m('e1', { joinedAt: '2026-10-19T03:00:00Z' }),
      m('e2', { joinedAt: '2026-10-19T01:00:00Z' }),
      m('e3', { joinedAt: '2026-10-19T02:00:00Z' }),
      m('h1', { nick: TRAINEE_NICK }),
    ]
    const p = plan(members, { signedUp: new Map([['h1', 'Name']]), max: 2, pizzaNoobRoleId: null })
    expect(p.heal.map((h) => h.id)).toEqual(['h1'])
    expect(p.enforce.map((e) => e.id)).toEqual(['e2'])
    expect(p.overflow).toBe(2)
  })
})

describe('planTraineeNicks: Pizza Noob role', () => {
  it('trainee nick without the role gets addRole only', () => {
    const p = plan([m('1', { nick: TRAINEE_NICK })])
    expect(p.enforce).toEqual([{ id: '1', setNick: false, addRole: true }])
  })
  it('the role with a custom nick gets setNick only', () => {
    const p = plan([m('1', { nick: 'Custom', roles: [NOOB] })])
    expect(p.enforce).toEqual([{ id: '1', setNick: true, addRole: false }])
  })
  it('both present is skipped', () => {
    const p = plan([m('1', { nick: TRAINEE_NICK, roles: [NOOB] })])
    expect(p.enforce).toEqual([])
    expect(p.alreadyTrainee).toBe(1)
  })
  it('unresolved or unassignable role: nicks still enforced, nobody gets addRole', () => {
    for (const over of [{ pizzaNoobRoleId: null }, { roleAssignable: false }]) {
      const p = plan([m('1', { nick: 'x' }), m('2', { nick: TRAINEE_NICK })], over)
      expect(p.enforce).toEqual([{ id: '1', setNick: true, addRole: false }])
    }
  })
  it('signed-up members never get addRole', () => {
    const p = plan([m('1', { nick: 'Real' })], { signedUp: new Map([['1', 'Real']]) })
    expect(p.enforce).toEqual([])
  })
})

describe('planTraineeNicks: sweep and no re-add', () => {
  it('an in-scope holder with L2 done gets removeRole, signed up or not', () => {
    const p = plan(
      [m('a', { nick: TRAINEE_NICK, roles: [NOOB] }), m('b', { nick: 'Real', roles: [NOOB] })],
      { signedUp: new Map([['b', 'Real']]), completedL2: new Set(['a', 'b']) },
    )
    expect(p.sweep.map((s) => s.id)).toEqual(['a', 'b'])
    expect(p.enforce).toEqual([])
  })
  it('a pre-go-live holder with L2 is untouched', () => {
    const p = plan([m('a', { roles: [NOOB], joinedAt: BEFORE })], { completedL2: new Set(['a']) })
    expect(p.sweep).toEqual([])
    expect(p.enforce).toEqual([])
  })
  it('a not-signed-up member with L2 done and no role gets setNick only, never addRole', () => {
    const p = plan([m('a', { nick: 'Custom' })], { completedL2: new Set(['a']) })
    expect(p.enforce).toEqual([{ id: 'a', setNick: true, addRole: false }])
  })
  it('an unknown L2 lookup means no addRole and no removeRole', () => {
    const p = plan([m('a', { nick: TRAINEE_NICK }), m('b', { nick: TRAINEE_NICK, roles: [NOOB] })], { completedL2: null })
    expect(p.enforce).toEqual([])
    expect(p.sweep).toEqual([])
  })
  it('never plans both addRole and removeRole for one member', () => {
    const members = [m('a'), m('b', { roles: [NOOB] }), m('c', { nick: TRAINEE_NICK })]
    for (const l2 of [new Set<string>(), new Set(['a', 'b', 'c'])]) {
      const p = plan(members, { completedL2: l2 })
      const adds = new Set(p.enforce.filter((e) => e.addRole).map((e) => e.id))
      expect(p.sweep.some((s) => adds.has(s.id))).toBe(false)
    }
  })
})

describe('pizzaNoobCandidates', () => {
  it('holders and not-signed-up members lacking the role, in scope and renameable', () => {
    const ids = pizzaNoobCandidates({
      members: [
        m('holder', { roles: [NOOB] }),
        m('lacking'),
        m('signed'),
        m('old', { joinedAt: BEFORE }),
        m('bot', { bot: true }),
      ],
      signedUp: new Map([['signed', 'x']]),
      ownerId: 'owner',
      botTopPosition: 120,
      rolePositions: POS,
      since: SINCE,
      pizzaNoobRoleId: NOOB,
      roleAssignable: true,
    })
    expect(ids).toEqual(['holder', 'lacking'])
  })
})

describe('L2 detection (computeCurrentLevel)', () => {
  const missions = [
    { id: 1, level: 1 },
    { id: 2, level: 2 },
    { id: 3, level: 2 },
  ]
  it('L2 approved but L1 incomplete is not completed', () => {
    expect(computeCurrentLevel(missions, new Set([2, 3])) >= 3).toBe(false)
  })
  it('L1 and L2 approved is completed', () => {
    expect(computeCurrentLevel(missions, new Set([1, 2, 3])) >= 3).toBe(true)
  })
  it('paid ledger rows count, including the legacy description format', () => {
    const paid = new Set([
      paidLevelOf({ description: 'Mission reward: Level 1' }),
      paidLevelOf({ description: 'Mission reward: Level 2 - Pizza Noob' }),
    ].filter((l): l is number => l !== null))
    expect(computeCurrentLevel(missions, new Set(), paid) >= 3).toBe(true)
  })
})
