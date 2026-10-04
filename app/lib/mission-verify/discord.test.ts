// @vitest-environment node
// /missions (deferred reply + webhook edit), the Discord embed, and the DM /
// #work announcements: all with injected fetch / deps, never Discord itself.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleInteraction, type HandlerDeps } from '../discord-interactions/handle'
import { PEP_COMMANDS, ResponseType, EPHEMERAL } from '../discord-interactions/commands'
import { runMissionsCommand, editOriginalUrl } from './discord-command'
import { buildMissionsView, renderMissionsEmbed } from './view'
import { announceMissionResults, type NotifyDeps } from './notify'
import type { RunReport } from './engine'

const GUILD = '812097286003359764'
const USER = '300000000000000001'
const APP = '900000000000000555'

const report = (over: Partial<RunReport> = {}): RunReport => ({
  discordId: USER,
  enabled: true,
  dryRun: false,
  trigger: 'discord',
  checks: [],
  approved: [],
  held: [],
  reopened: [],
  flagged: [],
  unflagged: [],
  wouldFlag: [],
  wouldUnflag: [],
  levelsPaid: [],
  errors: [],
  ...over,
})

const overview = {
  currentLevel: 2,
  levelTitle: 'Pizza Noob',
  levels: [
    { level: 1, reward: 69, missions: [{ id: 1, title: 'Link X', progress: { status: 'APPROVED' } }] },
    {
      level: 2,
      reward: 420,
      missions: [
        { id: 2, title: 'Say hi on a call', progress: null },
        { id: 3, title: 'Post about PizzaDAO', progress: { status: 'PENDING' } },
      ],
    },
    { level: 6, reward: 6942, missions: [{ id: 6, title: 'Join Pepperoni Mafia', progress: { status: 'PENDING', holdReason: 'HIGH_LEVEL' } }] },
  ],
}

describe('/missions command', () => {
  const base = {
    type: 2,
    application_id: APP,
    token: 'tok-123',
    guild_id: GUILD,
    data: { name: 'missions' },
    member: { user: { id: USER, username: 'pie' }, roles: ['823266914834841610'] },
  }
  const deps = (missions?: HandlerDeps['missions']) => ({ guildId: GUILD, missions }) as unknown as HandlerDeps

  it('is registered', () => {
    expect(PEP_COMMANDS.find((c) => c.name === 'missions')).toMatchObject({ dm_permission: false })
  })

  it('answers with a deferred ephemeral reply (type 5) and schedules the check with member.roles', async () => {
    const defer = vi.fn()
    const r = await handleInteraction(base, deps({ rateLimit: vi.fn(async () => null), defer }))
    expect(r).toEqual({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } })
    expect(defer).toHaveBeenCalledWith(
      expect.objectContaining({ discordId: USER, roles: ['823266914834841610'], applicationId: APP, token: 'tok-123', author: expect.any(Object) }),
    )
  })

  it('is rate limited (amber, ephemeral) without scheduling anything', async () => {
    const defer = vi.fn()
    const r = await handleInteraction(base, deps({ rateLimit: vi.fn(async () => new Date(1_800_000_000_000)), defer }))
    expect(r.type).toBe(ResponseType.CHANNEL_MESSAGE)
    expect(r.data?.flags).toBe(EPHEMERAL)
    expect(r.data?.embeds?.[0].description).toMatch(/Slow down/)
    expect(defer).not.toHaveBeenCalled()
  })

  it('without a token or missions deps it refuses instead of deferring', async () => {
    const r1 = await handleInteraction({ ...base, token: undefined }, deps({ rateLimit: vi.fn(async () => null), defer: vi.fn() }))
    expect(r1.data?.embeds?.[0].description).toMatch(/Could not start/)
    const r2 = await handleInteraction(base, deps(undefined))
    expect(r2.data?.embeds?.[0].description).toMatch(/not available/)
  })

  it('the follow-up edits @original via the interaction webhook with the embed, no pings', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const run = vi.fn(async () =>
      report({
        approved: [2],
        levelsPaid: [2],
        checks: [
          { missionId: 2, level: 2, index: 0, title: 'Say hi on a call', verifierKey: 'attendance_count', result: { status: 'pass', evidence: {} }, outcome: 'approved' },
        ],
      }),
    )
    const announce = vi.fn(async () => undefined)
    const view = await runMissionsCommand(
      { discordId: USER, roles: ['r'], applicationId: APP, token: 'tok-123' },
      { run, overview: async () => overview, announce, fetchImpl: fetchImpl as unknown as typeof fetch, currency: '$PEP' },
    )
    expect(run).toHaveBeenCalledWith(USER, ['r'])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(editOriginalUrl(APP, 'tok-123'))
    expect(url).toBe(`https://discord.com/api/v10/webhooks/${APP}/tok-123/messages/@original`)
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(String(init.body))
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.embeds[0].description).toMatch(/Level 2 complete!/)
    expect(announce).toHaveBeenCalledWith(view, USER)
  })

  it('asks non-members to onboard, and edits in an error if the run throws', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const run = vi.fn()
    await runMissionsCommand(
      { discordId: USER, roles: [], applicationId: APP, token: 't' },
      { isMember: async () => false, run, overview: async () => overview, announce: vi.fn(), fetchImpl: fetchImpl as unknown as typeof fetch, appUrl: 'https://app.pizzadao.org' },
    )
    expect(run).not.toHaveBeenCalled()
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).embeds[0].description).toMatch(/Finish onboarding/)

    const failing = vi.fn(async () => new Response('{}', { status: 200 }))
    const out = await runMissionsCommand(
      { discordId: USER, roles: [], applicationId: APP, token: 't' },
      { run: async () => { throw new Error('db down') }, overview: async () => overview, announce: vi.fn(), fetchImpl: failing as unknown as typeof fetch },
    )
    expect(out).toBeNull()
    expect(JSON.parse(String((failing.mock.calls[0] as unknown as [string, RequestInit])[1].body)).embeds[0].description).toMatch(/Something went wrong/)
  })
})

