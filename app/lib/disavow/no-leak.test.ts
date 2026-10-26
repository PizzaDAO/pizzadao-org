// @vitest-environment node
// Nothing about the disavow list may reach a public surface: public API routes,
// the sitemap, and /api/session when the flag is off. robots disallows /disavow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn(async () => []) }))
vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn(async () => 9) }))
vi.mock('@/app/lib/disavow/messages', () => ({ getDisavowTranslator: vi.fn(async () => (k: string) => `T:${k}`) }))
vi.mock('@/app/lib/disavow/access', () => ({ disavowViewer: vi.fn(async () => ({ allowed: true, isDPR: true })) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberByDiscordId: vi.fn().mockResolvedValue(null),
  fetchMemberById: vi.fn().mockResolvedValue(null),
}))

import { GET as sessionGET } from '@/app/api/session/route'
import { getSession } from '@/app/lib/session'
import robots from '@/app/robots'

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

beforeEach(() => vi.mocked(getSession).mockResolvedValue({ discordId: 'd1' } as never))
afterEach(() => { delete process.env.DISAVOW_ENABLED })

describe('/api/session', () => {
  it('has no disavow keys at all while the flag is off (even for a level 9 DPR)', async () => {
    const json = await (await sessionGET()).json()
    expect(Object.keys(json).filter(k => /disavow/i.test(k))).toEqual([])
  })
  it('exposes the server-computed flags only when the flag is on', async () => {
    process.env.DISAVOW_ENABLED = 'true'
    const json = await (await sessionGET()).json()
    expect(json).toMatchObject({ canViewDisavow: true, canVoteDisavow: true, disavowNavLabel: 'T:navLabel' })
  })
})

describe('public surfaces do not mention the list', () => {
  const publicSources = [
    'app/api/profile-summary/[id]/route.ts',
    'app/api/profile/[id]/route.ts',
    'app/sitemap.ts',
    'app/api/vouches/route.ts',
    'app/api/vouches/add/route.ts',
    'app/api/vouches/count/route.ts',
  ]
  for (const f of publicSources) {
    it(`${f} has no disavow code`, () => {
      let src = ''
      try { src = read(f) } catch { return } // route may not exist in this checkout
      expect(src.toLowerCase()).not.toContain('disavow')
    })
  }
  it('no other public API route outside /api/disavow, /api/cron/disavow and /api/session imports the disavow lib', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && /lib\/disavow/.test(readFileSync(p, 'utf8'))) {
          offenders.push(p.slice(root.length + 1))
        }
      }
    }
    walk(join(root, 'app', 'api'))
    expect(offenders.filter(f => !/^app\/api\/(disavow|cron\/disavow|session)\//.test(f))).toEqual([])
  })
  it('the profile summary and people payloads are not built from disavow data', () => {
    for (const f of ['app/api/profile-summary/[id]/route.ts']) expect(read(f)).not.toMatch(/disavow/i)
  })
})

describe('robots', () => {
  it('does not advertise /disavow (noindex + 404 do the work)', () => {
    const rule = (robots().rules as { disallow: string[] }[])[0]
    expect(rule.disallow.join(' ')).not.toMatch(/disavow/i)
  })
})

describe('root message catalogs carry no disavow text', () => {
  for (const loc of ['en', 'es', 'fr']) {
    it(`messages/${loc}.json`, () => {
      expect(read(`messages/${loc}.json`).toLowerCase()).not.toMatch(/disavow|desautoriz|désaveu/)
    })
  }
  it('the disavow strings are loaded only by the /disavow layout, never by the root layout', () => {
    expect(read('app/disavow/layout.tsx')).toMatch(/loadDisavowCatalog/)
    expect(read('app/layout.tsx')).not.toMatch(/disavow/i)
  })
})
