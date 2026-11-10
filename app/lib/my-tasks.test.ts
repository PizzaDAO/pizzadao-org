import { describe, it, expect, vi, beforeEach } from 'vitest'

const usesDb = vi.fn()
const myTasksFromDb = vi.fn()
const fetchGviz = vi.fn()

vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: (...a: unknown[]) => usesDb(...a) }))
vi.mock('@/app/lib/crew-content', () => ({ myTasksFromDb: (...a: unknown[]) => myTasksFromDb(...a) }))
vi.mock('@/app/lib/sheets/gviz', () => ({ fetchGviz: (...a: unknown[]) => fetchGviz(...a) }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getTaskLinks: async () => ({}) }))

import { fetchMyTasksForCrewOption } from './my-tasks'

beforeEach(() => {
  usesDb.mockReset()
  myTasksFromDb.mockReset()
  fetchGviz.mockReset()
})

describe('fetchMyTasksForCrewOption', () => {
  it('reads the database and never touches Sheets when the crew is on db', async () => {
    usesDb.mockResolvedValue(true)
    myTasksFromDb.mockResolvedValue({ active: [{ label: 'T' }], doneCount: 3 })
    const r = await fetchMyTasksForCrewOption({ id: 'ops', sheet: 'https://docs.google.com/spreadsheets/d/abc/edit' }, 'M1')
    expect(r).toEqual({ active: [{ label: 'T' }], doneCount: 3 })
    expect(fetchGviz).not.toHaveBeenCalled()
  })

  it('returns empty (not a sheet read) when the db read fails', async () => {
    usesDb.mockResolvedValue(true)
    myTasksFromDb.mockRejectedValue(new Error('x'))
    expect(await fetchMyTasksForCrewOption({ id: 'ops', sheet: 'https://docs.google.com/spreadsheets/d/abc' }, 'M1')).toEqual({ active: [], doneCount: 0 })
    expect(fetchGviz).not.toHaveBeenCalled()
  })

  it('falls back to the sheet when the source is sheet', async () => {
    usesDb.mockResolvedValue(false)
    fetchGviz.mockResolvedValue({ table: { rows: [] } })
    await fetchMyTasksForCrewOption({ id: 'ops', sheet: 'https://docs.google.com/spreadsheets/d/abc' }, 'M1')
    expect(fetchGviz).toHaveBeenCalledOnce()
  })

  it('has nothing to read without a sheet when on sheet source', async () => {
    usesDb.mockResolvedValue(false)
    expect(await fetchMyTasksForCrewOption({ id: 'ops' }, 'M1')).toEqual({ active: [], doneCount: 0 })
  })
})
