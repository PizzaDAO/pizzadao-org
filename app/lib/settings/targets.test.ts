// @vitest-environment node
// Save-time resolution of Discord targets, the stricter-only reviewer roles, and the channel/role readers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('../discord-channels', () => ({
  getGuildChannels: vi.fn(),
  getGuildRoles: vi.fn(),
  resolveChannelId: vi.fn(async () => 'by-name'),
}))

import { prisma } from '@/app/lib/db'
import { getGuildChannels, getGuildRoles } from '../discord-channels'
import { clearSettingsCache } from './index'
import { checkTargets, TargetError } from './targets'
import { parseSetting } from './registry'
import { confirmationFor } from './store'
import { resolveConfiguredChannel, savedChannelId } from './channels'
import { articleAuthorRoleIds } from './roles'
import { ARTICLE_AUTHOR_ROLE_IDS } from '@/app/ui/constants'

const channels = vi.mocked(getGuildChannels)
const roles = vi.mocked(getGuildRoles)
const findMany = vi.mocked(prisma.appSetting.findMany)

const CHAN = '900000000000000001'
const VOICE = '900000000000000002'
const ROLE = '900000000000000003'
const CAPO = '839206162837798945'
const LEONARDO = '815269418305191946'
const DPR = '812131585327235113'
const OUTSIDER = '999999999999999999'

