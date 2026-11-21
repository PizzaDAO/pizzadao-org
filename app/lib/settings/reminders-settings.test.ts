import { describe, expect, it } from 'vitest'
import { AREA_LABELS, SETTINGS, SETTING_KEYS } from './registry'
import { TOGGLES, resolveToggle } from './toggles'
import type { Settings } from './index'

const none = { get: () => undefined, isSet: () => false, readFailed: false, invalidKeys: [] } as unknown as Settings

describe('reminders settings', () => {
  it('has an area label and every default is the safe one', () => {
    expect(AREA_LABELS.reminders).toBe('Reminders')
    expect(SETTING_KEYS.filter((k) => k.startsWith('reminders.')).map((k) => [k, SETTINGS[k].default])).toEqual([
      ['reminders.nearbyEventsEnabled', false],
      ['reminders.nearbyEventKinds', ['gpp', 'series']],
      ['reminders.callsEnabled', false],
      ['reminders.proposalsEnabled', false],
      ['reminders.proposalClosingHours', 24],
      ['reminders.callLeadMinutes', 60],
      ['reminders.maxSendsPerRun', 40],
      ['reminders.nearbyDefaultRadiusKm', 50],
      ['reminders.nearbyCityLevelSlackKm', 25],
      ['reminders.nearbyMaxPerWeek', 3],
      ['reminders.nearbyMaxPerDay', 1],
      ['reminders.nearbyMinLeadHours', 24],
      ['reminders.nearbyMaxLeadDays', 45],
      ['reminders.nearbyMaxSendsPerRun', 100],
      ['reminders.maxPerMemberPerDay', 6],
    ])
  })

  it('bounds the numbers', () => {
    expect(SETTINGS['reminders.callLeadMinutes'].schema.safeParse(4).success).toBe(false)
    expect(SETTINGS['reminders.callLeadMinutes'].schema.safeParse(1440).success).toBe(true)
    expect(SETTINGS['reminders.callLeadMinutes'].schema.safeParse(1441).success).toBe(false)
    expect(SETTINGS['reminders.proposalClosingHours'].schema.safeParse(1).success).toBe(false)
    expect(SETTINGS['reminders.proposalClosingHours'].schema.safeParse(2).success).toBe(true)
    expect(SETTINGS['reminders.proposalClosingHours'].schema.safeParse(72).success).toBe(true)
    expect(SETTINGS['reminders.proposalClosingHours'].schema.safeParse(73).success).toBe(false)
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

  it('proposal reminders: off by default, REMINDERS_PROPOSALS_ENABLED, env off wins, previews never', () => {
    expect(TOGGLES['reminders.proposalsEnabled'].env).toBe('REMINDERS_PROPOSALS_ENABLED')
    expect(TOGGLES['reminders.proposalsEnabled'].legacy(undefined)).toBe(false)
    expect(resolveToggle('reminders.proposalsEnabled', none, { VERCEL_ENV: 'production' })).toBe(false)
    const on = { get: () => true, isSet: () => true, readFailed: false, invalidKeys: [] } as unknown as Settings
    expect(resolveToggle('reminders.proposalsEnabled', on, { VERCEL_ENV: 'production' })).toBe(true)
    expect(resolveToggle('reminders.proposalsEnabled', on, { VERCEL_ENV: 'production', REMINDERS_PROPOSALS_ENABLED: 'off' })).toBe(false)
    expect(resolveToggle('reminders.proposalsEnabled', on, { VERCEL_ENV: 'preview' })).toBe(false)
  })

  it('nearby invites: switch off by default, REMINDERS_NEARBY_EVENTS_ENABLED, env off wins, previews never', () => {
    expect(TOGGLES['reminders.nearbyEventsEnabled'].env).toBe('REMINDERS_NEARBY_EVENTS_ENABLED')
    expect(resolveToggle('reminders.nearbyEventsEnabled', none, { VERCEL_ENV: 'production' })).toBe(false)
    const on = { get: () => true, isSet: () => true, readFailed: false, invalidKeys: [] } as unknown as Settings
    expect(resolveToggle('reminders.nearbyEventsEnabled', on, { VERCEL_ENV: 'production' })).toBe(true)
    expect(resolveToggle('reminders.nearbyEventsEnabled', on, { VERCEL_ENV: 'production', REMINDERS_NEARBY_EVENTS_ENABLED: 'off' })).toBe(false)
    expect(resolveToggle('reminders.nearbyEventsEnabled', on, { VERCEL_ENV: 'preview' })).toBe(false)
  })
})
