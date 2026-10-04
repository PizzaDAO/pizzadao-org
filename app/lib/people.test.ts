// @vitest-environment node
// Display names for Discord IDs: sheet → Discord → raw ID, with mocked sources.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./sheets/member-repository', () => ({ getSheetData: vi.fn() }))

import { mapLimit, resolvePeople, resolvePerson, type PeopleSources } from './people'
import { clearGuildMemberProfileCache, fetchGuildMemberProfile } from './discord'
import { labelPeople } from './shop-admin-people'

const SHEET_ID = '100000000000000001'
const DISCORD_ID = '420591211007574016'
const NOBODY = '100000000000000099'

function sources(over: Partial<PeopleSources> = {}): PeopleSources {
  return {
    sheetMember: vi.fn(async ({ discordId, memberId }) => {
      if (memberId === '7') return { memberId: '7', name: 'By Member Id' }
      if (discordId === SHEET_ID) return { memberId: '42', name: 'Sheet Name' }
      return null
    }),
    discordProfile: vi.fn(async (id: string) =>
      id === DISCORD_ID || id === SHEET_ID
        ? { id, nick: 'Held L7 Nick', globalName: 'Global', username: 'heldl7', avatarUrl: 'https://cdn.discordapp.com/avatars/x/y.png?size=64' }
        : null,
    ),
    ...over,
  }
}

describe('resolvePerson', () => {
  it('1. the Crew-sheet name wins, and Discord is not asked', async () => {
    const s = sources()
    expect(await resolvePerson({ discordId: SHEET_ID }, { sources: s })).toEqual({ discordId: SHEET_ID, name: 'Sheet Name', memberId: '42', source: 'sheet' })
    expect(s.discordProfile).not.toHaveBeenCalled()
  })

  it('uses the member ID when present', async () => {
    const s = sources()
    expect((await resolvePerson({ discordId: NOBODY, memberId: '7' }, { sources: s })).name).toBe('By Member Id')
    expect(s.sheetMember).toHaveBeenCalledWith({ discordId: NOBODY, memberId: '7' })
  })

  it('2. not in the sheet (e.g. a held L6/L7 role holder): the Discord nickname, then global name, then username', async () => {
    const s = sources()
    expect(await resolvePerson({ discordId: DISCORD_ID }, { sources: s })).toEqual({
      discordId: DISCORD_ID,
      name: 'Held L7 Nick',
      handle: '@heldl7',
      avatarUrl: 'https://cdn.discordapp.com/avatars/x/y.png?size=64',
      source: 'discord',
    })
    const noNick = sources({ discordProfile: async (id) => ({ id, nick: null, globalName: 'Global', username: 'heldl7', avatarUrl: null }) })
    expect((await resolvePerson({ discordId: DISCORD_ID }, { sources: noNick })).name).toBe('Global')
    const onlyUser = sources({ discordProfile: async (id) => ({ id, nick: null, globalName: null, username: 'heldl7', avatarUrl: null }) })
    expect((await resolvePerson({ discordId: DISCORD_ID }, { sources: onlyUser })).name).toBe('heldl7')
  })

  it('a sheet row with an empty name falls through to Discord but keeps the member ID', async () => {
    const s = sources({ sheetMember: async () => ({ memberId: '55', name: '' }) })
    expect(await resolvePerson({ discordId: DISCORD_ID }, { sources: s })).toMatchObject({ name: 'Held L7 Nick', memberId: '55', source: 'discord' })
  })

  it('3. nobody knows them: the raw ID', async () => {
    expect(await resolvePerson({ discordId: NOBODY }, { sources: sources() })).toEqual({ discordId: NOBODY, name: NOBODY, source: 'id' })
  })

  it('a failing or slow source falls through instead of blocking', async () => {
    const s = sources({
      sheetMember: async () => {
        throw new Error('sheet down')
      },
      discordProfile: () => new Promise(() => {}), // never settles
    })
    const t = Date.now()
    expect(await resolvePerson({ discordId: DISCORD_ID }, { sources: s, timeoutMs: 30 })).toMatchObject({ name: DISCORD_ID, source: 'id' })
    expect(Date.now() - t).toBeLessThan(1000)
  })
})

