// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { unlockedAssetIds, type UnlockContext } from './unlocks'
import { cleanTransform, lockHint, parseRule, type AssetLike } from './types'

const ctx = (over: Partial<UnlockContext> = {}): UnlockContext => ({
  level: 1,
  roleIds: new Set<string>(),
  approvedMissionIds: new Set<number>(),
  itemIds: new Set<number>(),
  grantIds: new Set<number>(),
  ...over,
})
const asset = (id: number, rules: AssetLike['rules'], isActive = true): AssetLike => ({ id, isActive, rules })

describe('unlockedAssetIds', () => {
  it('level rule: at or above minLevel', () => {
    const a = [asset(1, [{ kind: 'level', params: { minLevel: 4 } }])]
    expect([...unlockedAssetIds(a, ctx({ level: 3 }))]).toEqual([])
    expect([...unlockedAssetIds(a, ctx({ level: 4 }))]).toEqual([1])
    expect([...unlockedAssetIds(a, ctx({ level: 9 }))]).toEqual([1])
  })

  it('role rule', () => {
    const a = [asset(1, [{ kind: 'role', params: { roleId: '111111' } }])]
    expect(unlockedAssetIds(a, ctx({ roleIds: new Set(['222222']) })).size).toBe(0)
    expect(unlockedAssetIds(a, ctx({ roleIds: new Set(['111111']) })).has(1)).toBe(true)
  })

  it('mission rule', () => {
    const a = [asset(1, [{ kind: 'mission', params: { missionId: 7 } }])]
    expect(unlockedAssetIds(a, ctx()).size).toBe(0)
    expect(unlockedAssetIds(a, ctx({ approvedMissionIds: new Set([7]) })).has(1)).toBe(true)
  })

  it('item rule', () => {
    const a = [asset(1, [{ kind: 'item', params: { itemId: 3 } }])]
    expect(unlockedAssetIds(a, ctx()).size).toBe(0)
    expect(unlockedAssetIds(a, ctx({ itemIds: new Set([3]) })).has(1)).toBe(true)
  })

  it('everyone rule', () => {
    expect(unlockedAssetIds([asset(1, [{ kind: 'everyone', params: {} }])], ctx()).has(1)).toBe(true)
  })

  it('OR semantics: any one matching rule unlocks', () => {
    const a = [asset(1, [{ kind: 'level', params: { minLevel: 8 } }, { kind: 'role', params: { roleId: '111111' } }])]
    expect(unlockedAssetIds(a, ctx({ level: 2 })).size).toBe(0)
    expect(unlockedAssetIds(a, ctx({ level: 2, roleIds: new Set(['111111']) })).has(1)).toBe(true)
    expect(unlockedAssetIds(a, ctx({ level: 8 })).has(1)).toBe(true)
  })

  it('inactive assets are never unlocked, even with a grant or an everyone rule', () => {
    const a = [asset(1, [{ kind: 'everyone', params: {} }], false), asset(2, [], false)]
    expect(unlockedAssetIds(a, ctx({ grantIds: new Set([2]) })).size).toBe(0)
  })

  it('manual grants unlock an asset with no matching rule', () => {
    const a = [asset(1, [{ kind: 'level', params: { minLevel: 8 } }]), asset(2, [])]
    expect([...unlockedAssetIds(a, ctx({ grantIds: new Set([1, 2]) }))].sort()).toEqual([1, 2])
    expect(unlockedAssetIds(a, ctx()).size).toBe(0)
  })

  it('accepts arrays as well as sets in the context', () => {
    const a = [asset(1, [{ kind: 'role', params: { roleId: '111111' } }])]
    expect(unlockedAssetIds(a, ctx({ roleIds: ['111111'] })).has(1)).toBe(true)
  })

  it('malformed rule params never match', () => {
    const a = [asset(1, [{ kind: 'level', params: {} }, { kind: 'role', params: {} }])]
    expect(unlockedAssetIds(a, ctx({ level: 99 })).size).toBe(0)
  })
})

describe('parseRule', () => {
  it('cleans and validates each kind', () => {
    expect(parseRule({ kind: 'level', params: { minLevel: '5' } })).toEqual({ ok: true, rule: { kind: 'level', params: { minLevel: 5 } } })
    expect(parseRule({ kind: 'level', params: { minLevel: 0 } }).ok).toBe(false)
    expect(parseRule({ kind: 'role', params: { roleId: 'abc' } }).ok).toBe(false)
    expect(parseRule({ kind: 'role', params: { roleId: '123456789012345678', extra: 1 } })).toEqual({
      ok: true,
      rule: { kind: 'role', params: { roleId: '123456789012345678' } },
    })
    expect(parseRule({ kind: 'mission', params: { missionId: 1.5 } }).ok).toBe(false)
    expect(parseRule({ kind: 'item', params: { itemId: 2 } }).ok).toBe(true)
    expect(parseRule({ kind: 'everyone' }).ok).toBe(true)
    expect(parseRule({ kind: 'nope', params: {} }).ok).toBe(false)
    expect(parseRule(null).ok).toBe(false)
  })
})

describe('lockHint', () => {
  it('prefers the admin hint, else builds one from the rules', () => {
    expect(lockHint({ lockedHint: ' Hello ', rules: [] })).toBe('Hello')
    const rules = [{ kind: 'level' as const, params: { minLevel: 5 } }, { kind: 'role' as const, params: { roleId: '9' } }]
    expect(lockHint({ rules }, { levelTitles: new Map([[5, 'Made Member']]), roleNames: new Map([['9', 'Dread Pizza Roberts']]) })).toBe(
      'Reach Level 5 - Made Member or Dread Pizza Roberts only',
    )
    expect(lockHint({ rules: [] })).toBe('Not available yet')
  })
})

describe('cleanTransform', () => {
  it('clamps and falls back', () => {
    expect(cleanTransform({ x: 5, y: -1, scale: 99, rotation: 'x' })).toEqual({ x: 1, y: 0, scale: 3, rotation: 0 })
    expect(cleanTransform(null, { x: 0.2, scale: 0.5 })).toEqual({ x: 0.2, y: 0.5, scale: 0.5, rotation: 0 })
  })
})
