// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/crew-mappings', () => ({
  getCrewMappings: vi.fn(async () => ({
    crews: [
      { id: 'ops', label: 'Ops Crew', event: 'https://discord.com/events/1/123456789012345678' },
      { id: 'x', label: 'No event' },
    ],
    cached: true,
  })),
}))

import { GET } from './route'

const req = (auth?: string) => new Request('http://x/api/calls/recorder/config', { headers: auth ? { authorization: auth } : {} })

describe('GET /api/calls/recorder/config', () => {
  beforeEach(() => {
    process.env.RECORDER_API_KEY = 'secret'
  })
  it('rejects a missing or wrong key', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
  })
  it('returns everything off plus crew labels with the key', async () => {
    const res = await GET(req('Bearer secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.welcome.enabled).toBe(false)
    expect(body.endSong.enabled).toBe(false)
    expect(body.crews).toEqual([{ eventId: '123456789012345678', label: 'Ops Crew' }])
    expect(JSON.stringify(body)).not.toContain('secret')
  })
})
