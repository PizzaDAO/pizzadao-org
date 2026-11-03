// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'
import { buildMemberCommandReply, runMemberCommand, type MemberCommandDeps, type MemberCommandJob } from '../member-commands'
import type { LevelInfo } from '@/app/lib/level-info'
import type { ProfileStats } from '@/app/lib/profile-stats'

const GUILD = '812097286003359764'
const ME = '100000000000000001'
const OTHER = '100000000000000009'

describe('registration', () => {
  it('registers /vouch (required member), /level and /profile (optional member)', () => {
    const by = (n: string) => (PEP_COMMANDS as readonly { name: string; options?: readonly unknown[] }[]).find((c) => c.name === n)
    expect(by('vouch')?.options?.[0]).toMatchObject({ name: 'member', type: 6, required: true })
    expect(by('level')?.options?.[0]).toMatchObject({ name: 'member', type: 6, required: false })
    expect(by('profile')?.options?.[0]).toMatchObject({ name: 'member', type: 6, required: false })
  })
})

function make(over: { enabled?: boolean; readyAt?: Date | null } = {}) {
  const mc = {
    enabled: vi.fn(async () => over.enabled ?? true),
    rateLimit: vi.fn(async () => over.readyAt ?? null),
    defer: vi.fn(),
  }
  return { deps: { guildId: GUILD, memberCommands: mc } as unknown as HandlerDeps, mc }
}
const call = (name: string, member?: string, extra: Record<string, unknown> = {}) => ({
  type: 2,
  guild_id: GUILD,
  application_id: 'app1',
  token: 'tok',
  member: { user: { id: ME, username: 'snax' }, roles: [] },
  data: { name, options: member ? [{ name: 'member', type: 6, value: member }] : [], ...extra },
})

