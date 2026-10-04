// @vitest-environment node
// Data-migration plan, payout policy, Discord channel helpers, keyed rate limits.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MISSION_LEVEL_TITLES,
  MISSION_VERIFIER_CONFIG,
  parseLevelTitlesArg,
  planVerifierMigration,
  type MissionDbRow,
  type VerifierMigrationPlan,
} from './mission-config'
import { VERIFIERS } from './verifiers'
import { isNewAccount, missionVerifiersEnabled, releaseHoldFor, snowflakeAt, snowflakeCreatedAt } from './policy'
import { clearGuildChannelsCache, getChannelMessage, normalizeChannelName, parseMessageLink, resolveChannelId } from '../discord-channels'
import { __resetMemoryRateLimits, checkKeyedRateLimit } from '../rate-limit'

/** The seeded rows: every config entry except the ones the migration inserts. */
const seedRows = (): MissionDbRow[] =>
  MISSION_VERIFIER_CONFIG.filter((c) => !c.insert).map((c, i) => ({
    id: i + 1,
    level: c.level,
    index: c.index,
    title: c.seedTitle,
    description: 'seed',
    verifierKey: null,
    verifierParams: null,
    proofKind: 'NONE',
  }))

const REWARDS: Record<number, number> = { 1: 69, 2: 420, 3: 1337, 4: 3141, 5: 4269, 6: 6942, 7: 31415, 8: 69420 }
const PROD_LEVEL_TITLES: Record<number, string | null> = {
  1: 'Pizza Trainee', 2: 'Pizza Noob', 3: null, 4: null, 5: null, 6: 'Street Muscle', 7: 'Made Mafia', 8: 'Don of Dons',
}

/** Production today: Phases 0-5 applied, no L5.2, L3-L5 without a levelTitle. */
const prodRows = (): MissionDbRow[] =>
  MISSION_VERIFIER_CONFIG.filter((c) => !c.insert).map((c, i) => ({
    id: 100 + i,
    level: c.level,
    index: c.index,
    title: c.title ?? c.seedTitle,
    description: c.description ?? 'prod',
    verifierKey: c.verifierKey,
    verifierParams: c.verifierParams,
    proofKind: c.proofKind,
    levelTitle: PROD_LEVEL_TITLES[c.level],
    reward: REWARDS[c.level],
  }))

/** What --apply leaves behind (updates applied, inserts become rows). */
function applyPlan(rows: MissionDbRow[], plan: VerifierMigrationPlan): MissionDbRow[] {
  const out = rows.map((r) => ({ ...r }))
  for (const u of plan.updates) Object.assign(out.find((r) => r.id === u.id)!, u.data)
  let id = 1000
  for (const i of plan.inserts) out.push({ id: id++, ...i.data })
  return out
}

const at = (level: number, index: number) => (r: { level: number; index: number }) => r.level === level && r.index === index

