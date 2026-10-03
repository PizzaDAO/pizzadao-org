// @vitest-environment node
// Each verifier against mocked data sources: no DB, no Discord, no Google.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { VERIFIERS, attendanceCount, discordMessage, discordRole, referral, walletConnected, xLinked, manual } from './verifiers'
import type { VerifierSources, VerifyCtx } from './types'

const ME = '300000000000000001'
const GUILD = '812097286003359764'
const SHOW_AND_TELL = '900000000000000001'
const MAFIA = '823266914834841610'

function sources(over: Partial<VerifierSources> = {}): VerifierSources {
  return {
    getXAccount: vi.fn(async () => null),
    countCallsAttended: vi.fn(async () => ({ total: 0, calls: 0, byCrew: {} })),
    getMemberRoles: vi.fn(async () => []),
    resolveRoleIds: vi.fn(async () => []),
    guildId: () => GUILD,
    resolveChannelId: vi.fn(async () => SHOW_AND_TELL),
    getChannelMessage: vi.fn(async () => null),
    getChannel: vi.fn(async () => null),
    countWallets: vi.fn(async () => 0),
    ...over,
  }
}

function ctx(src: VerifierSources, over: Partial<VerifyCtx> = {}): VerifyCtx {
  return { discordId: ME, memberId: 'm-1', trigger: 'on_demand', now: new Date(), sources: src, memo: new Map(), ...over }
}

afterEach(() => {
  delete process.env.MISSION_CREW_LEADER_ROLE
})

describe('registry', () => {
  it('has the Phase 1 verifiers, and only "manual" is never run', () => {
    expect(Object.keys(VERIFIERS).sort()).toEqual(
      ['attendance_count', 'discord_message', 'discord_role', 'manual', 'referral', 'wallet_connected', 'x_linked'].sort(),
    )
    expect(Object.values(VERIFIERS).filter((v) => v.mode === 'manual').map((v) => v.key)).toEqual(['manual'])
    expect(VERIFIERS.discord_role.stateful).toBe(true)
  })
})

describe('x_linked (L1.0)', () => {
  it('passes with an OAuth-linked X account, fails with a hint otherwise', async () => {
    const src = sources({ getXAccount: vi.fn(async () => ({ xUsername: 'pizzalover' })) })
    expect(await xLinked.check(ctx(src), xLinked.parse({}))).toEqual({ status: 'pass', evidence: { xUsername: 'pizzalover' } })
    const r = await xLinked.check(ctx(sources()), {})
    expect(r).toMatchObject({ status: 'fail', hint: expect.stringMatching(/Connect X/) })
  })
})

describe('attendance_count (L2.0 min 1, L5.0 min 3)', () => {
  const att = (total: number) => sources({ countCallsAttended: vi.fn(async () => ({ total, calls: total, byCrew: { community_call: total } })) })

  it('counts any calls, community calls included', async () => {
    const p1 = attendanceCount.parse({ min: 1, crews: 'any' })
    expect((await attendanceCount.check(ctx(att(1)), p1)).status).toBe('pass')
    expect(await attendanceCount.check(ctx(att(0)), p1)).toMatchObject({ status: 'fail', progress: { have: 0, need: 1 } })

    const p3 = attendanceCount.parse({ min: 3, crews: 'any', distinct: 'call' })
    expect(await attendanceCount.check(ctx(att(2)), p3)).toMatchObject({
      status: 'fail',
      progress: { have: 2, need: 3 },
      hint: expect.stringMatching(/1 more call/),
    })
    expect(await attendanceCount.check(ctx(att(3)), p3)).toMatchObject({ status: 'pass', evidence: { calls: 3, need: 3 } })
  })

  it('rejects params it does not support', () => {
    expect(() => attendanceCount.parse({ min: 0 })).toThrow(/positive/)
    expect(() => attendanceCount.parse({ min: 3, crews: 'distinct' })).toThrow(/crews/)
    expect(attendanceCount.parse(null)).toEqual({ min: 1 })
  })
})

