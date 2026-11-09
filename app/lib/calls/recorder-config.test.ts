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
import { MAX_WHISPER_PROMPT_TOKENS, estimateKeytermTokens, normalizeKeyterms, whisperPrompt } from './keyterms'
import { transcriptionPrompt } from './transcribe'

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

describe('recorder config: transcription keyterms', () => {
  it('defaults to the starter list, without personal names', async () => {
    const terms = (await buildRecorderConfig()).transcriptionKeyterms
    expect(terms).toEqual(['PizzaDAO', 'RSVPizza', 'Pizza MCP', 'OpenPizza', 'ETHDenver', 'Devcon', 'EthCC', 'Global Pizza Party', 'Bitcoin Pizza Day', 'PEP', 'Metalhead', 'Rare Pizzas'])
    expect(RECORDER_CONFIG_OFF.transcriptionKeyterms).toEqual([])
  })
  it('one term per line, blanks and duplicates dropped, limits enforced', async () => {
    state.over = { 'calls.transcriptionTerms': ' ETHDenver \n\nethdenver\n' + 'x'.repeat(41) + '\nDevcon' }
    expect((await buildRecorderConfig()).transcriptionKeyterms).toEqual(['ETHDenver', 'Devcon'])
    state.over = { 'calls.transcriptionTerms': '' }
    expect((await buildRecorderConfig()).transcriptionKeyterms).toEqual([])
  })
  it('summary prompt carries the same terms as spellings to prefer', async () => {
    const { summarySystemPrompt } = await import('./summarize')
    const settings = { get: (k: string) => (k === 'calls.transcriptionTerms' ? 'ETHDenver\nDevcon' : '') } as unknown as Settings
    expect(summarySystemPrompt(settings)).toContain('Spellings to prefer')
    expect(summarySystemPrompt(settings)).toContain('ETHDenver, Devcon')
    expect(summarySystemPrompt({ get: () => '' } as unknown as Settings)).not.toContain('Spellings')
  })
})

describe('whisper prompt from the terms', () => {
  it('is terms only, and absent with no terms', () => {
    expect(whisperPrompt(['ETHDenver', 'Devcon'])).toBe('Terms: ETHDenver, Devcon.')
    expect(whisperPrompt([])).toBeUndefined()
    expect(whisperPrompt([' ', ''])).toBeUndefined()
  })
  it("is capped well under Whisper's 224 tokens", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Term number ${i} here`)
    const p = whisperPrompt(many)!
    const used = normalizeKeyterms(p.replace(/^Terms: /, '').replace(/\.$/, '').split(', '))
    expect(used.reduce((n, t) => n + estimateKeytermTokens(t), 0)).toBeLessThanOrEqual(MAX_WHISPER_PROMPT_TOKENS)
    expect(used.length).toBeLessThan(many.length)
    expect(MAX_WHISPER_PROMPT_TOKENS).toBeLessThan(224)
  })
  it('transcriptionPrompt reads the setting and fails soft', async () => {
    const s = (v: string) => ({ get: () => v }) as unknown as Settings
    expect(await transcriptionPrompt(s('ETHDenver\nDevcon'))).toBe('Terms: ETHDenver, Devcon.')
    expect(await transcriptionPrompt(s(''))).toBeUndefined()
    expect(
      await transcriptionPrompt({
        get: () => {
          throw new Error('x')
        },
      } as unknown as Settings),
    ).toBeUndefined()
  })
})

describe('recorder config: voice channels', () => {
  it('is empty by default', async () => {
    expect((await buildRecorderConfig()).voiceChannels).toEqual({ allowed: [], byEvent: [] })
  })
  it('passes the allowlist and resolves crew ids to Discord event ids', async () => {
    state.over = { 'calls.recordableVoiceChannels': '900000000000000001\nbad\n900000000000000001', 'calls.crewVoiceChannels': 'ops = 900000000000000001\nTECH=900000000000000002\nnope = x' }
    expect((await buildRecorderConfig()).voiceChannels).toEqual({
      allowed: ['900000000000000001'],
      byEvent: [
        { eventId: '100000000000000001', channelId: '900000000000000001' },
        { eventId: '100000000000000002', channelId: '900000000000000002' },
      ],
    })
  })
})
