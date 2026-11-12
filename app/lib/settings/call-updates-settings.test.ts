import { describe, expect, it } from 'vitest'
import { SETTINGS, SETTING_KEYS } from './registry'
import { TOGGLES, resolveToggle } from './toggles'
import { COMMAND_PHRASE, UPDATES_VOICES, UPDATES_VOICE_INSTRUCTIONS_DEFAULT } from './call-updates-settings'
import type { Settings } from './index'

const none = { get: () => undefined, isSet: () => false, readFailed: false, invalidKeys: [] } as unknown as Settings
const on = { get: () => true, isSet: () => true, readFailed: false, invalidKeys: [] } as unknown as Settings

describe('call updates settings', () => {
  it('every default is the safe one: everything off or empty, the plan defaults elsewhere', () => {
    const keys = [...SETTING_KEYS.filter((k) => k.startsWith('calls.updates')), 'discord.metalheadCommandEnabled'] as const
    expect(keys.map((k) => [k, SETTINGS[k].default])).toEqual([
      ['calls.updatesEnabled', false],
      ['calls.updatesControlAnyMember', false],
      ['calls.updatesMaxSeconds', 90],
      ['calls.updatesSections', 'last-call\ntask-changes\npriorities\nevents\nannouncements'],
      ['calls.updatesIntro', 'Automated call updates for the {crew} call.'],
      ['calls.updatesOutro', "That's the update."],
      ['calls.updatesAnnouncements', ''],
      ['calls.updatesVoice', 'ash'],
      ['calls.updatesVoiceInstructions', UPDATES_VOICE_INSTRUCTIONS_DEFAULT],
      ['calls.updatesPauseMaxMinutes', 5],
      ['discord.metalheadCommandEnabled', false],
    ])
  })

  it('the default voice style is generic: it names no person or character', () => {
    expect(UPDATES_VOICE_INSTRUCTIONS_DEFAULT).toMatch(/surfer-dude robot/)
    expect(UPDATES_VOICE_INSTRUCTIONS_DEFAULT).toMatch(/metallic/)
    expect(UPDATES_VOICE_INSTRUCTIONS_DEFAULT).not.toMatch(/turtle|ninja|raphael|leonardo|donatello|michelangelo|tmnt/i)
  })

  it('both switches use their env kill switch, are off by default on every deploy, and env off wins', () => {
    for (const [key, env] of [['calls.updatesEnabled', 'CALL_UPDATES_ENABLED'], ['discord.metalheadCommandEnabled', 'METALHEAD_COMMAND_ENABLED'], ['calls.updatesControlAnyMember', 'CALL_UPDATES_CONTROL_ANY_MEMBER']] as const) {
      expect(TOGGLES[key].env).toBe(env)
      expect(TOGGLES[key].legacy(undefined)).toBe(false)
      expect(resolveToggle(key, none, { VERCEL_ENV: 'production' })).toBe(false)
      expect(resolveToggle(key, on, { VERCEL_ENV: 'production' })).toBe(true)
      expect(resolveToggle(key, on, { VERCEL_ENV: 'production', [env]: 'off' })).toBe(false)
      // previews ignore saved rows
      expect(resolveToggle(key, on, { VERCEL_ENV: 'preview' })).toBe(false)
      expect(SETTINGS[key].help).toContain(env)
      expect(SETTINGS[key].help).toMatch(/on preview deploys only the env var counts/)
      if (key !== 'calls.updatesControlAnyMember') expect(SETTINGS[key].confirm?.(false, true)).toBeTruthy()
    }
  })

  it('bounds the numbers', () => {
    const s = (k: string, v: number) => SETTINGS[k as keyof typeof SETTINGS].schema.safeParse(v).success
    expect(s('calls.updatesMaxSeconds', 29)).toBe(false)
    expect(s('calls.updatesMaxSeconds', 30)).toBe(true)
    expect(s('calls.updatesMaxSeconds', 120)).toBe(true)
    expect(s('calls.updatesMaxSeconds', 121)).toBe(false)
    expect(s('calls.updatesPauseMaxMinutes', 0)).toBe(false)
    expect(s('calls.updatesPauseMaxMinutes', 15)).toBe(true)
    expect(s('calls.updatesPauseMaxMinutes', 16)).toBe(false)
  })

  it('the voice must be a known base voice', () => {
    const v = SETTINGS['calls.updatesVoice'].schema
    for (const name of UPDATES_VOICES) expect(v.safeParse(name).success).toBe(true)
    expect(v.safeParse('darth').success).toBe(false)
    expect(UPDATES_VOICES.length).toBeGreaterThanOrEqual(3)
  })

  it('sections: only known keys, no repeats', () => {
    const v = SETTINGS['calls.updatesSections'].schema
    expect(v.safeParse('events\nlast-call').success).toBe(true)
    expect(v.safeParse('events\nevents').success).toBe(false)
    expect(v.safeParse('bogus').success).toBe(false)
  })

  it('intro and outro cannot contain a voice command phrase', () => {
    for (const k of ['calls.updatesIntro', 'calls.updatesOutro'] as const) {
      expect(SETTINGS[k].schema.safeParse("That's the update.").success).toBe(true)
      expect(SETTINGS[k].schema.safeParse('Say Metalhead, stop to end').success).toBe(false)
      expect(SETTINGS[k].schema.safeParse('Metalhead pause').success).toBe(false)
    }
    expect(COMMAND_PHRASE.test('Metalhead, stop')).toBe(true)
    expect(COMMAND_PHRASE.test('Updates by Metalhead are done')).toBe(false)
  })
})
