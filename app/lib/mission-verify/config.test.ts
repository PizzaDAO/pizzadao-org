// @vitest-environment node
// Data-migration plan, payout policy, Discord channel helpers, keyed rate limits.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MISSION_VERIFIER_CONFIG, planVerifierMigration, type MissionDbRow } from './mission-config'
import { VERIFIERS } from './verifiers'
import { isNewAccount, missionVerifiersEnabled, releaseHoldFor, snowflakeAt, snowflakeCreatedAt } from './policy'
import { clearGuildChannelsCache, getChannelMessage, normalizeChannelName, parseMessageLink, resolveChannelId } from '../discord-channels'
import { __resetMemoryRateLimits, checkKeyedRateLimit } from '../rate-limit'

const seedRows = (): MissionDbRow[] =>
  MISSION_VERIFIER_CONFIG.map((c, i) => ({
    id: i + 1,
    level: c.level,
    index: c.index,
    title: c.seedTitle,
    description: 'seed',
    verifierKey: null,
    verifierParams: null,
    proofKind: 'NONE',
  }))

describe('planVerifierMigration', () => {
  it('maps every seeded mission by (level, index); 7 automatic, 4 semi (proof link), 1 manual', () => {
    const plan = planVerifierMigration(seedRows())
    expect(plan.errors).toEqual([])
    expect(plan.updates).toHaveLength(12)
    const auto = MISSION_VERIFIER_CONFIG.filter((c) => c.verifierKey && VERIFIERS[c.verifierKey]?.mode === 'auto')
    expect(auto.map((c) => `L${c.level}.${c.index}`)).toEqual(['L1.1', 'L2.0', 'L3.0', 'L3.1', 'L5.0', 'L6.0', 'L7.0'])
    const semi = MISSION_VERIFIER_CONFIG.filter((c) => c.verifierKey && VERIFIERS[c.verifierKey]?.mode === 'semi')
    expect(semi.map((c) => `L${c.level}.${c.index}:${c.verifierKey}`)).toEqual(['L2.1:social_post', 'L4.1:poap_drop', 'L5.1:media_proof', 'L6.1:gpp_host'])
    expect(semi.every((c) => c.proofKind === 'URL')).toBe(true)
    expect(MISSION_VERIFIER_CONFIG.filter((c) => !c.verifierKey)).toEqual([])
    expect(MISSION_VERIFIER_CONFIG.filter((c) => c.verifierKey === 'manual').map((c) => `L${c.level}.${c.index}`)).toEqual(['L8.0'])
    // Every configured verifier exists and accepts its params.
    for (const c of MISSION_VERIFIER_CONFIG) if (c.verifierKey) expect(() => VERIFIERS[c.verifierKey!].parse(c.verifierParams)).not.toThrow()
  })

  it('rewords L1.0 to "Link your X account" (D1)', () => {
    const l1 = planVerifierMigration(seedRows()).updates.find((u) => u.level === 1)!
    expect(l1.data).toMatchObject({ title: 'Link your X account and follow @RarePizzas + @Pizza_DAO', verifierKey: 'x_linked' })
  })

  it('Phase 4: a database already on the Phase 1 config only gets the new semi verifiers (and descriptions)', () => {
    // Prod after Phase 1: L2.1 / L4.1 / L5.1 / L6.1 had verifierKey null, proofKind URL.
    const rows = seedRows()
    for (const c of MISSION_VERIFIER_CONFIG) {
      const r = rows.find((x) => x.level === c.level && x.index === c.index)!
      Object.assign(r, { title: c.title ?? c.seedTitle, description: c.description ?? 'seed', proofKind: c.proofKind })
      if (['social_post', 'poap_drop', 'media_proof', 'gpp_host', 'referral'].includes(c.verifierKey ?? '')) Object.assign(r, { description: 'old' })
      if (!['social_post', 'poap_drop', 'media_proof', 'gpp_host'].includes(c.verifierKey ?? '')) Object.assign(r, { verifierKey: c.verifierKey, verifierParams: c.verifierParams })
    }
    const plan = planVerifierMigration(rows)
    expect(plan.errors).toEqual([])
    expect(plan.updates.map((u) => `L${u.level}.${u.index}`)).toEqual(['L2.1', 'L3.1', 'L4.1', 'L5.1', 'L6.1'])
    expect(plan.updates.find((u) => u.level === 2)!.changes).toContain('verifierKey null -> social_post')
    expect(plan.updates.find((u) => u.level === 3)!.changes).toEqual(['description'])
  })

  it('is idempotent: applying the plan leaves nothing to do', () => {
    const rows = seedRows()
    for (const u of planVerifierMigration(rows).updates) Object.assign(rows.find((r) => r.id === u.id)!, u.data)
    const again = planVerifierMigration(rows)
    expect(again.updates).toEqual([])
    expect(again.unchanged).toHaveLength(12)
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
