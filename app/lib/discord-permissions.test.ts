// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canViewChannel, clearPermissionCaches, PERM_ADMINISTRATOR, PERM_VIEW_CHANNEL, userCanViewChannel, type Overwrite } from './discord-permissions'

const B = (n: number): bigint => BigInt(n)
const G = '100000'
const V = PERM_VIEW_CHANNEL
const base = (over: Partial<Parameters<typeof canViewChannel>[0]> = {}) => ({
  guildId: G,
  ownerId: null,
  userId: '200000',
  memberRoleIds: [] as string[],
  rolePerms: new Map<string, bigint>([[G, V]]),
  overwrites: [] as Overwrite[],
  ...over,
})
const ow = (id: string, type: number, allow = B(0), deny = B(0)): Overwrite => ({ id, type, allow, deny })

describe('canViewChannel', () => {
  it('uses the @everyone base permission', () => {
    expect(canViewChannel(base())).toBe(true)
    expect(canViewChannel(base({ rolePerms: new Map([[G, B(0)]]) }))).toBe(false)
  })
  it('an @everyone deny hides the channel, a role allow brings it back', () => {
    const overwrites = [ow(G, 0, B(0), V), ow('300000', 0, V, B(0))]
    expect(canViewChannel(base({ overwrites }))).toBe(false)
    expect(canViewChannel(base({ overwrites, memberRoleIds: ['300000'], rolePerms: new Map([[G, V], ['300000', B(0)]]) }))).toBe(true)
  })
  it('role overwrites: allow wins among a member\'s roles, a lone deny hides', () => {
    const overwrites = [ow('300000', 0, B(0), V), ow('400000', 0, V, B(0))]
    expect(canViewChannel(base({ overwrites, memberRoleIds: ['300000', '400000'] }))).toBe(true)
    expect(canViewChannel(base({ overwrites: [ow('300000', 0, B(0), V)], memberRoleIds: ['300000'] }))).toBe(false)
  })
  it('a member-specific overwrite beats role overwrites both ways', () => {
    expect(canViewChannel(base({ overwrites: [ow(G, 0, B(0), V), ow('200000', 1, V, B(0))] }))).toBe(true)
    expect(canViewChannel(base({ overwrites: [ow('300000', 0, V, B(0)), ow('200000', 1, B(0), V)], memberRoleIds: ['300000'] }))).toBe(false)
  })
  it('a role base permission grants view when @everyone lacks it', () => {
    expect(canViewChannel(base({ rolePerms: new Map([[G, B(0)], ['300000', V]]), memberRoleIds: ['300000'] }))).toBe(true)
  })
  it('Administrator and the guild owner see everything despite denies', () => {
    const overwrites = [ow(G, 0, B(0), V), ow('200000', 1, B(0), V)]
    expect(canViewChannel(base({ overwrites, memberRoleIds: ['300000'], rolePerms: new Map([[G, B(0)], ['300000', PERM_ADMINISTRATOR]]) }))).toBe(true)
    expect(canViewChannel(base({ overwrites, ownerId: '200000' }))).toBe(true)
  })
  it('category overwrites count when synced onto the channel (the channel carries them)', () => {
    expect(canViewChannel(base({ overwrites: [ow(G, 0, B(0), V), ow('300000', 0, V, B(0))], memberRoleIds: ['300000'] }))).toBe(true)
  })
})

describe('userCanViewChannel', () => {
  beforeEach(() => clearPermissionCaches())
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const roles = [{ id: G, permissions: String(V) }, { id: '300000', permissions: '0' }]
  const route = (member: Response | Error, overwrites: unknown[] = []) =>
    vi.fn(async (url: string) => {
      if (url.endsWith(`/guilds/${G}`)) return res({ owner_id: '999999' })
      if (url.endsWith('/roles')) return res(roles)
      if (url.includes('/channels/')) return res({ permission_overwrites: overwrites })
      if (member instanceof Error) throw member
      return member.clone()
    }) as unknown as typeof fetch
  const o = (f: typeof fetch) => ({ botToken: 't', guildId: G, fetchImpl: f })

  it('says yes / no from roles and overwrites', async () => {
    const hide = [{ id: G, type: 0, allow: '0', deny: String(V) }, { id: '300000', type: 0, allow: String(V), deny: '0' }]
    expect(await userCanViewChannel('200000', '500000', o(route(res({ roles: ['300000'] }), hide)))).toBe('yes')
    clearPermissionCaches()
    expect(await userCanViewChannel('200000', '500000', o(route(res({ roles: [] }), hide)))).toBe('no')
  })
  it('not in the server is no; an API failure is unknown (never a refusal)', async () => {
    expect(await userCanViewChannel('200000', '500000', o(route(res({}, 404))))).toBe('no')
    expect(await userCanViewChannel('200000', '500000', o(route(res({}, 500))))).toBe('unknown')
    expect(await userCanViewChannel('200000', '500000', o(route(new Error('x'))))).toBe('unknown')
  })
  it('caches roles and channel between calls', async () => {
    const f = route(res({ roles: [] }))
    await userCanViewChannel('200000', '500000', o(f))
    await userCanViewChannel('200001', '500000', o(f))
    const urls = (f as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0])
    expect(urls.filter((u) => u.endsWith('/roles')).length).toBe(1)
    expect(urls.filter((u) => u.includes('/channels/')).length).toBe(1)
  })
})
