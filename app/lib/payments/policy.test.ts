// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { SETTINGS, SETTING_KEYS, parseSetting, type SettingKey } from '@/app/lib/settings/registry'
import { resolvePaymentPolicy } from './policy'

const PAY_KEYS = SETTING_KEYS.filter((k) => k.startsWith('payments.'))
const DEFAULT_OF = (k: SettingKey) => SETTINGS[k].default as unknown

function settings(over: Partial<Record<SettingKey, number>> = {}, opts: { readFailed?: boolean; invalidKeys?: SettingKey[] } = {}) {
  return {
    readFailed: opts.readFailed ?? false,
    invalidKeys: opts.invalidKeys ?? [],
    get: ((key: SettingKey) => (key in over ? over[key] : SETTINGS[key].default)) as never,
  }
}

describe('payments settings registry', () => {
  it('locks every default (a change here is a deliberate, reviewed change)', () => {
    expect(PAY_KEYS.map((k) => [k, DEFAULT_OF(k)])).toEqual([
      ['payments.onApprovalCapUsd', 625],
      ['payments.fastTrackMaxUsd', 625],
      ['payments.fastTrackMinPaidRequests', 2],
      ['payments.fastTrackMinAccountDays', 45],
      ['payments.fastTrackMinLevel', 4],
      ['payments.fastTrackRiskMax', 10],
      ['payments.highRiskScore', 50],
      ['payments.highRiskApprovals', 2],
      ['payments.fastTrackSlaHours', 24],
      ['payments.slaHours', 72],
      ['payments.receiptDeadlineDays', 14],
      ['payments.voteAyesLow', 15],
      ['payments.voteAyesMid', 25],
      ['payments.voteAyesHigh', 35],
      ['payments.voteMidMaxUsd', 2500],
      ['payments.fastTrackEnabled', 0],
      ['payments.formIngestEnabled', 0],
      ['payments.requestFormEnabled', 0],
      ['payments.receiptUploadEnabled', 0],
      ['payments.aiChecksEnabled', 0],
      ['payments.aiDailyCap', 50],
      ['payments.formSheetId', ''],
    ])
  })

  it('every toggle ships OFF and fails to OFF', () => {
    for (const k of PAY_KEYS.filter((k) => /Enabled$/.test(k))) {
      expect(SETTINGS[k].default).toBe(0)
      expect(SETTINGS[k].onReadFailure).toEqual({ value: 0 })
      expect(parseSetting(k, 2).ok).toBe(false)
    }
  })

  it('approval and spend limits cannot be loosened past the default', () => {
    expect(parseSetting('payments.onApprovalCapUsd', 626).ok).toBe(false)
    expect(parseSetting('payments.onApprovalCapUsd', 300).ok).toBe(true)
    expect(parseSetting('payments.fastTrackMaxUsd', 626).ok).toBe(false)
    expect(parseSetting('payments.fastTrackMinPaidRequests', 1).ok).toBe(false)
    expect(parseSetting('payments.fastTrackMinAccountDays', 44).ok).toBe(false)
    expect(parseSetting('payments.fastTrackMinLevel', 3).ok).toBe(false)
    expect(parseSetting('payments.fastTrackRiskMax', 11).ok).toBe(false)
    expect(parseSetting('payments.highRiskScore', 51).ok).toBe(false)
    expect(parseSetting('payments.highRiskApprovals', 1).ok).toBe(false)
    expect(parseSetting('payments.voteAyesLow', 14).ok).toBe(false)
    expect(parseSetting('payments.voteAyesMid', 24).ok).toBe(false)
    expect(parseSetting('payments.voteAyesHigh', 34).ok).toBe(false)
    expect(parseSetting('payments.voteMidMaxUsd', 2501).ok).toBe(false)
  })

  it('the responses sheet id is a private registry text setting, empty by default and on any read failure', () => {
    const def = SETTINGS['payments.formSheetId']
    expect(def.private).toBe(true)
    expect(def.default).toBe('')
    expect(def.onReadFailure).toEqual({ value: '' })
    expect(parseSetting('payments.formSheetId', '').ok).toBe(true)
    expect(parseSetting('payments.formSheetId', '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB').ok).toBe(true)
    expect(parseSetting('payments.formSheetId', 'https://example.com/d/abc').ok).toBe(false)
    expect(parseSetting('payments.formSheetId', 'short').ok).toBe(false)
  })

  it('failure values are the strict side', () => {
    const f = (k: SettingKey) => (SETTINGS[k].onReadFailure as { value: number }).value
    expect(f('payments.onApprovalCapUsd')).toBe(0)
    expect(f('payments.fastTrackMaxUsd')).toBe(0)
    expect(f('payments.fastTrackMinPaidRequests')).toBe(20)
    expect(f('payments.highRiskScore')).toBe(10)
    expect(f('payments.highRiskApprovals')).toBe(3)
    expect(f('payments.aiDailyCap')).toBe(0)
    // Unreadable second-tier limit: the highest vote tier applies to everything above the cap.
    expect(f('payments.voteMidMaxUsd')).toBe(625)
  })
})

describe('resolvePaymentPolicy', () => {
  it('uses the defaults with every toggle off', () => {
    const p = resolvePaymentPolicy(settings())
    expect(p.degraded).toBe(false)
    expect(p.onApprovalCapUsd).toBe(625)
    expect(p.fastTrackEnabled).toBe(false)
    expect(p.formIngestEnabled).toBe(false)
    expect(p.aiChecksEnabled).toBe(false)
  })

  it('clamps the fast-track maximum to the on-approval cap', () => {
    const p = resolvePaymentPolicy(settings({ 'payments.onApprovalCapUsd': 200, 'payments.fastTrackMaxUsd': 600 }))
    expect(p.fastTrackMaxUsd).toBe(200)
  })

  it('an unreadable settings store disables every toggle and the fast lane', () => {
    const p = resolvePaymentPolicy(settings({ 'payments.fastTrackEnabled': 1, 'payments.aiChecksEnabled': 1, 'payments.aiDailyCap': 50 }, { readFailed: true }))
    expect(p.degraded).toBe(true)
    expect(p.fastTrackEnabled).toBe(false)
    expect(p.aiChecksEnabled).toBe(false)
    expect(p.aiDailyCap).toBe(0)
  })

  it('one invalid payments value degrades the policy; an invalid unrelated key does not', () => {
    expect(resolvePaymentPolicy(settings({ 'payments.fastTrackEnabled': 1 }, { invalidKeys: ['payments.slaHours'] })).fastTrackEnabled).toBe(false)
    expect(resolvePaymentPolicy(settings({ 'payments.fastTrackEnabled': 1 }, { invalidKeys: ['missions.maxAttempts'] })).fastTrackEnabled).toBe(true)
  })
})
