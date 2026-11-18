// @vitest-environment node
// Rename-proofing: a channel found by name is saved by id, so renaming the channel (#work -> something else)
// cannot silently stop the posts that look it up (mission review cards, level-ups, SLA digest, nightly verify, trivia).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('../discord-channels', async (importActual) => ({
  ...(await importActual<typeof import('../discord-channels')>()),
  resolveChannelId: vi.fn(),
  getGuildChannels: vi.fn(),
}))
vi.mock('./store', () => ({ saveSetting: vi.fn(async () => ({ updatedAt: new Date() })) }))

import { prisma } from '@/app/lib/db'
import { getGuildChannels, resolveChannelId } from '../discord-channels'
import { clearSettingsCache } from './index'
import { saveSetting } from './store'
import { CHANNEL_PIN_ACTOR, pinChannelId, resetChannelPins, resolveConfiguredChannel, resolveConfiguredChannelDetailed } from './channels'

const findMany = vi.mocked(prisma.appSetting.findMany)
const resolve = vi.mocked(resolveChannelId)
const channelList = vi.mocked(getGuildChannels)
const save = vi.mocked(saveSetting)

const WORK = '910000000000000001'
const OTHER = '910000000000000002'
const REVIEW = 'discord.missionReviewChannelId' as const
const ANNOUNCE = 'discord.missionsAnnounceChannelId' as const

const ENV_KEYS = ['VERCEL_ENV', 'MISSION_REVIEW_CHANNEL_ID', 'MISSIONS_ANNOUNCE_CHANNEL_ID'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.VERCEL_ENV = 'production'
  clearSettingsCache({ all: true })
  resetChannelPins()
  findMany.mockReset()
  findMany.mockResolvedValue([])
  resolve.mockReset()
  resolve.mockResolvedValue(WORK)
  channelList.mockReset()
  channelList.mockResolvedValue([{ id: WORK, name: 'work', type: 0 }])
  save.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

describe('resolveConfiguredChannel pins a channel found by name', () => {
  it('saves the id it found into the setting (insert-only, as the system actor)', async () => {
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(REVIEW, WORK, CHANNEL_PIN_ACTOR, expect.objectContaining({ expectedUpdatedAt: null }))
  })

  it('pins each setting key separately (review cards and level-up posts both use "work")', async () => {
    await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')
    await resolveConfiguredChannel(ANNOUNCE, 'work', 'MISSIONS_ANNOUNCE_CHANNEL_ID')
    expect(save.mock.calls.map((c) => c[0])).toEqual([REVIEW, ANNOUNCE])
  })

  it('tries once per key and id on this instance, not on every post', async () => {
    await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')
    await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a saved id wins: no lookup by name, nothing saved (this is what survives the rename)', async () => {
    findMany.mockResolvedValue([{ key: REVIEW, value: WORK }] as never)
    // After the rename a name lookup finds nothing (or the wrong channel), but the saved id is used as is.
    resolve.mockResolvedValue(null)
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(resolve).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('the whole rename story: found by name once, still resolved after the name is gone', async () => {
    // Before the rename: nothing saved, the name lookup finds #work and saves it.
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(save).toHaveBeenCalledWith(REVIEW, WORK, CHANNEL_PIN_ACTOR, expect.anything())
    // The save lands in the database; the channel is renamed so a name lookup now finds nothing.
    findMany.mockResolvedValue([{ key: REVIEW, value: WORK }] as never)
    clearSettingsCache({ all: true })
    resolve.mockResolvedValue(null)
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
  })

  it('an env id is already rename-proof: nothing saved', async () => {
    process.env.MISSION_REVIEW_CHANNEL_ID = OTHER
    resolve.mockResolvedValue(OTHER)
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(OTHER)
    expect(save).not.toHaveBeenCalled()
  })

  it('a name lookup that finds nothing saves nothing and returns null', async () => {
    resolve.mockResolvedValue(null)
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('never writes from a preview (previews share the production database)', async () => {
    process.env.VERCEL_ENV = 'preview'
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(save).not.toHaveBeenCalled()
    delete process.env.VERCEL_ENV
    resetChannelPins()
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not write when the settings could not be read (it would overwrite a value it cannot see)', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(save).not.toHaveBeenCalled()
  })

  it('a failed save (conflict, outage) never breaks the lookup', async () => {
    save.mockRejectedValueOnce(new Error('changed since you loaded it'))
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('only an exact name match is pinned', () => {
  it('the suffix fallback of the name lookup (some other "...-work" channel) is used but never saved', async () => {
    channelList.mockResolvedValue([{ id: WORK, name: 'pizza-work', type: 0 }])
    expect(await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toBe(WORK)
    expect(save).not.toHaveBeenCalled()
  })

  it('a decorated name that normalizes to exactly "work" is exact', async () => {
    channelList.mockResolvedValue([{ id: WORK, name: '#Work', type: 0 }])
    await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('nothing is saved when the channel list cannot be read', async () => {
    channelList.mockResolvedValue(null)
    await resolveConfiguredChannel(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')
    expect(save).not.toHaveBeenCalled()
  })

  it('the detailed result says whether the answer is trusted (so trivia does not copy a suffix match)', async () => {
    channelList.mockResolvedValue([{ id: WORK, name: 'pizza-work', type: 0 }])
    expect(await resolveConfiguredChannelDetailed(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toEqual({ id: WORK, trusted: false })
    channelList.mockResolvedValue([{ id: WORK, name: 'work', type: 0 }])
    resetChannelPins()
    expect(await resolveConfiguredChannelDetailed(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toEqual({ id: WORK, trusted: true })
    findMany.mockResolvedValue([{ key: REVIEW, value: OTHER }] as never)
    clearSettingsCache({ all: true })
    expect(await resolveConfiguredChannelDetailed(REVIEW, 'work', 'MISSION_REVIEW_CHANNEL_ID')).toEqual({ id: OTHER, trusted: true })
  })
})

describe('pinChannelId', () => {
  it('refuses a value that is not a snowflake', async () => {
    expect(await pinChannelId(REVIEW, 'work')).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not overwrite an admin value, even a different one', async () => {
    findMany.mockResolvedValue([{ key: REVIEW, value: OTHER }] as never)
    expect(await pinChannelId(REVIEW, WORK)).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('returns true when it wrote', async () => {
    expect(await pinChannelId(REVIEW, WORK)).toBe(true)
  })

  it('works for the trivia channel setting too', async () => {
    expect(await pinChannelId('trivia.channelId', WORK)).toBe(true)
    expect(save).toHaveBeenCalledWith('trivia.channelId', WORK, CHANNEL_PIN_ACTOR, expect.anything())
  })
})