describe('planVerifierMigration', () => {
  it('maps every seeded mission by (level, index); 8 automatic, 4 semi (proof link), 1 manual', () => {
    const plan = planVerifierMigration(seedRows())
    expect(plan.errors).toEqual([])
    expect(plan.updates).toHaveLength(12)
    expect(plan.inserts.map((i) => `L${i.level}.${i.index}`)).toEqual(['L5.2'])
    const auto = MISSION_VERIFIER_CONFIG.filter((c) => c.verifierKey && VERIFIERS[c.verifierKey]?.mode === 'auto')
    expect(auto.map((c) => `L${c.level}.${c.index}`)).toEqual(['L1.1', 'L2.0', 'L3.0', 'L3.1', 'L5.0', 'L5.2', 'L6.0', 'L7.0'])
    const semi = MISSION_VERIFIER_CONFIG.filter((c) => c.verifierKey && VERIFIERS[c.verifierKey]?.mode === 'semi')
    expect(semi.map((c) => `L${c.level}.${c.index}:${c.verifierKey}`)).toEqual(['L2.1:social_post', 'L4.1:poap_drop', 'L5.1:media_proof', 'L6.1:gpp_host'])
    expect(semi.every((c) => c.proofKind === 'URL')).toBe(true)
    expect(MISSION_VERIFIER_CONFIG.filter((c) => !c.verifierKey)).toEqual([])
    expect(MISSION_VERIFIER_CONFIG.filter((c) => c.verifierKey === 'manual').map((c) => `L${c.level}.${c.index}`)).toEqual(['L8.0'])
    // Every configured verifier exists and accepts its params.
    for (const c of MISSION_VERIFIER_CONFIG) if (c.verifierKey) expect(() => VERIFIERS[c.verifierKey!].parse(c.verifierParams)).not.toThrow()
  })

  it("keeps prod's quirks: L1 and L4 at index 1, L3.0 titled \"Share something in #show-and-tell\"", () => {
    expect(MISSION_VERIFIER_CONFIG.filter((c) => c.level === 1 || c.level === 4).map((c) => `L${c.level}.${c.index}`)).toEqual(['L1.1', 'L4.1'])
    expect(MISSION_VERIFIER_CONFIG.find(at(3, 0))!.seedTitle).toBe('Share something in #show-and-tell')
  })

  it('rewords L1.0 to "Link your X account" (D1)', () => {
    const l1 = planVerifierMigration(seedRows()).updates.find((u) => u.level === 1)!
    expect(l1.data).toMatchObject({ title: 'Link your X account and follow @RarePizzas + @Pizza_DAO', verifierKey: 'x_linked' })
  })

  it('Phase 4: a database already on the Phase 1 config only gets the new semi verifiers (and descriptions)', () => {
    // Prod after Phase 1: L2.1 / L4.1 / L5.1 / L6.1 had verifierKey null, proofKind URL.
    const rows = seedRows()
    for (const c of MISSION_VERIFIER_CONFIG) {
      const r = rows.find(at(c.level, c.index))
      if (!r) continue
      Object.assign(r, { title: c.title ?? c.seedTitle, description: c.description ?? 'seed', proofKind: c.proofKind })
      if (['social_post', 'poap_drop', 'media_proof', 'gpp_host', 'referral'].includes(c.verifierKey ?? '')) Object.assign(r, { description: 'old' })
      if (!['social_post', 'poap_drop', 'media_proof', 'gpp_host'].includes(c.verifierKey ?? '')) Object.assign(r, { verifierKey: c.verifierKey, verifierParams: c.verifierParams })
    }
    const plan = planVerifierMigration(rows, MISSION_VERIFIER_CONFIG, {}) // level titles: covered below
    expect(plan.errors).toEqual([])
    expect(plan.updates.map((u) => `L${u.level}.${u.index}`)).toEqual(['L2.1', 'L3.1', 'L4.1', 'L5.1', 'L6.1'])
    expect(plan.updates.find((u) => u.level === 2)!.changes).toContain('verifierKey null -> social_post')
    expect(plan.updates.find((u) => u.level === 3)!.changes).toEqual(['description'])
    expect(plan.updates.find((u) => u.level === 3)!.data).toEqual({ description: expect.any(String) }) // only what changes
  })

  it('is idempotent: applying the plan leaves nothing to do', () => {
    const rows = seedRows()
    const again = planVerifierMigration(applyPlan(rows, planVerifierMigration(rows)))
    expect(again.updates).toEqual([])
    expect(again.inserts).toEqual([])
    expect(again.unchanged).toHaveLength(13)
  })

  it('aborts on a title that differs from the seed (rows edited by hand)', () => {
    const rows = seedRows()
    rows[5].title = 'Make a POAP (edited)'
    const plan = planVerifierMigration(rows)
    expect(plan.errors).toEqual([expect.stringMatching(/^L4\.1: title is "Make a POAP \(edited\)"/)])
  })

  it('reports missing rows without failing', () => {
    const plan = planVerifierMigration(seedRows().filter((r) => r.level !== 8))
    expect(plan.missing).toEqual([expect.stringMatching(/^L8\.0/)])
    expect(plan.errors).toEqual([])
  })
})