describe('handler gating', () => {
  it.each(['vouch', 'level', 'profile'])('/%s answers "isn\'t enabled yet" (ephemeral) while off, no rate limit, no deferral', async (name) => {
    const { deps, mc } = make({ enabled: false })
    const r = await handleInteraction(call(name, OTHER), deps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled yet/)
    expect(r.data?.flags).toBe(64)
    expect(mc.rateLimit).not.toHaveBeenCalled()
    expect(mc.defer).not.toHaveBeenCalled()
  })

  it('answers "not enabled" when the route wires nothing', async () => {
    const r = await handleInteraction(call('vouch', OTHER), { guildId: GUILD } as unknown as HandlerDeps)
    expect(r.data?.embeds?.[0].description).toMatch(/isn't enabled yet/)
  })

  it('on: defers an EPHEMERAL reply with the job', async () => {
    const { deps, mc } = make()
    const r = await handleInteraction(call('vouch', OTHER), deps)
    expect(r).toMatchObject({ type: 5, data: { flags: 64 } })
    expect(mc.defer).toHaveBeenCalledWith(expect.objectContaining({ name: 'vouch', discordId: ME, targetDiscordId: OTHER, applicationId: 'app1', token: 'tok' }))
  })

  it('/level and /profile work without a member option (yourself)', async () => {
    const { deps, mc } = make()
    expect((await handleInteraction(call('level'), deps)).type).toBe(5)
    expect(mc.defer.mock.calls[0][0]).not.toHaveProperty('targetDiscordId')
    expect((await handleInteraction(call('profile'), deps)).type).toBe(5)
  })

  it('refuses a self-vouch, a vouch without a member, a bot and a bad id before deferring', async () => {
    const { deps, mc } = make()
    expect((await handleInteraction(call('vouch', ME), deps)).data?.embeds?.[0].description).toMatch(/yourself/)
    expect((await handleInteraction(call('vouch'), deps)).data?.embeds?.[0].description).toMatch(/Pick a member/)
    expect((await handleInteraction(call('vouch', 'nope'), deps)).data?.embeds?.[0].description).toMatch(/Pick a member/)
    const bot = call('vouch', OTHER, { resolved: { users: { [OTHER]: { id: OTHER, bot: true } } } })
    expect((await handleInteraction(bot, deps)).data?.embeds?.[0].description).toMatch(/bot/)
    expect(mc.defer).not.toHaveBeenCalled()
  })

  it('rate limited: ephemeral wait, no deferral', async () => {
    const { deps, mc } = make({ readyAt: new Date(Date.now() + 30_000) })
    const r = await handleInteraction(call('level'), deps)
    expect(r.data?.flags).toBe(64)
    expect(mc.defer).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------- replies ---

const INFO: LevelInfo = {
  level: 3, title: 'Line Cook', maxLevel: 8, isMax: false, done: 1, total: 3, nextTitle: 'Sous Chef',
  missions: [
    { id: 1, title: 'Join a crew', state: 'done' },
    { id: 2, title: 'Selfie interview', state: 'pending' },
    { id: 3, title: 'Connect X', state: 'todo' },
  ],
}
const STATS: ProfileStats = { memberId: '42', name: 'Don *Pepperoni*', city: 'Rome', crews: ['Ops', 'Art'], level: 3, levelTitle: 'Line Cook', isMax: false, vouchesReceived: 4, vouchesGiven: 2 }

function mdeps(over: Partial<MemberCommandDeps> = {}): MemberCommandDeps {
  return {
    memberByDiscordId: vi.fn(async (id: string) => (id === ME ? { memberId: '42', name: 'Me' } : id === OTHER ? { memberId: '7', name: 'Friend' } : null)),
    giveVouch: vi.fn(async () => ({ ok: true as const, targetMemberId: '7', targetName: 'Friend' })),
    disavowWarns: vi.fn(async () => false),
    levelInfo: vi.fn(async () => INFO),
    profileStats: vi.fn(async (id: string) => (id === ME || id === OTHER ? STATS : null)),
    appUrl: 'https://app.pizzadao.org',
    ...over,
  }
}
const job = (name: MemberCommandJob['name'], target?: string): MemberCommandJob => ({ name, discordId: ME, targetDiscordId: target, applicationId: 'a', token: 't' })
const text = async (j: MemberCommandJob, d: MemberCommandDeps) => {
  const e = await buildMemberCommandReply(j, d)
  return `${e.description}\n${(e.fields ?? []).map((f) => `${f.name}=${f.value}`).join('\n')}`
}

describe('/vouch reply', () => {
  it('vouches through the shared rule function and confirms privately', async () => {
    const d = mdeps()
    const t = await text(job('vouch', OTHER), d)
    expect(d.giveVouch).toHaveBeenCalledWith(ME, '7')
    expect(t).toContain('You vouched for Friend')
  })
  it('a non-member target gets an invite link, not a vouch', async () => {
    const d = mdeps()
    const t = await text(job('vouch', '100000000000000555'), d)
    expect(t).toContain('/join?ref=42')
    expect(d.giveVouch).not.toHaveBeenCalled()
  })
  it('disavow: eligible voucher is sent to the profile with no hint why', async () => {
    const d = mdeps({ disavowWarns: vi.fn(async () => true) })
    const t = await text(job('vouch', OTHER), d)
    expect(t).toContain('vouch from their profile')
    expect(t).toContain('/profile/7')
    expect(t).not.toMatch(/disavow|listed/i)
    expect(d.giveVouch).not.toHaveBeenCalled()
  })
  it.each([
    ['duplicate', /already vouched/],
    ['no-profile', /Finish onboarding/],
    ['not-found', /aren't a PizzaDAO member/],
  ] as const)('maps %s', async (reason, re) => {
    expect(await text(job('vouch', OTHER), mdeps({ giveVouch: vi.fn(async () => ({ ok: false as const, reason })) }))).toMatch(re)
  })
  it('daily limit', async () => {
    expect(await text(job('vouch', OTHER), mdeps({ giveVouch: vi.fn(async () => ({ ok: false as const, reason: 'limit' as const, limit: 5 })) }))).toMatch(/5 vouches per day/)
  })
})

describe('/level reply', () => {
  it('own: level, title, mission states and next level title', async () => {
    const t = await text(job('level'), mdeps())
    expect(t).toContain('level 3: Line Cook')
    expect(t).toContain('✅ Join a crew')
    expect(t).toContain('⏳ Selfie interview')
    expect(t).toContain('⬜ Connect X')
    expect(t).toContain('1/3 done to reach level 4')
    expect(t).toContain('Sous Chef')
  })
  it("another member's: level and title only, no requirements", async () => {
    const t = await text(job('level', OTHER), mdeps())
    expect(t).toContain(`<@${OTHER}> is level 3: Line Cook`)
    expect(t).not.toContain('Selfie')
  })
  it('MAX and non-members', async () => {
    expect(await text(job('level'), mdeps({ levelInfo: vi.fn(async () => ({ ...INFO, isMax: true, level: 9 })) }))).toContain('MAX level')
    expect(await text(job('level', '100000000000000555'), mdeps())).toMatch(/isn't a PizzaDAO member/)
  })
})

describe('/profile reply', () => {
  it('shows public stats only, escaped, with a profile link', async () => {
    const t = await text(job('profile', OTHER), mdeps())
    expect(t).toContain('Don \\*Pepperoni\\*')
    expect(t).toContain('Vouched for by=4')
    expect(t).toContain('Crews=Ops, Art')
    expect(t).toContain('/profile/42')
    expect(t).not.toMatch(/wallet|balance|email/i)
  })
  it('non-members', async () => {
    expect(await text(job('profile', '100000000000000555'), mdeps())).toMatch(/isn't a PizzaDAO member/)
  })
})

describe('runMemberCommand', () => {
  it('edits the deferred reply; a failure edits in a generic error and never throws', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response)
    await runMemberCommand(job('level'), mdeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/webhooks/a/t/messages/@original')
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual({ parse: [] })

    const f2 = vi.fn(async () => ({ ok: true }) as Response)
    await runMemberCommand(job('level'), mdeps({ levelInfo: vi.fn(async () => { throw new Error('db') }), fetchImpl: f2 as unknown as typeof fetch }))
    expect(JSON.parse(String((f2.mock.calls[0] as unknown as [string, RequestInit])[1].body)).embeds[0].description).toMatch(/Something went wrong/)
  })
})
