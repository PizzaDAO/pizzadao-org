import { describe, it, expect, afterEach } from 'vitest'

import { boxMafiaDailyPep, boxMafiaStatus, resolveBoxMafiaRoleId } from './box-mafia'

const ROLES = [
  { id: '111111', name: 'Pizza Mafia' },
  { id: '222222', name: '📦 Box-Mafia' },
]

describe('resolveBoxMafiaRoleId', () => {
  afterEach(() => {
    delete process.env.BOX_MAFIA_ROLE_ID
    delete process.env.ROLE_INCOME_JSON
  })

  it('prefers a valid env id', () => {
    process.env.BOX_MAFIA_ROLE_ID = '999999'
    expect(resolveBoxMafiaRoleId(ROLES)).toBe('999999')
    expect(resolveBoxMafiaRoleId(null)).toBe('999999')
  })

  it('ignores an invalid env id', () => {
    process.env.BOX_MAFIA_ROLE_ID = 'nope'
    expect(resolveBoxMafiaRoleId(ROLES)).toBe('222222')
  })

  it('matches by name ignoring case, spaces and emoji', () => {
    expect(resolveBoxMafiaRoleId(ROLES)).toBe('222222')
    expect(resolveBoxMafiaRoleId([{ id: '5', name: 'BOX  mafia' }])).toBe('5')
  })

  it('uses the ROLE_INCOME_JSON roleId after the env override', () => {
    process.env.ROLE_INCOME_JSON = JSON.stringify([{ name: 'Box Mafia', amount: 50, roleId: '777777' }])
    expect(resolveBoxMafiaRoleId(ROLES)).toBe('777777')
    process.env.BOX_MAFIA_ROLE_ID = '999999'
    expect(resolveBoxMafiaRoleId(ROLES)).toBe('999999')
    expect(boxMafiaDailyPep()).toBe(50)
    delete process.env.ROLE_INCOME_JSON
    expect(boxMafiaDailyPep()).toBe(42)
  })

  it('returns null for zero, several, or unavailable roles', () => {
    expect(resolveBoxMafiaRoleId([{ id: '1', name: 'Pizza Mafia' }])).toBeNull()
    expect(
      resolveBoxMafiaRoleId([
        { id: '1', name: 'Box Mafia' },
        { id: '2', name: 'box-mafia' },
      ]),
    ).toBeNull()
    expect(resolveBoxMafiaRoleId(null)).toBeNull()
  })
})

describe('boxMafiaStatus', () => {
  it('reports has_role / missing / unknown', () => {
    expect(boxMafiaStatus(['a', '222222'], '222222')).toBe('has_role')
    expect(boxMafiaStatus(['a'], '222222')).toBe('missing')
    expect(boxMafiaStatus(null, '222222')).toBe('unknown')
    expect(boxMafiaStatus(['a'], null)).toBe('unknown')
  })
})
