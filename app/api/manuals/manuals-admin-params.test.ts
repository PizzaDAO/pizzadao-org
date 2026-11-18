// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const isAdminSession = vi.fn()
const fetchGviz = vi.fn()
const cacheDel = vi.fn()
const getManualLinks = vi.fn()
const getManualLinksDebug = vi.fn()
vi.mock('@/app/lib/auth-guards', () => ({ isAdminSession: () => isAdminSession() }))
vi.mock('@/app/lib/sheets/gviz', () => ({ fetchGviz: (...a: unknown[]) => fetchGviz(...a) }))
vi.mock('@/app/api/lib/cache', () => ({ cacheDel: (...a: unknown[]) => cacheDel(...a) }))
vi.mock('@/app/api/lib/google-sheets', () => ({
  getManualLinks: (...a: unknown[]) => getManualLinks(...a),
  getManualLinksDebug: (...a: unknown[]) => getManualLinksDebug(...a),
}))
vi.mock('@/app/lib/manuals', () => ({
  manualsFromDb: vi.fn(async () => false),
  listManualsFromDb: vi.fn(async () => []),
  decorateManuals: vi.fn(),
  parseManualsTable: vi.fn(() => []),
}))
vi.mock('@/app/lib/table-parser', () => ({ isTablesModeDetected: vi.fn(() => false) }))

import { GET as LIST } from './route'
import { GET as ONE } from './[id]/route'

beforeEach(() => {
  vi.clearAllMocks()
  fetchGviz.mockResolvedValue({ table: { rows: [] } })
  getManualLinks.mockResolvedValue({})
  getManualLinksDebug.mockResolvedValue({ linkMap: {}, internals: 1 })
})

const url = (p: string) => `https://x.test/api/manuals${p}?fresh=1&debug=1`

describe('manuals ?fresh and ?debug', () => {
  it('ignore both for non-admins (list)', async () => {
    isAdminSession.mockResolvedValue(false)
    const res = await LIST(new Request(url('')))
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('_debug')
    expect(cacheDel).not.toHaveBeenCalled()
    expect(getManualLinksDebug).not.toHaveBeenCalled()
  })

  it('honour both for admins (list)', async () => {
    isAdminSession.mockResolvedValue(true)
    const res = await LIST(new Request(url('')))
    expect(await res.json()).toHaveProperty('_debug')
    expect(cacheDel).toHaveBeenCalled()
  })

  it('ignore both for non-admins (single)', async () => {
    isAdminSession.mockResolvedValue(false)
    await ONE(new Request(url('/0')), { params: Promise.resolve({ id: '0' }) })
    expect(cacheDel).not.toHaveBeenCalled()
    expect(getManualLinksDebug).not.toHaveBeenCalled()
  })

  it('honour both for admins (single)', async () => {
    isAdminSession.mockResolvedValue(true)
    await ONE(new Request(url('/0')), { params: Promise.resolve({ id: '0' }) })
    expect(cacheDel).toHaveBeenCalled()
    expect(getManualLinksDebug).toHaveBeenCalled()
  })
})
