import { describe, expect, it } from 'vitest'
import { AREA_LABELS, SETTINGS, SETTING_KEYS } from './registry'
import { TOGGLES, resolveToggle } from './toggles'
import type { Settings } from './index'

const none = { get: () => undefined, isSet: () => false, readFailed: false, invalidKeys: [] } as unknown as Settings

describe('reminders settings', () => {
  it('has an area label and every default is the safe one', () => {
    expect(AREA_LABELS.reminders).toBe('Reminders')
    expect(SETTING_KEYS.filter((k) => k.startsWith('reminders.')).map((k) => [k, SETTINGS[k].default])).toEqual([
      ['reminders.callsEnabled', false],
      ['reminders.callLeadMinutes', 60],
      ['reminders.maxSendsPerRun', 40],
      ['reminders.maxPerMemberPerDay', 6],
    ])
  })

  it('bounds the numbers', () => {
    expect(SETTINGS['reminders.callLeadMinutes'].schema.safeParse(9).success).toBe(false)
    expect(SETTINGS['reminders.callLeadMinutes'].schema.safeParse(1440).success).toBe(true)
    expect(SETTINGS['reminders.callLeadMinutes'].schema.safeParse(1441).success).toBe(false)
    expect(SETTINGS['reminders.maxSendsPerRun'].schema.safeParse(0).success).toBe(false)
    expect(SETTINGS['reminders.maxSendsPerRun'].schema.safeParse(200).success).toBe(true)
    expect(SETTINGS['reminders.maxPerMemberPerDay'].schema.safeParse(21).success).toBe(false)
  })

  it('the switch is off by default, uses REMINDERS_CALLS_ENABLED, and the env off always wins', () => {
    expect(TOGGLES['reminders.callsEnabled'].env).toBe('REMINDERS_CALLS_ENABLED')
    expect(TOGGLES['reminders.callsEnabled'].legacy(undefined)).toBe(false)
    expect(resolveToggle('reminders.callsEnabled', none, { VERCEL_ENV: 'production' })).toBe(false)
    const on = { get: () => true, isSet: () => true, readFailed: false, invalidKeys: [] } as unknown as Settings
    expect(resolveToggle('reminders.callsEnabled', on, { VERCEL_ENV: 'production' })).toBe(true)
    expect(resolveToggle('reminders.callsEnabled', on, { VERCEL_ENV: 'production', REMINDERS_CALLS_ENABLED: '0' })).toBe(false)
    // A saved ON never reaches a preview.
    expect(resolveToggle('reminders.callsEnabled', on, { VERCEL_ENV: 'preview' })).toBe(false)
  })
})
