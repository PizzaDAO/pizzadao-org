// Mission reviewer authorization (plans/mission-verification.md §5.1, D10).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db', () => ({ prisma: {} }))
vi.mock('./discord', () => ({ getUserRoles: vi.fn() }))

import { canReviewMission, canReviewAnyMission, missionReviewScope, missionReviewerRoleIds } from './mission-review-access'
import { getUserRoles } from './discord'
import { ADMIN_ROLE_IDS, MISSION_REVIEWER_ROLE_IDS } from '@/app/ui/constants'

const LEONARDO = ADMIN_ROLE_IDS[0]
const DPR = '812131585327235113'
const CAPO = '839206162837798945'
const PEP_MAFIA = '823266914834841610'
const RANDOM = '999999999999999999'

const roles = vi.mocked(getUserRoles)

beforeEach(() => vi.clearAllMocks())

describe('canReviewMission (by role list)', () => {
  it.each([
    ['Leonardo (admin)', LEONARDO],
    ['Dread Pizza Roberts', DPR],
    ['Pizza Capo', CAPO],
    ['Pepperoni Mafia', PEP_MAFIA],
  ])('%s may review L1–L7', async (_name, role) => {
    for (let level = 1; level <= 7; level++) {
      await expect(canReviewMission([role], level)).resolves.toBe(true)
    }
  })

  it('only Dread Pizza Roberts may review L8', async () => {
    await expect(canReviewMission([DPR], 8)).resolves.toBe(true)
    for (const role of [LEONARDO, CAPO, PEP_MAFIA]) {
      await expect(canReviewMission([role], 8)).resolves.toBe(false)
    }
  })

  it('nobody else, and no invalid levels', async () => {
    await expect(canReviewMission([RANDOM], 1)).resolves.toBe(false)
    await expect(canReviewMission([], 1)).resolves.toBe(false)
    await expect(canReviewMission([DPR], 0)).resolves.toBe(false)
    await expect(canReviewMission([DPR], 1.5)).resolves.toBe(false)
  })

  it('the L1–L7 set is the admin roles plus every pinged reviewer role', () => {
    expect([...missionReviewerRoleIds(3)].sort()).toEqual([...new Set([...ADMIN_ROLE_IDS, ...MISSION_REVIEWER_ROLE_IDS])].sort())
    expect(missionReviewerRoleIds(8)).toEqual([DPR])
  })
})

describe('canReviewMission (by Discord id)', () => {
  it('looks the roles up via the bot', async () => {
    roles.mockResolvedValue([CAPO])
    await expect(canReviewMission('u1', 4)).resolves.toBe(true)
    expect(roles).toHaveBeenCalledWith('u1')
  })

  it('fails closed when the lookup throws', async () => {
    roles.mockRejectedValue(new Error('discord down'))
    await expect(canReviewMission('u1', 4)).resolves.toBe(false)
  })
})

describe('missionReviewScope / canReviewAnyMission', () => {
  it('Pizza Capo sees L1–L7 but not L8', async () => {
    const scope = await missionReviewScope([CAPO])
    expect(scope).not.toBeNull()
    expect(scope!(1)).toBe(true)
    expect(scope!(7)).toBe(true)
    expect(scope!(8)).toBe(false)
  })

  it('Dread Pizza Roberts sees every level', async () => {
    const scope = await missionReviewScope([DPR])
    expect([1, 5, 7, 8].map((l) => scope!(l))).toEqual([true, true, true, true])
  })

  it('a non-reviewer gets null / false', async () => {
    await expect(missionReviewScope([RANDOM])).resolves.toBeNull()
    await expect(canReviewAnyMission([RANDOM])).resolves.toBe(false)
    await expect(canReviewAnyMission([PEP_MAFIA])).resolves.toBe(true)
  })
})