describe('renderMissionsEmbed', () => {
  it('shows level, earned PEP, per-mission state and hints; finished levels are skipped', () => {
    const view = buildMissionsView(
      overview,
      report({
        checks: [
          {
            missionId: 2,
            level: 2,
            index: 0,
            title: 'Say hi on a call',
            verifierKey: 'attendance_count',
            result: { status: 'fail', reason: '0/1', hint: 'Join a community call', progress: { have: 0, need: 1 } },
            outcome: 'not_yet',
          },
        ],
      }),
    )
    const e = renderMissionsEmbed(view, { currency: '$PEP', appUrl: 'https://app.pizzadao.org' })
    expect(e.description).toMatch(/^⏳ No new completions yet\./)
    expect(e.description).toContain('Level **2** · Pizza Noob')
    expect(e.description).toContain('Earned from missions: $PEP 69')
    expect(e.description).toContain('▫️ Say hi on a call: 0/1 Join a community call')
    expect(e.description).toContain('⏳ Post about PizzaDAO (pending review)')
    expect(e.description).toContain("🔐 Join Pepperoni Mafia (verified, awaiting a reviewer's release: Level 6+ needs a human approval)")
    expect(e.description).not.toContain('Link X') // level 1 is done
  })

  it('says so when automatic checks are off', () => {
    const e = renderMissionsEmbed(buildMissionsView(overview, report({ enabled: false, dryRun: true })))
    expect(e.description).toMatch(/not switched on yet/)
  })
})

describe('announceMissionResults', () => {
  let deps: NotifyDeps
  beforeEach(() => {
    deps = {
      enabled: () => true,
      levelInfo: vi.fn(async (levels: number[]) => levels.map((level) => ({ level, title: level === 2 ? 'Pizza Noob' : null, reward: level === 2 ? 420 : 1337 }))),
      sendDM: vi.fn(async () => ({ success: true })),
      resolveAnnounceChannel: vi.fn(async () => '900000000000000777'),
      postToChannel: vi.fn(async () => undefined),
      currency: () => '$PEP',
      appUrl: () => 'https://app.pizzadao.org',
    }
  })

  it('level-up: DMs the member and posts once in #work, mentioning only the member (never @everyone)', async () => {
    const sent = await announceMissionResults({ discordId: USER, trigger: 'on_demand', approvedTitles: ['Say hi'], levelsPaid: [2, 3] }, deps)
    expect(sent).toEqual({ dm: true, posted: true })
    const [, , dmEmbeds] = (deps.sendDM as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(dmEmbeds[0].description).toMatch(/Level 3 complete! \+\$PEP \*\*1,757\*\*/)
    expect(deps.postToChannel).toHaveBeenCalledTimes(1)
    const [channel, body] = (deps.postToChannel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(channel).toBe('900000000000000777')
    expect(body.content).toBe(`<@${USER}>`)
    expect(body.allowed_mentions).toEqual({ parse: [], users: [USER] })
    expect(JSON.stringify(body)).not.toMatch(/@everyone|@here/)
    expect(body.embeds[0].description).toContain('Level 2 (Pizza Noob): +$PEP 420')
  })

  it('approval only: DM for background triggers, nothing when the member is watching', async () => {
    await announceMissionResults({ discordId: USER, trigger: 'event', approvedTitles: ['Link X'], levelsPaid: [] }, deps)
    expect(deps.sendDM).toHaveBeenCalledTimes(1)
    expect(deps.postToChannel).not.toHaveBeenCalled()
    await announceMissionResults({ discordId: USER, trigger: 'discord', approvedTitles: ['Link X'], levelsPaid: [] }, deps)
    expect(deps.sendDM).toHaveBeenCalledTimes(1)
  })

  it('sends nothing while MISSION_VERIFIERS_ENABLED is off, and never throws', async () => {
    deps.enabled = () => false
    expect(await announceMissionResults({ discordId: USER, trigger: 'event', approvedTitles: ['x'], levelsPaid: [1] }, deps)).toEqual({ dm: false, posted: false })
    deps.enabled = () => true
    deps.sendDM = vi.fn(async () => { throw new Error('boom') })
    await expect(announceMissionResults({ discordId: USER, trigger: 'event', approvedTitles: [], levelsPaid: [1] }, deps)).resolves.toBeDefined()
  })

  it('skips the #work post when no channel resolves', async () => {
    deps.resolveAnnounceChannel = vi.fn(async () => null)
    const sent = await announceMissionResults({ discordId: USER, trigger: 'review', approvedTitles: [], levelsPaid: [2] }, deps)
    expect(sent).toEqual({ dm: true, posted: false })
  })
})
