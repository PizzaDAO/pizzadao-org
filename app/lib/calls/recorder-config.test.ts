// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'

const { state } = vi.hoisted(() => ({ state: { over: {} as Record<string, unknown>, crews: [] as Array<{ id: string; label: string; event?: string; callLength?: string }> } }))

vi.mock('@/app/lib/settings', () => ({
  loadSettings: async (): Promise<Settings> => ({
    readFailed: false,
    invalidKeys: [],
    isSet: (k) => k in state.over,
    get: ((k: SettingKey) => (k in state.over ? state.over[k] : SETTINGS[k].default)) as Settings['get'],
  }),
}))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: async () => ({ crews: state.crews, cached: true }) }))

import { buildRecorderConfig, RECORDER_CONFIG_OFF } from './recorder-config'

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  state.over = {}
  state.crews = [
    { id: 'ops', label: 'Ops', event: 'https://discord.com/events/1/100000000000000001' },
    { id: 'tech', label: 'Tech', event: '100000000000000002' },
  ]
})
afterEach(() => vi.unstubAllEnvs())

describe('recorder config: live action items', () => {
  it('is off by default', async () => {
    expect((await buildRecorderConfig()).liveItems).toEqual(RECORDER_CONFIG_OFF.liveItems)
  })
  it('lists the Discord events of allowlisted crews only', async () => {
    state.over = { 'calls.liveActionItemsEnabled': true, 'calls.chatActionItemsEnabled': true, 'calls.liveActionItemsCrews': 'ops', 'calls.liveChunkSeconds': 120 }
    expect((await buildRecorderConfig()).liveItems).toEqual({ audio: true, chunkSeconds: 120, chat: true, prefixes: ['action:', 'ai:', 'todo:'], eventIds: ['100000000000000001'] })
  })
  it('stays off when no allowlisted crew has an event, and on previews', async () => {
    state.over = { 'calls.liveActionItemsEnabled': true, 'calls.liveActionItemsCrews': 'events' }
    expect((await buildRecorderConfig()).liveItems).toEqual(RECORDER_CONFIG_OFF.liveItems)
    state.over = { 'calls.liveActionItemsEnabled': true, 'calls.liveActionItemsCrews': 'ops' }
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await buildRecorderConfig()).liveItems).toEqual(RECORDER_CONFIG_OFF.liveItems)
  })
})

describe('recorder config: supersede deferral', () => {
  it('passes the cap through (default 30 minutes, 0 turns it off)', async () => {
    expect((await buildRecorderConfig()).supersedeMaxDeferMinutes).toBe(30)
    state.over = { 'calls.supersedeMaxDeferMinutes': 0 }
    expect((await buildRecorderConfig()).supersedeMaxDeferMinutes).toBe(0)
  })
})