describe('planVerifierMigration on production: L5.2 vouch mission + level titles', () => {
  it('the owner\'s level titles: L3-L5 renamed, L6 stays "Street Muscle"; L1, L2, L7, L8 untouched', () => {
    expect(MISSION_LEVEL_TITLES).toEqual({
      3: "Make us an offer we can't refuse",
      4: 'Do some dirty work',
      5: 'Do a favor for the mafia',
      6: 'Street Muscle',
    })
  })

  it('dry run: inserts L5.2 and sets levelTitle on every L3, L4 and L5 row, nothing else', () => {
    const plan = planVerifierMigration(prodRows())
    expect(plan.errors).toEqual([])
    expect(plan.missing).toEqual([])
    expect(plan.inserts).toEqual([
      {
        level: 5,
        index: 2,
        data: {
          level: 5,
          index: 2,
          title: 'Vouch for another member',
          description: expect.stringMatching(/^Vouch for another PizzaDAO member/),
          reward: 4269,
          levelTitle: 'Do a favor for the mafia',
          isActive: true,
          verifierKey: 'vouch_given',
          verifierParams: { min: 1, sources: ['PIZZADAO'] },
          proofKind: 'NONE',
        },
      },
    ])
    expect(plan.updates.map((u) => [`L${u.level}.${u.index}`, u.data, u.changes])).toEqual([
      ['L3.0', { levelTitle: "Make us an offer we can't refuse" }, ['levelTitle null -> "Make us an offer we can\'t refuse"']],
      ['L3.1', { levelTitle: "Make us an offer we can't refuse" }, ['levelTitle null -> "Make us an offer we can\'t refuse"']],
      ['L4.1', { levelTitle: 'Do some dirty work' }, ['levelTitle null -> "Do some dirty work"']],
      ['L5.0', { levelTitle: 'Do a favor for the mafia' }, ['levelTitle null -> "Do a favor for the mafia"']],
      ['L5.1', { levelTitle: 'Do a favor for the mafia' }, ['levelTitle null -> "Do a favor for the mafia"']],
    ])
    expect(plan.unchanged).toEqual(['L1.1', 'L2.0', 'L2.1', 'L6.0', 'L6.1', 'L7.0', 'L8.0'])
  })

  it('apply, then re-run: nothing to do (idempotent), and every L5 row shares the title and reward', () => {
    const after = applyPlan(prodRows(), planVerifierMigration(prodRows()))
    const again = planVerifierMigration(after)
    expect(again).toMatchObject({ updates: [], inserts: [], errors: [], missing: [] })
    expect(again.unchanged).toHaveLength(13)
    const l5 = after.filter((r) => r.level === 5)
    expect(l5.map((r) => [r.index, r.levelTitle, r.reward])).toEqual([
      [0, 'Do a favor for the mafia', 4269],
      [1, 'Do a favor for the mafia', 4269],
      [2, 'Do a favor for the mafia', 4269],
    ])
    expect(after.filter((r) => r.level === 6).map((r) => r.levelTitle)).toEqual(['Street Muscle', 'Street Muscle'])
  })

  it('a level row outside the config (e.g. an inactive one) still gets its level title', () => {
    const rows = [...prodRows(), { ...prodRows()[0], id: 999, level: 5, index: 9, title: 'Old', levelTitle: null }]
    expect(planVerifierMigration(rows).updates.find((u) => u.id === 999)?.data).toEqual({ levelTitle: 'Do a favor for the mafia' })
  })

  it('aborts when the new mission\'s reward differs from the level\'s shared reward', () => {
    const rows = prodRows().map((r) => (r.level === 5 ? { ...r, reward: 5000 } : r))
    const plan = planVerifierMigration(rows)
    expect(plan.errors).toEqual([expect.stringMatching(/^L5\.2: reward 4269 differs from level 5's shared reward 5000/)])
    expect(plan.inserts).toEqual([])
  })

  it('--level-titles overrides / adds titles (one command to rename later)', () => {
    expect(parseLevelTitlesArg('3="Capo",4="Made Guy"')).toEqual({ 3: 'Capo', 4: 'Made Guy' })
    expect(parseLevelTitlesArg(`3="Make us an offer, we can't refuse", 4='Do "dirty" work' ,5=Plain`)).toEqual({
      3: "Make us an offer, we can't refuse",
      4: 'Do "dirty" work',
      5: 'Plain',
    })
    expect(() => parseLevelTitlesArg('')).toThrow()
    expect(() => parseLevelTitlesArg('x="nope"')).toThrow()
    expect(() => parseLevelTitlesArg('3=""')).toThrow()
    const titles = { ...MISSION_LEVEL_TITLES, ...parseLevelTitlesArg('4="Capo"') }
    const plan = planVerifierMigration(prodRows(), MISSION_VERIFIER_CONFIG, titles)
    expect(plan.updates.find((u) => u.level === 4)!.data).toEqual({ levelTitle: 'Capo' })
  })
})

describe('policy (D9)', () => {
  const now = new Date('2026-10-03T00:00:00Z')

  it('reads the account age from the snowflake', () => {
    const id = snowflakeAt(new Date('2026-09-01T00:00:00Z'))
    expect(snowflakeCreatedAt(id)?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(snowflakeCreatedAt('not-a-snowflake')).toBeNull()
    expect(isNewAccount(snowflakeAt(new Date('2026-09-20T00:00:00Z')), now)).toBe(true)
    expect(isNewAccount(snowflakeAt(new Date('2026-08-01T00:00:00Z')), now)).toBe(false)
    expect(isNewAccount('garbage', now)).toBe(true) // fail safe
  })

  it('needs a human release for L6+ and for accounts under 30 days', () => {
    const old = snowflakeAt(new Date('2022-01-01T00:00:00Z'))
    const young = snowflakeAt(new Date('2026-09-30T00:00:00Z'))
    expect(releaseHoldFor(1, old, now)).toBeNull()
    expect(releaseHoldFor(5, old, now)).toBeNull()
    expect(releaseHoldFor(6, old, now)).toBe('HIGH_LEVEL')
    expect(releaseHoldFor(7, old, now)).toBe('HIGH_LEVEL')
    expect(releaseHoldFor(1, young, now)).toBe('NEW_ACCOUNT')
  })

  it('MISSION_VERIFIERS_ENABLED defaults off', () => {
    const env = (v?: string) => (v === undefined ? {} : { MISSION_VERIFIERS_ENABLED: v }) as NodeJS.ProcessEnv
    expect(missionVerifiersEnabled(env())).toBe(false)
    expect(missionVerifiersEnabled(env('0'))).toBe(false)
    expect(missionVerifiersEnabled(env('1'))).toBe(true)
    expect(missionVerifiersEnabled(env('true'))).toBe(true)
  })
})

describe('discord-channels (fetch injected)', () => {
  beforeEach(() => clearGuildChannelsCache())
  const opts = (fetchImpl: unknown) => ({ botToken: 't', guildId: '812097286003359764', fetchImpl: fetchImpl as typeof fetch })

  it('parses message links', () => {
    expect(parseMessageLink('https://discord.com/channels/1234567/2345678/3456789')).toEqual({ guildId: '1234567', channelId: '2345678', messageId: '3456789' })
    expect(parseMessageLink('https://ptb.discordapp.com/channels/1234567/2345678/3456789?x')).not.toBeNull()
    expect(parseMessageLink('https://evil.com/channels/1234567/2345678/3456789')).toBeNull()
    expect(parseMessageLink('http://discord.com/channels/1234567/2345678/3456789')).toBeNull()
  })

  it('resolves a channel by name (decorated names too), cached; env override wins', async () => {
    expect(normalizeChannelName('🎨・Show-And-Tell')).toBe('show-and-tell')
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([
        { id: '111111', name: 'general', type: 0 },
        { id: '222222', name: '🎨・show-and-tell', type: 15 },
        { id: '333333', name: 'work', type: 0 },
        { id: '444444', name: 'work', type: 2 }, // voice: ignored
      ])),
    )
    expect(await resolveChannelId('show-and-tell', undefined, opts(fetchImpl))).toBe('222222')
    expect(await resolveChannelId('work', undefined, opts(fetchImpl))).toBe('333333')
    expect(fetchImpl).toHaveBeenCalledTimes(1) // cached
    process.env.MISSIONS_ANNOUNCE_CHANNEL_ID = '999999999'
    expect(await resolveChannelId('work', 'MISSIONS_ANNOUNCE_CHANNEL_ID', opts(fetchImpl))).toBe('999999999')
    delete process.env.MISSIONS_ANNOUNCE_CHANNEL_ID
  })

  it('getChannelMessage: null for 404/403, "unknown" for other failures', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ id: '3456789', channel_id: '2345678', author: { id: '7654321' } })))
    expect(await getChannelMessage('2345678', '3456789', opts(ok))).toMatchObject({ authorId: '7654321', channelId: '2345678' })
    expect(await getChannelMessage('2345678', '3456789', opts(vi.fn(async () => new Response('', { status: 404 }))))).toBeNull()
    expect(await getChannelMessage('2345678', '3456789', opts(vi.fn(async () => new Response('', { status: 500 }))))).toBe('unknown')
    expect(await getChannelMessage('2345678', '3456789', { fetchImpl: ok as unknown as typeof fetch, botToken: '' })).toBe('unknown')
  })
})

describe('checkKeyedRateLimit (in-memory backend)', () => {
  beforeEach(() => __resetMemoryRateLimits())
  it('limits per key: 1 /missions per minute per member', async () => {
    expect((await checkKeyedRateLimit('missions-command', 'a')).success).toBe(true)
    expect((await checkKeyedRateLimit('missions-command', 'a')).success).toBe(false)
    expect((await checkKeyedRateLimit('missions-command', 'b')).success).toBe(true)
  })
})
