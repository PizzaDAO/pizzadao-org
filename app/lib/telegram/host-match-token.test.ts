import { describe, expect, it } from 'vitest'
import { signLink, verifyLink } from '@/app/lib/followups/links'
import { confirmUrl, signConfirmToken, telegramFingerprint, verifyConfirmToken } from './host-match-token'

const ENV = { FOLLOWUP_LINK_SECRET: 'a'.repeat(32), NEXT_PUBLIC_APP_URL: 'https://app.example.test' }
const now = new Date('2026-11-10T12:00:00Z')

describe('host match confirmation token', () => {
  it('round-trips the member and a fingerprint, with a 48 hour life', () => {
    const t = signConfirmToken('111222', '987654321', now, ENV)!
    const v = verifyConfirmToken(t, now, ENV)
    expect(v).toEqual({ ok: true, claims: { d: '111222', h: telegramFingerprint('987654321'), e: Math.floor(now.getTime() / 1000) + 48 * 3600, v: 1 } })
    expect(verifyConfirmToken(t, new Date(now.getTime() + 47 * 3600_000), ENV).ok).toBe(true)
    expect(verifyConfirmToken(t, new Date(now.getTime() + 49 * 3600_000), ENV)).toEqual({ ok: false, reason: 'expired' })
  })

  it('never carries the Telegram id', () => {
    const t = signConfirmToken('111222', '987654321', now, ENV)!
    expect(Buffer.from(t.split('.')[0], 'base64url').toString()).not.toContain('987654321')
    expect(t).not.toContain('987654321')
  })

  it('has no token without a secret, and rejects tampering and a wrong secret', () => {
    expect(signConfirmToken('1', '2', now, {})).toBeNull()
    const t = signConfirmToken('111222', '987654321', now, ENV)!
    const [body, mac] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ d: '999', h: telegramFingerprint('987654321'), e: 9999999999, v: 1 })).toString('base64url')
    expect(verifyConfirmToken(`${forged}.${mac}`, now, ENV)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyConfirmToken(`${body}.${mac.slice(0, -2)}AA`, now, ENV)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyConfirmToken(t, now, { FOLLOWUP_LINK_SECRET: 'b'.repeat(32) })).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyConfirmToken('nope', now, ENV)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is not interchangeable with a follow-up action link (domain separation)', () => {
    const fu = signLink('c'.repeat(25), 'stop', 30, now, ENV)!
    expect(verifyConfirmToken(fu, now, ENV).ok).toBe(false)
    const tc = signConfirmToken('111222', '987654321', now, ENV)!
    expect(verifyLink(tc, now, ENV).ok).toBe(false)
  })

  it('builds the confirm page url', () => {
    expect(confirmUrl('abc.def', ENV)).toBe('https://app.example.test/telegram/confirm/abc.def')
  })
})