beforeEach(() => {
  clearSettingsCache({ all: true })
  findMany.mockReset()
  findMany.mockResolvedValue([])
  channels.mockResolvedValue([
    { id: CHAN, name: 'general', type: 0 },
    { id: VOICE, name: 'call', type: 2 },
  ])
  roles.mockResolvedValue([{ id: ROLE, name: 'Helper' }])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('checkTargets (save-time resolution)', () => {
  it('accepts a text channel of our server, rejects one that is not there', async () => {
    await expect(checkTargets('discord.announceChannelId', CHAN)).resolves.toBeUndefined()
    await expect(checkTargets('discord.announceChannelId', OUTSIDER)).rejects.toThrow(TargetError)
    await expect(checkTargets('discord.announceChannelId', OUTSIDER)).rejects.toThrow(/not a channel in this server/)
  })

  it('a voice setting needs a voice channel and a text setting needs a text channel', async () => {
    await expect(checkTargets('discord.callVoiceChannelId', VOICE)).resolves.toBeUndefined()
    await expect(checkTargets('discord.callVoiceChannelId', CHAN)).rejects.toThrow(/not a voice channel/)
    await expect(checkTargets('discord.missionReviewChannelId', VOICE)).rejects.toThrow(/not a text channel/)
  })

  it('rejects the save (never stores it unchecked) when Discord cannot be asked', async () => {
    channels.mockResolvedValue(null)
    roles.mockResolvedValue(null)
    await expect(checkTargets('discord.announceChannelId', CHAN)).rejects.toThrow(/try again/)
    await expect(checkTargets('missions.slaPingRoleId', ROLE)).rejects.toThrow(/try again/)
  })

  it('empty means "use the default" for a channel or one role, but a role list cannot be emptied', async () => {
    await expect(checkTargets('discord.announceChannelId', '')).resolves.toBeUndefined()
    await expect(checkTargets('missions.slaPingRoleId', '')).resolves.toBeUndefined()
    await expect(checkTargets('announce.roleIds', [])).rejects.toThrow(/at least one role/)
  })

  it('roles must exist in the server and not repeat', async () => {
    await expect(checkTargets('missions.slaPingRoleId', ROLE)).resolves.toBeUndefined()
    await expect(checkTargets('missions.slaPingRoleId', OUTSIDER)).rejects.toThrow(/Not a role in this server/)
    await expect(checkTargets('announce.roleIds', [ROLE, OUTSIDER])).rejects.toThrow(/Not a role/)
    await expect(checkTargets('announce.roleIds', [ROLE, ROLE])).rejects.toThrow(/twice/)
    await expect(checkTargets('articles.authorRoleIds', [ROLE])).resolves.toBeUndefined()
  })

  it('does nothing for settings that are not Discord targets', async () => {
    channels.mockClear()
    await expect(checkTargets('missions.maxAttempts', 3)).resolves.toBeUndefined()
    expect(channels).not.toHaveBeenCalled()
  })
})

describe('shape checks', () => {
  it('ids must be snowflakes', () => {
    expect(parseSetting('discord.announceChannelId', 'general').ok).toBe(false)
    expect(parseSetting('discord.announceChannelId', 123).ok).toBe(false)
    expect(parseSetting('discord.announceChannelId', '').ok).toBe(true)
    expect(parseSetting('announce.roleIds', ['not-an-id']).ok).toBe(false)
    expect(parseSetting('announce.roleIds', Array(11).fill(ROLE)).ok).toBe(false)
  })

  it('switches take booleans only', () => {
    expect(parseSetting('disavow.enabled', true).ok).toBe(true)
    expect(parseSetting('disavow.enabled', 'true').ok).toBe(false)
    expect(parseSetting('disavow.enabled', 1).ok).toBe(false)
  })
})

describe('missions.reviewerRoleIds is stricter-only', () => {
  it('may only narrow the built-in list: adding any other role is rejected', () => {
    expect(parseSetting('missions.reviewerRoleIds', [CAPO]).ok).toBe(true)
    expect(parseSetting('missions.reviewerRoleIds', [CAPO, LEONARDO]).ok).toBe(true)
    expect(parseSetting('missions.reviewerRoleIds', [ROLE]).ok).toBe(false)
    expect(parseSetting('missions.reviewerRoleIds', [CAPO, ROLE]).ok).toBe(false)
  })

  it('widening back toward the full list asks for the loosening confirmation; narrowing asks the fewer-roles one', () => {
    expect(confirmationFor('missions.reviewerRoleIds', [CAPO, LEONARDO], [CAPO])).toMatch(/Fewer roles/)
    expect(confirmationFor('missions.reviewerRoleIds', [CAPO], [CAPO, LEONARDO])).toMatch(/loosens/)
    // reset = empty = the whole list
    expect(confirmationFor('missions.reviewerRoleIds', [CAPO], [])).toMatch(/loosens/)
  })

  it('the confirmation counts an empty list as the whole built-in list', () => {
    // [] (all four) -> one role is narrower; one role -> [] is wider
    expect(confirmationFor('missions.reviewerRoleIds', [], [CAPO])).toMatch(/Fewer roles/)
    expect(confirmationFor('missions.reviewerRoleIds', [CAPO], [])).toMatch(/loosens/)
  })

  it('unreadable settings leave only the top role', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const { reviewerRoleSetting } = await import('../mission-review-access')
    expect(await reviewerRoleSetting()).toEqual([DPR])
  })
})

describe('channel and role readers fall back to the old behaviour', () => {
  it('no saved channel: the env/name chain; saved channel wins', async () => {
    expect(await savedChannelId('discord.missionReviewChannelId')).toBe('')
    expect(await resolveConfiguredChannel('discord.missionReviewChannelId', 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe('by-name')
    clearSettingsCache()
    findMany.mockResolvedValue([{ key: 'discord.missionReviewChannelId', value: CHAN }] as never)
    expect(await resolveConfiguredChannel('discord.missionReviewChannelId', 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(CHAN)
  })

  it('an invalid stored channel is ignored (falls back, never posts to a bad id)', async () => {
    findMany.mockResolvedValue([{ key: 'discord.missionReviewChannelId', value: 'oops' }] as never)
    expect(await resolveConfiguredChannel('discord.missionReviewChannelId', 'work')).toBe('by-name')
  })

  it('article authors: built-in list unless a list is saved', async () => {
    expect(await articleAuthorRoleIds()).toEqual(ARTICLE_AUTHOR_ROLE_IDS)
    clearSettingsCache()
    findMany.mockResolvedValue([{ key: 'articles.authorRoleIds', value: [ROLE] }] as never)
    expect(await articleAuthorRoleIds()).toEqual([ROLE, DPR]) // Dread Pizza Roberts is always included
  })
})
