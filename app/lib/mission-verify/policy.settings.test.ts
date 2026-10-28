// @vitest-environment node
// The hold rules, their copy, the SLA digest and the review-card text follow the admin settings.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db')

import { prisma } from '../db'
import { clearSettingsCache } from '../settings'
import {
  DEFAULT_HOLD_POLICY, HOLD_LABEL, holdLabel, isNewAccount, loadHoldPolicy, releaseHoldFor, snowflakeAt,
} from './policy'
import { renderSlaDigest, loadSlaRules, type OverdueItem } from './sla'
import { dprOnlyText } from '../discord-interactions/mission-review'

const findMany = vi.mocked(prisma.appSetting.findMany)
const rows = (o: Record<string, unknown>) => findMany.mockResolvedValue(Object.entries(o).map(([key, value]) => ({ key, value })) as never)

const now = new Date('2026-10-30T00:00:00Z')
const old = snowflakeAt(new Date('2022-01-01T00:00:00Z'))
const aged45 = snowflakeAt(new Date('2026-09-15T00:00:00Z')) // 45 days old

beforeEach(() => {
  clearSettingsCache({ all: true })
  findMany.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('hold policy', () => {
  it('an invalid stored hold value also counts as unreadable', async () => {
    rows({ 'missions.humanReleaseMinLevel': 9 })
    expect((await loadHoldPolicy()).readFailed).toBe(true)
  })

  it('with no rows it equals the defaults, and the copy is byte-identical to the old literals', async () => {
    findMany.mockResolvedValue([])
    expect(await loadHoldPolicy()).toEqual(DEFAULT_HOLD_POLICY)
    expect(HOLD_LABEL).toEqual({
      NEW_ACCOUNT: 'Discord account under 30 days old',
      HIGH_LEVEL: 'Level 6+ needs a human approval',
      PREVIOUSLY_REJECTED: 'Rejected before; the verifier now passes',
    })
  })

  it('human release at 5 holds an L5 pass (and the label says so)', async () => {
    rows({ 'missions.humanReleaseMinLevel': 5 })
    const policy = await loadHoldPolicy()
    expect(releaseHoldFor(4, old, now, policy)).toBeNull()
    expect(releaseHoldFor(5, old, now, policy)).toBe('HIGH_LEVEL')
    expect(releaseHoldFor(5, old, now)).toBeNull() // the default policy is unchanged
    expect(holdLabel('HIGH_LEVEL', policy)).toBe('Level 5+ needs a human approval')
  })

  it('a longer new-account age holds a 45 day old account; the label is built from the setting', async () => {
    rows({ 'missions.newAccountDays': 60 })
    const policy = await loadHoldPolicy()
    expect(isNewAccount(aged45, now)).toBe(false)
    expect(isNewAccount(aged45, now, policy)).toBe(true)
    expect(releaseHoldFor(1, aged45, now, policy)).toBe('NEW_ACCOUNT')
    expect(holdLabel('NEW_ACCOUNT', policy)).toBe('Discord account under 60 days old')
  })

  it('a loosening value in the database is rejected on read: strictest rules apply', async () => {
    rows({ 'missions.humanReleaseMinLevel': 8, 'missions.newAccountDays': 3 })
    const policy = await loadHoldPolicy()
    expect(policy).toEqual({ humanReleaseMinLevel: 1, newAccountDays: 365, readFailed: true })
  })

  it('settings unreadable: flagged readFailed (callers must not approve or persist a hold) and strictest values', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const policy = await loadHoldPolicy()
    expect(policy.readFailed).toBe(true)
    expect(releaseHoldFor(1, old, now, policy)).toBe('HIGH_LEVEL')
    expect(releaseHoldFor(1, old, now)).toBeNull()
  })
})

describe('SLA digest follows the settings', () => {
  const item = (id: number): OverdueItem => ({
    id, discordId: `10000000000000000${id}`, level: 3, index: 0, title: 'A mission', holdReason: null,
    submittedAt: new Date('2026-10-01T00:00:00Z'), reviewQueuedAt: null, reviewMsgId: null, reviewChannelId: null,
    queuedAt: new Date('2026-10-01T00:00:00Z'), waitingMs: 80 * 3_600_000,
  })

  it('defaults are unchanged: 48h and 15 lines', () => {
    const body = renderSlaDigest([item(1)], { guildId: null, appUrl: 'https://x.test' })
    expect((body.embeds as Array<{ description: string; footer?: { text: string } }>)[0].description).toContain('past the 48h target')
  })

  it('uses the configured hours and line cap', async () => {
    rows({ 'missions.slaHours': 24, 'missions.slaDigestMaxLines': 2 })
    const rules = await loadSlaRules()
    expect(rules).toEqual({ slaHours: 24, maxLines: 2 })
    const body = renderSlaDigest([item(1), item(2), item(3)], { guildId: null, appUrl: 'https://x.test', ...rules })
    const embed = (body.embeds as Array<{ description: string; footer?: { text: string } }>)[0]
    expect(embed.description).toContain('past the 24h target')
    expect(embed.footer?.text).toContain('within 24 hours')
    expect(embed.description).toContain('and 1 more')
  })
})

describe('refusal copy for the top-role-only levels', () => {
  it('is byte-identical at the default and built from the setting otherwise', () => {
    expect(dprOnlyText(8)).toBe('Only Dread Pizza Roberts reviews Level 8 missions.')
    expect(dprOnlyText(6)).toBe('Only Dread Pizza Roberts reviews Levels 6-8 missions.')
  })
})
