// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  callAttendance: { findMany: vi.fn() },
  attendanceEdit: { findMany: vi.fn() },
}))
vi.mock('@/app/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/app/api/lib/google-sheets', () => ({ sheetsClient: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn() }))
vi.mock('@/app/lib/sheets/gviz', () => ({ fetchGviz: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ getSheetData: vi.fn() }))

import { idsToSkipForSheetSync } from './attendance'

const A = '111111111111111111'
const B = '222222222222222222'
const C = '333333333333333333'
const day = new Date('2026-11-02T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.callAttendance.findMany.mockResolvedValue([])
  prismaMock.attendanceEdit.findMany.mockResolvedValue([])
})

describe('sheet sync skips', () => {
  it('asks for every row that is not from a sheet (recording and manual)', async () => {
    prismaMock.callAttendance.findMany.mockResolvedValue([{ discordId: A }, { discordId: B }])
    const skip = await idsToSkipForSheetSync(['ops'], day, [A, B, C])
    expect(prismaMock.callAttendance.findMany.mock.calls[0][0].where.source).toEqual({ not: 'sheet' })
    expect([...skip].sort()).toEqual([A, B])
  })

  it('skips someone whose latest admin edit is a remove, but not after a later add', async () => {
    prismaMock.attendanceEdit.findMany.mockResolvedValue([
      { discordId: A, action: 'remove' },
      { discordId: B, action: 'remove' },
      { discordId: B, action: 'add' },
    ])
    const skip = await idsToSkipForSheetSync(['ops'], day, [A, B, C])
    expect([...skip]).toEqual([A])
  })
})
