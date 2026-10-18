import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchGuildMember = vi.fn()
const getGuildRoles = vi.fn()
vi.mock('@/app/lib/discord', () => ({ fetchGuildMember: (...a: unknown[]) => fetchGuildMember(...a) }))
vi.mock('@/app/lib/discord-interactions/guild-roles', () => ({
  getGuildRoles: (...a: unknown[]) => getGuildRoles(...a),
}))

import { boxMafiaStatus, getBoxMafiaStatus, resolveBoxMafiaRoleId } from './box-mafia'

const ROLES = [
  { id: '111111', name: 'Pizza Mafia' },
  { id: '222222', name: '📦 Box-Mafia' },
]

describe('resolveBoxMafiaRoleId', () => {
  afterEach(() => {
    delete process.env.BOX_MAFIA_ROLE_ID
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

describe('getBoxMafiaStatus', () => {
  beforeEach(() => {
    fetchGuildMember.mockReset()
    getGuildRoles.mockReset()
    process.env.DISCORD_GUILD_ID = 'g1'
    getGuildRoles.mockResolvedValue(ROLES)
  })
  afterEach(() => {
    delete process.env.DISCORD_GUILD_ID
  })

  it('is unknown when the guild member is unavailable', async () => {
    fetchGuildMember.mockResolvedValue(null)
    expect(await getBoxMafiaStatus('u1')).toBe('unknown')
  })

  it('is missing / has_role from the fetched member', async () => {
    fetchGuildMember.mockResolvedValue({ roles: ['111111'] })
    expect(await getBoxMafiaStatus('u1')).toBe('missing')
    fetchGuildMember.mockResolvedValue({ roles: ['222222'] })
    expect(await getBoxMafiaStatus('u1')).toBe('has_role')
  })

  it('reuses provided member roles without fetching the member', async () => {
    expect(await getBoxMafiaStatus('u1', ['111111'])).toBe('missing')
    expect(fetchGuildMember).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    fetchGuildMember.mockRejectedValue(new Error('boom'))
    expect(await getBoxMafiaStatus('u1')).toBe('unknown')
  })
})