describe('discord_message (L3.0 #show-and-tell)', () => {
  const link = (channel = SHOW_AND_TELL, guild = GUILD) => `https://discord.com/channels/${guild}/${channel}/900000000000000099`
  const params = discordMessage.parse({ channelName: 'show-and-tell' })

  it("passes when the linked message is the member's own post in the channel", async () => {
    const getChannelMessage = vi.fn(async () => ({ channelId: SHOW_AND_TELL, authorId: ME }))
    const src = sources({ getChannelMessage })
    const r = await discordMessage.check(ctx(src, { evidence: link() }), params)
    expect(r).toEqual({ status: 'pass', evidence: { channelId: SHOW_AND_TELL, messageId: '900000000000000099' } })
    expect(getChannelMessage).toHaveBeenCalledWith(SHOW_AND_TELL, '900000000000000099')
    expect(src.resolveChannelId).toHaveBeenCalledWith('show-and-tell', 'SHOW_AND_TELL_CHANNEL_ID')
  })

  it('accepts a thread / forum post inside the channel', async () => {
    const THREAD = '900000000000000050'
    const src = sources({
      getChannelMessage: vi.fn(async () => ({ channelId: THREAD, authorId: ME })),
      getChannel: vi.fn(async () => ({ id: THREAD, parentId: SHOW_AND_TELL })),
    })
    expect((await discordMessage.check(ctx(src, { evidence: link(THREAD) }), params)).status).toBe('pass')
  })

  it("fails: no link, another server, someone else's message, wrong channel, missing message", async () => {
    expect(await discordMessage.check(ctx(sources()), params)).toMatchObject({ status: 'fail', hint: expect.stringMatching(/Copy Message Link/) })
    expect(await discordMessage.check(ctx(sources(), { evidence: 'https://x.com/a' }), params)).toMatchObject({ status: 'fail' })
    expect(await discordMessage.check(ctx(sources(), { evidence: link(SHOW_AND_TELL, '111111111111111111') }), params)).toMatchObject({
      status: 'fail',
      reason: expect.stringMatching(/not from the PizzaDAO server/),
    })
    const other = sources({ getChannelMessage: vi.fn(async () => ({ channelId: SHOW_AND_TELL, authorId: '300000000000000002' })) })
    expect(await discordMessage.check(ctx(other, { evidence: link() }), params)).toMatchObject({ reason: expect.stringMatching(/someone else/) })
    const elsewhere = sources({
      getChannelMessage: vi.fn(async () => ({ channelId: '900000000000000077', authorId: ME })),
      getChannel: vi.fn(async () => ({ id: '900000000000000077', parentId: null })),
    })
    expect(await discordMessage.check(ctx(elsewhere, { evidence: link('900000000000000077') }), params)).toMatchObject({
      reason: expect.stringMatching(/isn't in #show-and-tell/),
    })
    expect(await discordMessage.check(ctx(sources(), { evidence: link() }), params)).toMatchObject({ reason: expect.stringMatching(/doesn't exist/) })
  })

  it('is "unknown" (no write) when Discord or the channel lookup is unavailable', async () => {
    const down = sources({ getChannelMessage: vi.fn(async () => 'unknown' as const) })
    expect((await discordMessage.check(ctx(down, { evidence: link() }), params)).status).toBe('unknown')
    const noChannel = sources({ resolveChannelId: vi.fn(async () => null) })
    expect((await discordMessage.check(ctx(noChannel, { evidence: link() }), params)).status).toBe('unknown')
  })

  it('uses a pinned channelId when configured', async () => {
    const src = sources({ getChannelMessage: vi.fn(async () => ({ channelId: '900000000000000123', authorId: ME })) })
    const p = discordMessage.parse({ channelId: '900000000000000123' })
    expect((await discordMessage.check(ctx(src, { evidence: link('900000000000000123') }), p)).status).toBe('pass')
    expect(src.resolveChannelId).not.toHaveBeenCalled()
    expect(() => discordMessage.parse({ channelId: 'nope' })).toThrow(/snowflake/)
  })
})

describe('discord_role (L6.0 Pepperoni Mafia, L7.0 Crew Leader)', () => {
  it('passes on a held role id; prefers the interaction payload roles', async () => {
    const p = discordRole.parse({ roleIds: [MAFIA] })
    const src = sources({ getMemberRoles: vi.fn(async () => [MAFIA]) })
    expect(await discordRole.check(ctx(src), p)).toEqual({ status: 'pass', evidence: { roleIds: [MAFIA] } })
    const viaInteraction = sources()
    expect((await discordRole.check(ctx(viaInteraction, { interactionRoles: [MAFIA] }), p)).status).toBe('pass')
    expect(viaInteraction.getMemberRoles).not.toHaveBeenCalled()
    expect((await discordRole.check(ctx(sources()), p)).status).toBe('fail')
  })

  it('is "unknown" when the roles cannot be read', async () => {
    const src = sources({ getMemberRoles: vi.fn(async () => null) })
    expect((await discordRole.check(ctx(src), discordRole.parse({ roleIds: [MAFIA] }))).status).toBe('unknown')
  })

  it('resolves "Crew Leader" by name, and MISSION_CREW_LEADER_ROLE overrides it (id or name)', async () => {
    const LEADER = '700000000000000001'
    const p = discordRole.parse({ roleNames: ['Crew Leader'], roleEnv: 'MISSION_CREW_LEADER_ROLE' })
    const resolveRoleIds = vi.fn(async (names: string[]) => (names[0] === 'Crew Leader' ? [LEADER] : ['700000000000000002']))
    const src = sources({ resolveRoleIds, getMemberRoles: vi.fn(async () => [LEADER]) })
    expect(await discordRole.check(ctx(src), p)).toEqual({ status: 'pass', evidence: { roleIds: [LEADER] } })
    expect(resolveRoleIds).toHaveBeenCalledWith(['Crew Leader'])

    process.env.MISSION_CREW_LEADER_ROLE = '700000000000000009'
    expect((await discordRole.check(ctx(sources({ getMemberRoles: vi.fn(async () => ['700000000000000009']) })), p)).status).toBe('pass')

    process.env.MISSION_CREW_LEADER_ROLE = 'Capo'
    const byName = sources({ resolveRoleIds, getMemberRoles: vi.fn(async () => ['700000000000000002']) })
    expect((await discordRole.check(ctx(byName), p)).status).toBe('pass')
    expect(resolveRoleIds).toHaveBeenLastCalledWith(['Capo'])
  })

  it('is "unknown" when no role has that name (misconfiguration never approves)', async () => {
    const p = discordRole.parse({ roleNames: ['Crew Leader'] })
    expect((await discordRole.check(ctx(sources({ resolveRoleIds: vi.fn(async () => []) })), p)).status).toBe('unknown')
    expect((await discordRole.check(ctx(sources({ resolveRoleIds: vi.fn(async () => null) })), p)).status).toBe('unknown')
  })

  it('validates params', () => {
    expect(() => discordRole.parse({})).toThrow(/roleIds or roleNames/)
    expect(() => discordRole.parse({ roleIds: ['abc'] })).toThrow(/snowflakes/)
  })
})

describe('referral (L3.1, Phase 4 stub) / wallet_connected / manual', () => {
  it('referral never passes yet and points to manual review', async () => {
    expect(await referral.check(ctx(sources()), referral.parse({ min: 1, qualify: 'onboarded' }))).toMatchObject({
      status: 'fail',
      hint: expect.stringMatching(/Submit this mission for review/),
    })
  })

  it('wallet_connected counts wallets by member or discord id', async () => {
    const src = sources({ countWallets: vi.fn(async () => 2) })
    expect(await walletConnected.check(ctx(src), walletConnected.parse({}))).toEqual({ status: 'pass', evidence: { wallets: 2 } })
    expect(src.countWallets).toHaveBeenCalledWith(ME, 'm-1')
  })

  it('manual is never automatic', () => {
    expect(manual.mode).toBe('manual')
  })
})
