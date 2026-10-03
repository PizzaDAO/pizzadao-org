// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_ROLE_INCOME, normalizeRoleName, resolveRoleIncome, roleIncomeConfig } from '../income'
import { clearGuildRolesCache, getGuildRoles } from '../../discord-interactions/guild-roles'
import { parseGrantCsv, splitCsvLine } from '../../shop-grants'

describe('role income config', () => {
  it('ports the 11 UnbelievaBoat roles and amounts as-is', () => {
    expect(Object.fromEntries(DEFAULT_ROLE_INCOME.map((r) => [r.name, r.amount]))).toEqual({
      Pizzaiolo: 690,
      'Dread Pizza Roberts': 420,
      'Pizza Holder': 69,
      'Pizza Mafia': 69,
      'Pizza Capo': 69,
      'Crew Member': 42,
      'Box Mafia': 42,
      'Pizza Sticks Holder': 8,
      'Pizza Pop Holder': 8,
      'Pizza Tattoo Club': 8,
      'Pockets Checked': 1,
    })
    expect(DEFAULT_ROLE_INCOME.every((r) => r.intervalHours === 24)).toBe(true)
  })

  it('ROLE_INCOME_JSON overrides the table, and an invalid override falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(roleIncomeConfig('[{"name":"Crew Member","amount":50}]')).toEqual([{ name: 'Crew Member', amount: 50, intervalHours: 24 }])
    expect(roleIncomeConfig('[{"name":"Crew Member","amount":-5}]')).toBe(DEFAULT_ROLE_INCOME)
    expect(roleIncomeConfig('not json')).toBe(DEFAULT_ROLE_INCOME)
    expect(roleIncomeConfig(undefined)).toBe(DEFAULT_ROLE_INCOME)
    warn.mockRestore()
  })

  it('resolves names against guild roles, ignoring case, emoji and punctuation; ambiguous names stay unresolved', () => {
    expect(normalizeRoleName('🍕 Pizza-Holder')).toBe('pizzaholder')
    const { resolved, unresolved } = resolveRoleIncome(
      [
        { name: 'Pizza Holder', amount: 69, intervalHours: 24 },
        { name: 'Crew Member', amount: 42, intervalHours: 24 },
        { name: 'Box Mafia', amount: 42, intervalHours: 24 },
        { name: 'Pizza Capo', amount: 69, intervalHours: 24, roleId: '839206162837798945' },
      ],
      [
        { id: '1', name: '🍕 pizza holder' },
        { id: '2', name: 'Crew Member' },
        { id: '3', name: 'crew-member' },
      ],
    )
    expect(resolved.map((r) => [r.name, r.roleId])).toEqual([
      ['Pizza Holder', '1'],
      ['Pizza Capo', '839206162837798945'],
    ])
    expect(unresolved).toEqual(['Crew Member', 'Box Mafia'])
  })
})

describe('guild roles cache', () => {
  beforeEach(() => clearGuildRolesCache())

  it('fetches once per hour and keeps the stale list when a refresh fails', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ id: '1', name: 'Crew Member' }]), { status: 200 }))
    const a = await getGuildRoles('g', { botToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch, now: 0 })
    const b = await getGuildRoles('g', { botToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch, now: 1000 })
    expect(a).toEqual([{ id: '1', name: 'Crew Member' }])
    expect(b).toBe(a)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = vi.fn(async () => new Response('nope', { status: 500 }))
    expect(await getGuildRoles('g', { botToken: 't', fetchImpl: failing as unknown as typeof fetch, now: 2 * 3_600_000 })).toEqual(a)
    warn.mockRestore()
  })

  it('returns null without a bot token', async () => {
    expect(await getGuildRoles('g', { botToken: '' })).toBeNull()
  })
})

describe('item grant CSV', () => {
  it('splits quoted cells', () => {
    expect(splitCsvLine('1,"Pizza, Sticks",2')).toEqual(['1', 'Pizza, Sticks', '2'])
    expect(splitCsvLine('1,"say ""hi""",2')).toEqual(['1', 'say "hi"', '2'])
  })

  it('parses rows, skips the header and comments, and reports bad lines', () => {
    const { rows, errors } = parseGrantCsv(
      ['discordId,item,qty', '# carried over from UB', '100000000000000001,Rare Pizza Box,1', '', 'abc,Pizza Sticks,1', '100000000000000002,Pizza Sticks,0', '100000000000000003,Proof of Pizza'].join('\n'),
    )
    expect(rows).toEqual([{ line: 3, discordId: '100000000000000001', item: 'Rare Pizza Box', qty: 1 }])
    expect(errors).toEqual([
      'line 5: bad discordId "abc"',
      'line 6: qty must be a positive whole number',
      'line 7: expected 3 columns (discordId,item,qty)',
    ])
  })
})
