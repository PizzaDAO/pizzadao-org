// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { buildLevelInfo } from './level-info'

const M = [
  { id: 1, level: 1, index: 0, title: 'Join Discord', levelTitle: 'Rookie' },
  { id: 2, level: 2, index: 0, title: 'Join a crew', levelTitle: 'Line Cook' },
  { id: 3, level: 2, index: 1, title: 'Selfie interview', levelTitle: 'Line Cook' },
  { id: 4, level: 2, index: 2, title: 'Connect X', levelTitle: 'Line Cook' },
  { id: 5, level: 3, index: 0, title: 'Invite a friend', levelTitle: 'Sous Chef' },
]

describe('buildLevelInfo', () => {
  it('lists the current level with each mission done / pending / todo', () => {
    const info = buildLevelInfo(2, M, [
      { missionId: 2, status: 'APPROVED' },
      { missionId: 3, status: 'PENDING' },
      { missionId: 4, status: 'REJECTED' },
    ])
    expect(info.title).toBe('Line Cook')
    expect(info.missions.map((m) => [m.title, m.state])).toEqual([
      ['Join a crew', 'done'],
      ['Selfie interview', 'pending'],
      ['Connect X', 'todo'],
    ])
    expect(info.done).toBe(1)
    expect(info.total).toBe(3)
    expect(info.nextTitle).toBe('Sous Chef')
    expect(info.isMax).toBe(false)
  })

  it('an approved completion wins over an older pending or rejected one', () => {
    const info = buildLevelInfo(2, M, [
      { missionId: 2, status: 'APPROVED' },
      { missionId: 2, status: 'REJECTED' },
    ])
    expect(info.missions[0].state).toBe('done')
  })

  it('level above the highest is MAX with no missions or next title', () => {
    const info = buildLevelInfo(4, M, [])
    expect(info.isMax).toBe(true)
    expect(info.missions).toEqual([])
    expect(info.nextTitle).toBeNull()
    expect(info.maxLevel).toBe(3)
  })

  it('does not change the mission rules: it only reads them', () => {
    const info = buildLevelInfo(1, M, [])
    expect(info.missions.map((m) => m.title)).toEqual(['Join Discord'])
  })
})