describe('resolvePeople', () => {
  it('dedupes, keeps a member ID seen later, and labels everyone', async () => {
    const s = sources()
    const out = await resolvePeople([DISCORD_ID, { discordId: NOBODY }, { discordId: NOBODY, memberId: '7' }, SHEET_ID, DISCORD_ID], { sources: s })
    expect([...out.keys()].sort()).toEqual([SHEET_ID, DISCORD_ID, NOBODY].sort())
    expect(out.get(NOBODY)?.name).toBe('By Member Id')
    expect(s.discordProfile).toHaveBeenCalledTimes(1)
  })

  it('bounds concurrency', async () => {
    let inFlight = 0
    let peak = 0
    const s = sources({
      sheetMember: async () => null,
      discordProfile: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return null
      },
    })
    const ids = Array.from({ length: 20 }, (_, i) => `1000000000000001${String(i).padStart(2, '0')}`)
    await resolvePeople(ids, { sources: s, concurrency: 3 })
    expect(peak).toBe(3)
  })

  it('past the time budget, the rest skip Discord', async () => {
    const s = sources({ sheetMember: async () => null })
    const out = await resolvePeople([DISCORD_ID], { sources: s, budgetMs: -1 })
    expect(out.get(DISCORD_ID)?.source).toBe('id')
    expect(s.discordProfile).not.toHaveBeenCalled()
  })

  it('mapLimit keeps the input order', async () => {
    expect(await mapLimit([3, 1, 2], 2, async (n) => n * 10)).toEqual([30, 10, 20])
  })
})

describe('fetchGuildMemberProfile (mocked fetch, never Discord)', () => {
  beforeEach(() => {
    clearGuildMemberProfileCache()
    vi.stubEnv('DISCORD_GUILD_ID', '700000000000000000')
    vi.stubEnv('DISCORD_BOT_TOKEN', 'test-token')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('reads nick / global_name / username / avatar and caches for an hour', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ nick: 'Nick', user: { id: DISCORD_ID, username: 'user', global_name: 'Global', avatar: 'abc' } }), { status: 200 }),
    ) as unknown as typeof fetch
    const p = await fetchGuildMemberProfile(DISCORD_ID, { fetchImpl, now: 0 })
    expect(p).toEqual({ id: DISCORD_ID, nick: 'Nick', globalName: 'Global', username: 'user', avatarUrl: `https://cdn.discordapp.com/avatars/${DISCORD_ID}/abc.png?size=64` })
    await fetchGuildMemberProfile(DISCORD_ID, { fetchImpl, now: 59 * 60 * 1000 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await fetchGuildMemberProfile(DISCORD_ID, { fetchImpl, now: 61 * 60 * 1000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('404 is "not in the guild" (cached); a 5xx is not cached', async () => {
    const notFound = vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch
    expect(await fetchGuildMemberProfile(NOBODY, { fetchImpl: notFound, now: 0 })).toBeNull()
    await fetchGuildMemberProfile(NOBODY, { fetchImpl: notFound, now: 1000 })
    expect(notFound).toHaveBeenCalledTimes(1)
    const broken = vi.fn(async () => new Response('{}', { status: 502 })) as unknown as typeof fetch
    expect(await fetchGuildMemberProfile(DISCORD_ID, { fetchImpl: broken, now: 0 })).toBeNull()
    await fetchGuildMemberProfile(DISCORD_ID, { fetchImpl: broken, now: 1 })
    expect(broken).toHaveBeenCalledTimes(2)
  })
})

describe('labelPeople (shop audit log)', () => {
  it('labels sheet and Discord-only people; unknown IDs are left out (shown bare)', async () => {
    const out = await labelPeople([SHEET_ID, DISCORD_ID, NOBODY, ''], { sources: sources() })
    expect(out).toEqual({
      [SHEET_ID]: { name: 'Sheet Name', memberId: '42' },
      [DISCORD_ID]: { name: 'Held L7 Nick', handle: '@heldl7' },
    })
  })
})
