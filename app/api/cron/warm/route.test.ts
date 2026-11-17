// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const settings: Record<string, unknown> = {
  'members.warmEnabled': true,
  'members.warmProfileIds': '1\n2',
  'members.warmPaths': '/\n/missions',
}
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settings[k]) }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn(async (k: string) => settings[k]) }))
vi.mock('@/app/lib/discord-activity-public', () => ({ getPublicChannelNames: vi.fn(async () => null) }))
vi.mock('@/app/lib/db')

import { GET } from './route'
import { parseWarmIds, parseWarmPaths, warmTargets } from '@/app/lib/warm'

const req = (auth?: string) => new NextRequest('https://app.pizzadao.org/api/cron/warm', { headers: auth ? { authorization: auth } : {} })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  settings['members.warmEnabled'] = true
  fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CRON_SECRET
})

describe('/api/cron/warm', () => {
  it('401 without the bearer token, and requests nothing', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing while switched off', async () => {
    settings['members.warmEnabled'] = false
    expect(await (await GET(req('Bearer cron-secret'))).json()).toEqual({ status: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GETs the configured pages and profiles only', async () => {
    const res = await GET(req('Bearer cron-secret'))
    const body = await res.json()
    expect(body.status).toBe('ok')
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).map((u) => new URL(u).pathname)
    expect(urls.sort()).toEqual(['/', '/api/profile-summary/1', '/api/profile-summary/2', '/missions', '/profile/1', '/profile/2'].sort())
    for (const c of fetchMock.mock.calls) expect((c[1] as RequestInit).method).toBe('GET')
  })

  it('a failing request is counted, not thrown', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'))
    const body = await (await GET(req('Bearer cron-secret'))).json()
    expect(body.failed).toBe(1)
  })
})

describe('warm settings parsing', () => {
  it('keeps only numeric ids and site-relative paths', () => {
    expect(parseWarmIds('1\n x \n2\n2\n12345678901\n3')).toEqual(['1', '2', '3'])
    expect(parseWarmPaths('/\n//evil.com\nhttps://evil.com\n/missions\n/a b')).toEqual(['/', '/missions'])
    expect(warmTargets('7', '/x')).toEqual(['/x', '/profile/7', '/api/profile-summary/7'])
  })

  it('is scheduled every 5 minutes in vercel.json', async () => {
    const { readFileSync } = await import('node:fs')
    const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons as Array<{ path: string; schedule: string }>
    expect(crons.filter((c) => c.path === '/api/cron/warm')).toEqual([{ path: '/api/cron/warm', schedule: '*/5 * * * *' }])
  })
})
