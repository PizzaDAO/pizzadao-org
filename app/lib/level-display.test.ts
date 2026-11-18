// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const getCurrentLevel = vi.fn()
vi.mock('@/app/lib/db', () => ({
  prisma: {
    missionCompletion: { findMany: vi.fn(async () => []) },
    inventory: { findMany: vi.fn(async () => []) },
    pfpAssetGrant: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: (...a: unknown[]) => getCurrentLevel(...a) }))
vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn(async () => []) }))

import { completedLevel, titleForLevel } from './level-display'
import { loadUnlockContext } from './pfp-assets/context'

describe('completedLevel / titleForLevel', () => {
  it('is the working-on level minus one, never below 0', () => {
    expect(completedLevel(8)).toBe(7)
    expect(completedLevel(2)).toBe(1)
    expect(completedLevel(1)).toBe(0)
    expect(completedLevel(0)).toBe(0)
  })

  it('looks a title up by level number', () => {
    const rows = [
      { level: 7, levelTitle: 'Made Mafia' },
      { level: 8, levelTitle: 'Don of Dons' },
    ]
    expect(titleForLevel(rows, completedLevel(8))).toBe('Made Mafia')
    expect(titleForLevel(rows, 0)).toBeNull()
    expect(titleForLevel(rows, 3)).toBeNull()
  })
})

describe('PFP unlock rules use the completed level', () => {
  it('the PFP unlock context carries the highest completed level (getCurrentLevel minus one)', async () => {
    getCurrentLevel.mockResolvedValue(8)
    expect((await loadUnlockContext('1')).level).toBe(7)
  })
})
