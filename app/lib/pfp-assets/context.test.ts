// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: {
    missionCompletion: { findMany: vi.fn(async () => []) },
    inventory: { findMany: vi.fn(async () => []) },
    pfpAssetGrant: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn(async () => []) }))

import { getCurrentLevel } from '@/app/lib/missions'
import { loadUnlockContext } from './context'

describe('loadUnlockContext', () => {
  it('feeds the highest COMPLETED level into the rules (working-on minus one)', async () => {
    vi.mocked(getCurrentLevel).mockResolvedValue(4)
    expect((await loadUnlockContext('1')).level).toBe(3)
    vi.mocked(getCurrentLevel).mockResolvedValue(1)
    expect((await loadUnlockContext('1')).level).toBe(0)
  })
  it('falls back to 0 (nothing completed) if the level cannot be read', async () => {
    vi.mocked(getCurrentLevel).mockRejectedValue(new Error('x'))
    expect((await loadUnlockContext('1')).level).toBe(0)
  })
})
