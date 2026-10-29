// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { SETTINGS, SETTING_KEYS, isSettingKey, parseSetting } from './registry'
import { CALL_TRANSCRIPT_MIN_LEVEL } from '@/app/lib/calls/transcript-access'
import { HUMAN_RELEASE_MIN_LEVEL, NEW_ACCOUNT_DAYS } from '@/app/lib/mission-verify/policy'
import { DPR_ONLY_MIN_LEVEL } from '@/app/lib/mission-review-access'
import { DISAVOW_MIN_LEVEL } from '@/app/lib/disavow/constants'
import { SLA_HOURS, DIGEST_MAX_LINES } from '@/app/lib/mission-verify/sla'
import { MAX_MISSION_ATTEMPTS } from '@/app/lib/missions'

describe('settings registry', () => {
  it('has unique, well-formed keys and no secret-like names', () => {
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length)
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/)
      expect(key).not.toMatch(/secret|token|key|password/i)
      expect(SETTINGS[key].key).toBe(key)
    }
  })

  it('every default passes its own schema and failure values are integers', () => {
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key]
      expect(parseSetting(key, def.default).ok).toBe(true)
      // A failure value may sit outside the editable bounds on purpose (the strictest value, e.g. level 1).
      if (def.input.type === 'int') {
        if (typeof def.onReadFailure === 'object') expect(Number.isInteger(def.onReadFailure.value)).toBe(true)
        expect(def.input.min).toBeLessThanOrEqual(def.default as number)
        expect(def.input.max).toBeGreaterThanOrEqual(def.default as number)
      } else {
        expect(typeof def.default).toBe('string')
      }
    }
  })

  it('locks every default to the constant it replaced (deploying changes no behaviour)', () => {
    expect(SETTINGS['calls.transcriptMinLevel'].default).toBe(CALL_TRANSCRIPT_MIN_LEVEL)
    expect(SETTINGS['missions.humanReleaseMinLevel'].default).toBe(HUMAN_RELEASE_MIN_LEVEL)
    expect(SETTINGS['missions.newAccountDays'].default).toBe(NEW_ACCOUNT_DAYS)
    expect(SETTINGS['missions.dprOnlyMinLevel'].default).toBe(DPR_ONLY_MIN_LEVEL)
    expect(SETTINGS['disavow.minLevel'].default).toBe(DISAVOW_MIN_LEVEL)
    expect(SETTINGS['missions.slaHours'].default).toBe(SLA_HOURS)
    expect(SETTINGS['missions.slaDigestMaxLines'].default).toBe(DIGEST_MAX_LINES)
    expect(SETTINGS['missions.maxAttempts'].default).toBe(MAX_MISSION_ATTEMPTS)
    // And the literal values today (a change here is a deliberate, reviewed change).
    expect(SETTING_KEYS.filter((k) => !k.startsWith('guide.')).map((k) => [k, SETTINGS[k].default])).toEqual([
      ['calls.transcriptMinLevel', 6],
      ['missions.humanReleaseMinLevel', 6],
      ['missions.newAccountDays', 30],
      ['missions.dprOnlyMinLevel', 8],
      ['missions.slaHours', 48],
      ['missions.slaDigestMaxLines', 15],
      ['missions.maxAttempts', 3],
      ['disavow.minLevel', 5],
      ['passport.enabled', 0],
      ['passport.checkInRadiusM', 150],
      ['passport.maxAccuracyM', 150],
      ['passport.maxNewStampsPerDay', 5],
      ['passport.revisitCooldownHours', 20],
      ['passport.publicDelayHours', 6],
      ['passport.maxTravelKmPerHour', 900],
    ])
  })

  it('enforces bounds, integers and types', () => {
    expect(parseSetting('calls.transcriptMinLevel', 0).ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', 10).ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', 9).ok).toBe(true)
    expect(parseSetting('calls.transcriptMinLevel', 1).ok).toBe(true)
    expect(parseSetting('calls.transcriptMinLevel', 5.5).ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', '6').ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', null).ok).toBe(false)
    expect(parseSetting('missions.slaHours', 337).ok).toBe(false)
    expect(parseSetting('missions.slaDigestMaxLines', 26).ok).toBe(false)
    expect(parseSetting('missions.maxAttempts', 11).ok).toBe(false)
    expect(parseSetting('missions.maxAttempts', 0).ok).toBe(false)
  })

  it('approval-authority settings can only be made stricter', () => {
    // Lowering is allowed, loosening is rejected by the bounds.
    expect(parseSetting('missions.dprOnlyMinLevel', 7).ok).toBe(true)
    expect(parseSetting('missions.dprOnlyMinLevel', 8).ok).toBe(true)
    expect(parseSetting('missions.dprOnlyMinLevel', 9).ok).toBe(false)
    expect(parseSetting('missions.dprOnlyMinLevel', 1).ok).toBe(false)
    expect(parseSetting('missions.humanReleaseMinLevel', 5).ok).toBe(true)
    expect(parseSetting('missions.humanReleaseMinLevel', 7).ok).toBe(false)
    expect(parseSetting('missions.newAccountDays', 60).ok).toBe(true)
    expect(parseSetting('missions.newAccountDays', 29).ok).toBe(false)
    for (const k of ['missions.dprOnlyMinLevel', 'missions.humanReleaseMinLevel', 'missions.newAccountDays'] as const) {
      expect(SETTINGS[k].stricterOnly).toBe(true)
    }
  })

  it('money-hold and approval settings fail to their strictest value', () => {
    expect(SETTINGS['missions.humanReleaseMinLevel'].onReadFailure).toEqual({ value: 1 })
    expect(SETTINGS['missions.newAccountDays'].onReadFailure).toEqual({ value: 365 })
    expect(SETTINGS['missions.dprOnlyMinLevel'].onReadFailure).toEqual({ value: 1 })
  })

  it('asks for confirmation when a content-access threshold is lowered', () => {
    const c = SETTINGS['calls.transcriptMinLevel'].confirm!
    expect(c(6, 4)).toMatch(/transcripts/i)
    expect(c(6, 8)).toBeNull()
    expect(SETTINGS['disavow.minLevel'].confirm!(5, 3)).not.toBeNull()
    expect(SETTINGS['disavow.minLevel'].confirm!(5, 7)).toBeNull()
  })

  it('guide settings ship unset so unconfirmed handbook facts stay hidden', () => {
    const guide = SETTING_KEYS.filter((k) => k.startsWith('guide.'))
    expect(guide.length).toBeGreaterThan(0)
    for (const k of guide) {
      expect(SETTINGS[k].area).toBe('guide')
      expect([0, '']).toContain(SETTINGS[k].default)
      expect(SETTINGS[k].private).toBeFalsy()
    }
  })

  it('url settings accept https only (or empty)', () => {
    const k = 'guide.budgetTemplateUrl'
    expect(parseSetting(k, '').ok).toBe(true)
    expect(parseSetting(k, 'https://example.org/a?b=1').ok).toBe(true)
    expect(parseSetting(k, 'http://example.org').ok).toBe(false)
    expect(parseSetting(k, 'javascript:alert(1)').ok).toBe(false)
    expect(parseSetting(k, 'data:text/html,hi').ok).toBe(false)
    expect(parseSetting(k, 'https://user:pw@example.org').ok).toBe(false)
    expect(parseSetting(k, 'not a url').ok).toBe(false)
    expect(parseSetting(k, 'https://example.org/' + 'a'.repeat(300)).ok).toBe(false)
    expect(parseSetting(k, 5).ok).toBe(false)
  })

  it('date settings accept real ISO dates (or empty) only', () => {
    const k = 'guide.gppDate'
    expect(parseSetting(k, '').ok).toBe(true)
    expect(parseSetting(k, '2027-05-22').ok).toBe(true)
    expect(parseSetting(k, '2027-02-30').ok).toBe(false)
    expect(parseSetting(k, '22/05/2027').ok).toBe(false)
    expect(parseSetting(k, '2027-5-22').ok).toBe(false)
    expect(parseSetting(k, 20270522).ok).toBe(false)
  })

  it('text settings are trimmed and length-bounded', () => {
    expect(parseSetting('guide.hashtags', '  #one #two ')).toEqual({ ok: true, value: '#one #two' })
    expect(parseSetting('guide.hashtags', 'x'.repeat(201)).ok).toBe(false)
    expect(parseSetting('guide.hostDeadlines', 'x'.repeat(1000)).ok).toBe(true)
    expect(parseSetting('guide.hostDeadlines', 'x'.repeat(1001)).ok).toBe(false)
  })

  it('isSettingKey rejects unknown and prototype keys', () => {
    expect(isSettingKey('calls.transcriptMinLevel')).toBe(true)
    expect(isSettingKey('nope')).toBe(false)
    expect(isSettingKey('constructor')).toBe(false)
    expect(isSettingKey('__proto__')).toBe(false)
  })
})
