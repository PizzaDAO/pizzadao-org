// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const swr = vi.hoisted(() => ({ swrGet: vi.fn(), swrInvalidate: vi.fn(async () => {}) }))
vi.mock('@/app/lib/swr-cache', () => swr)
vi.mock('@/app/api/lib/cache', () => ({ cacheDel: vi.fn(), CACHE_TTL: { CREW_MAPPINGS: 300 } }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getTaskLinks: vi.fn(), getColumnHyperlinks: vi.fn() }))

import { invalidateCrewMappingsCache } from './crew-mappings'

describe('crew-mappings cache keys', () => {
  // Preview deployments share the cache with production: no key may ever hold two formats.
  it('invalidating deletes every earlier format and bumps the current keys', async () => {
    await invalidateCrewMappingsCache()
    const calls = swr.swrInvalidate.mock.calls as unknown as string[][]
    const [db, sheet] = calls
    expect(db[0]).toBe('crew-mappings:db:v3:swr')
    expect(db.slice(1)).toEqual(['crew-mappings:db:v1', 'crew-mappings:db:v2', 'crew-mappings:db:v2:swr'])
    expect(sheet[0]).toMatch(/^crew-mappings:v9:swr:/)
    const id = sheet[0].slice('crew-mappings:v9:swr:'.length)
    expect(sheet.slice(1)).toEqual([`crew-mappings:v7:${id}`, `crew-mappings:v8:${id}`, `crew-mappings:v8:swr:${id}`])
  })
})
