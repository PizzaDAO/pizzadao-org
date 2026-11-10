// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const loadSettings = vi.fn()
const compute = vi.fn()
vi.mock('@/app/lib/settings', () => ({ loadSettings: () => loadSettings() }))
vi.mock('@/app/lib/map-levels/service', () => ({ computePublicMapLevels: (...a: unknown[]) => compute(...a) }))

import { GET, OPTIONS } from './route'

const settings = (enabled: boolean) => ({
  readFailed: false,
  invalidKeys: [],
  isSet: () => true,
  get: (k: string) => (k === 'map.levelsEnabled' ? enabled : k === 'map.cacheSeconds' ? 3600 : undefined),
})

beforeEach(() => {
  loadSettings.mockReset()
  compute.mockReset()
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('MAP_LEVELS_ENABLED', '')
})

describe('GET /api/public/map-levels', () => {
  it('404s while the switch is off, without touching the database', async () => {
    loadSettings.mockResolvedValue(settings(false))
    const res = await GET()
    expect(res.status).toBe(404)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(compute).not.toHaveBeenCalled()
  })

  it('the env kill switch wins over a saved ON', async () => {
    vi.stubEnv('MAP_LEVELS_ENABLED', '0')
    loadSettings.mockResolvedValue(settings(true))
    expect((await GET()).status).toBe(404)
  })

  it('200 with CORS and the public cache header when on', async () => {
    loadSettings.mockResolvedValue(settings(true))
    compute.mockResolvedValue({ version: 1, generatedAt: 'x', tiers: [], cities: [], countries: [] })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
    expect((await res.json()).version).toBe(1)
  })

  it('503 with a short cache when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    loadSettings.mockResolvedValue(settings(true))
    compute.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=60')
  })

  it('OPTIONS answers 204 with CORS', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })
})
