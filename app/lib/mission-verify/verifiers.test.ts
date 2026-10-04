// @vitest-environment node
// Each verifier against mocked data sources: no DB, no Discord, no Google.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { VERIFIERS, attendanceCount, discordMessage, discordRole, referral, vouchGiven, walletConnected, xLinked, manual } from './verifiers'
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
    getReferrals: vi.fn(async () => []),
    getVouchesGiven: vi.fn(async () => []),
    sharedSignalKinds: vi.fn(async () => []),
    getFarcasterAccounts: vi.fn(async () => []),
    getTelegramUsername: vi.fn(async () => null),
    fetch: vi.fn(async () => { throw new Error("no network in tests") }) as unknown as typeof fetch,
    neynarApiKey: () => null,
    rsvPizzaApiUrl: () => "https://api.rsv.example",
    rsvPizzaServiceKey: () => null,
    getWalletAddresses: vi.fn(async () => []),
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
  it('has the Phase 1 + Phase 4 verifiers; only "manual" is never run, the semi ones never approve', () => {
    expect(Object.keys(VERIFIERS).sort()).toEqual(
      [
        'attendance_count', 'discord_message', 'discord_role', 'manual', 'referral', 'vouch_given', 'wallet_connected', 'x_linked',
        'social_post', 'poap_drop', 'media_proof', 'gpp_host',
      ].sort(),
    )
    expect(Object.values(VERIFIERS).filter((v) => v.mode === 'manual').map((v) => v.key)).toEqual(['manual'])
    expect(Object.values(VERIFIERS).filter((v) => v.mode === 'semi').map((v) => v.key).sort()).toEqual(['gpp_host', 'media_proof', 'poap_drop', 'social_post'])
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

describe('referral (L3.1, D4) / wallet_connected / manual', () => {
  const FRIEND = '300000000000000002'
  const FRIEND2 = '300000000000000003'
  const row = (inviteeDiscordId: string, over: Record<string, unknown> = {}) => ({
    inviteeDiscordId,
    inviteeMemberId: null,
    via: 'invite_link',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    qualifiedAt: new Date('2026-10-01T00:00:00Z'),
    flags: [] as string[],
    ...over,
  })
  const params = referral.parse({ min: 1, qualify: 'onboarded' })

  it('no referral yet: fails with the personal invite link and the manual path', async () => {
    const r = await referral.check(ctx(sources()), params)
    expect(r).toMatchObject({ status: 'fail', progress: { have: 0, need: 1 } })
    expect((r as { hint: string }).hint).toContain('/join?ref=m-1')
    expect((r as { hint: string }).hint).toMatch(/Submit this mission for review/)
  })

  it('passes once an invited friend finished onboarding (qualifiedAt)', async () => {
    const src = sources({ getReferrals: vi.fn(async () => [row(FRIEND)]) })
    expect(await referral.check(ctx(src), params)).toEqual({ status: 'pass', evidence: { referrals: 1, invitees: [FRIEND] } })
    expect(src.getReferrals).toHaveBeenCalledWith(ME)
    expect(src.sharedSignalKinds).toHaveBeenCalledWith(ME, FRIEND)
  })

  it('never counts a self-referral or an unqualified one', async () => {
    const src = sources({ getReferrals: vi.fn(async () => [row(ME), row(FRIEND, { qualifiedAt: null })]) })
    expect(await referral.check(ctx(src), params)).toMatchObject({ status: 'fail', progress: { have: 0, need: 1 } })
  })

  it('a referral sharing an account with the inviter (stored flag or AccountSignal) is not counted: manual review', async () => {
    const flagged = sources({ getReferrals: vi.fn(async () => [row(FRIEND, { flags: ['shared_wallet'] })]) })
    expect(await referral.check(ctx(flagged), params)).toMatchObject({
      status: 'fail',
      reason: expect.stringMatching(/shares a wallet, X or Telegram/),
      hint: expect.stringMatching(/Submit this mission for review/),
    })
    const signal = sources({
      getReferrals: vi.fn(async () => [row(FRIEND), row(FRIEND2)]),
      sharedSignalKinds: vi.fn(async (_a: string, b: string) => (b === FRIEND ? ['shared_x'] : [])),
    })
    expect(await referral.check(ctx(signal), referral.parse({ min: 1 }))).toEqual({
      status: 'pass',
      evidence: { referrals: 1, invitees: [FRIEND2], flagged: 1 },
    })
  })

  it('rejects unknown qualify modes', () => {
    expect(() => referral.parse({ qualify: 'joined_discord' })).toThrow()
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

describe('vouch_given (L5.2)', () => {
  const vouch = (followeeId: string, source = 'PIZZADAO') => ({ followeeId, source, createdAt: new Date('2026-10-01T00:00:00Z') })
  const params = vouchGiven.parse({ min: 1, sources: ['PIZZADAO'] })

  it('parses: min defaults to 1, sources default to PIZZADAO only, unknown sources rejected', () => {
    expect(vouchGiven.parse({})).toEqual({ min: 1, sources: ['PIZZADAO'] })
    expect(vouchGiven.parse({ min: 2, sources: ['pizzadao', 'FARCASTER'] })).toEqual({ min: 2, sources: ['PIZZADAO', 'FARCASTER'] })
    expect(() => vouchGiven.parse({ sources: ['LINKEDIN'] })).toThrow()
    expect(() => vouchGiven.parse({ min: 0 })).toThrow()
    expect(() => vouchGiven.parse({ sources: [] })).toThrow()
    expect(vouchGiven.mode).toBe('auto')
  })

  it('no vouches: fails with progress 0/1 and a hint pointing at profiles and /vouches', async () => {
    const r = await vouchGiven.check(ctx(sources()), params)
    expect(r).toMatchObject({ status: 'fail', reason: '0/1 members vouched for', progress: { have: 0, need: 1 } })
    expect((r as { hint: string }).hint).toMatch(/Vouch for another member.*\/vouches/)
  })

  it('passes with one PizzaDAO vouch for another member (looked up by member ID, not Discord ID)', async () => {
    const src = sources({ getVouchesGiven: vi.fn(async () => [vouch('m-2')]) })
    expect(await vouchGiven.check(ctx(src), params)).toEqual({ status: 'pass', evidence: { vouches: 1, need: 1, members: ['m-2'] } })
    expect(src.getVouchesGiven).toHaveBeenCalledWith('m-1')
  })

  it('a self-vouch never counts', async () => {
    const src = sources({ getVouchesGiven: vi.fn(async () => [vouch('m-1')]) })
    expect(await vouchGiven.check(ctx(src), params)).toMatchObject({ status: 'fail', progress: { have: 0, need: 1 } })
  })

  it('sources filter: imported Farcaster / X follows do not count by default, but can be enabled', async () => {
    const src = sources({ getVouchesGiven: vi.fn(async () => [vouch('m-2', 'FARCASTER'), vouch('m-3', 'TWITTER')]) })
    expect(await vouchGiven.check(ctx(src), params)).toMatchObject({ status: 'fail', progress: { have: 0, need: 1 } })
    expect(await vouchGiven.check(ctx(src), vouchGiven.parse({ min: 1, sources: ['PIZZADAO', 'FARCASTER'] }))).toMatchObject({
      status: 'pass',
      evidence: { vouches: 1, members: ['m-2'] },
    })
  })

  it('min: needs that many distinct other members', async () => {
    const two = vouchGiven.parse({ min: 2, sources: ['PIZZADAO'] })
    const one = sources({ getVouchesGiven: vi.fn(async () => [vouch('m-2'), vouch('m-1'), vouch('m-4', 'FARCASTER')]) })
    const r = await vouchGiven.check(ctx(one), two)
    expect(r).toMatchObject({ status: 'fail', reason: '1/2 members vouched for', progress: { have: 1, need: 2 } })
    expect((r as { hint: string }).hint).toMatch(/^Vouch for another member/)
    const none = await vouchGiven.check(ctx(sources()), two)
    expect((none as { hint: string }).hint).toMatch(/^Vouch for 2 more members/)
    const both = sources({ getVouchesGiven: vi.fn(async () => [vouch('m-2'), vouch('m-3')]) })
    expect(await vouchGiven.check(ctx(both), two)).toMatchObject({ status: 'pass', evidence: { vouches: 2 } })
  })

  it('no member ID (not onboarded): fails without querying', async () => {
    const src = sources()
    expect(await vouchGiven.check(ctx(src, { memberId: null }), params)).toMatchObject({ status: 'fail', progress: { have: 0, need: 1 } })
    expect(src.getVouchesGiven).not.toHaveBeenCalled()
  })
})
