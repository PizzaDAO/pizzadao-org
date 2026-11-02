// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const crewRow = (id: string, label: string) => ({
  id, label, emoji: null, turtles: [], role: null, channel: null, event: null, callTime: null, callTimeUrl: null,
  callLength: null, type: null, script: null, legacySheetUrl: null, sortOrder: 0, archived: false,
})
const db = { crews: [crewRow('ops', 'Ops'), { ...crewRow('art', 'Art'), sortOrder: 1 }] }
vi.mock('@/app/lib/db', () => ({
  prisma: {
    crew: {
      findMany: vi.fn(async () => db.crews),
      upsert: vi.fn((args: unknown) => ({ op: 'upsert', args })),
      update: vi.fn((args: unknown) => ({ op: 'update', args })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))
vi.mock('@/app/api/lib/google-sheets', () => ({ getManualLinks: vi.fn(), getTaskLinks: vi.fn(async () => ({})), getColumnHyperlinks: vi.fn(async () => ({})) }))
vi.mock('@/app/api/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn(), CACHE_TTL: {} }))

import { prisma } from '@/app/lib/db'
import { crewsEditor } from './crews'
import { cleanRows, EditorError } from './editor'

beforeEach(() => vi.mocked(prisma.crew.upsert).mockClear())

describe('crews editor keeps crew ids', () => {
  it('renaming a crew only changes its label; its id (and everything keyed on it) stays', async () => {
    const rows = cleanRows(crewsEditor, [
      { id: 'ops', label: 'Operations' },
      { id: 'art', label: 'Art' },
    ])
    const counts = await crewsEditor.save(rows, 'admin')
    expect(counts).toMatchObject({ created: 0, updated: 1, deactivated: 0 })
    const call = vi.mocked(prisma.crew.upsert).mock.calls[0][0] as { where: { id: string }; update: { label: string } }
    expect(call.where.id).toBe('ops')
    expect(call.update.label).toBe('Operations')
  })

  it('a new crew gets its id from its name; a clash with an existing crew is refused', async () => {
    const rows = cleanRows(crewsEditor, [{ id: 'ops', label: 'Ops' }, { id: 'art', label: 'Art' }, { label: 'Music Crew' }])
    await crewsEditor.save(rows, 'admin')
    const created = vi.mocked(prisma.crew.upsert).mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id)
    expect(created).toEqual(['music_crew'])
    const clash = cleanRows(crewsEditor, [{ id: 'ops', label: 'Ops' }, { label: 'ops' }])
    await expect(crewsEditor.save(clash, 'admin')).rejects.toBeInstanceOf(EditorError)
  })
})
