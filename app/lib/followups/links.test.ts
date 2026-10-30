import { describe, expect, it } from 'vitest'
import { telegramUrlKeyboard } from './buttons'
import { signLink, verifyLink } from './links'

const ENV = { FOLLOWUP_LINK_SECRET: 'a'.repeat(32), NEXT_PUBLIC_APP_URL: 'https://app.example.test' }
const now = new Date('2026-11-10T12:00:00Z')
const ID = 'c'.repeat(25)

describe('follow-up action links', () => {
  it('round-trips the follow-up and the action', () => {
    const t = signLink(ID, 'snooze', 30, now, ENV)!
    const v = verifyLink(t, now, ENV)
    expect(v).toEqual({ ok: true, claims: { f: ID, a: 'snooze', e: Math.floor(now.getTime() / 1000) + 30 * 86400, v: 1 } })
  })
  it('carries no names or text, only the id, action and expiry', () => {
    const t = signLink(ID, 'done', 30, now, ENV)!
    const body = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString())
    expect(Object.keys(body).sort()).toEqual(['a', 'e', 'f', 'v'])
  })
  it('rejects a tampered body, a tampered signature and a wrong secret', () => {
    const t = signLink(ID, 'done', 30, now, ENV)!
    const [body, mac] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ f: ID, a: 'stop', e: 9999999999, v: 1 })).toString('base64url')
    expect(verifyLink(`${forged}.${mac}`, now, ENV)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyLink(`${body}.${mac.slice(0, -2)}AA`, now, ENV)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyLink(t, now, { ...ENV, FOLLOWUP_LINK_SECRET: 'b'.repeat(32) })).toEqual({ ok: false, reason: 'invalid' })
  })
  it('a preview-signed token never validates with the production secret (and vice versa)', () => {
    const preview = signLink(ID, 'done', 30, now, { FOLLOWUP_LINK_SECRET: 'preview-secret-0123456789abcdef' })!
    expect(verifyLink(preview, now, ENV).ok).toBe(false)
  })
  it('expires after the lifetime', () => {
    const t = signLink(ID, 'done', 7, now, ENV)!
    expect(verifyLink(t, new Date(now.getTime() + 6 * 86400_000), ENV).ok).toBe(true)
    expect(verifyLink(t, new Date(now.getTime() + 8 * 86400_000), ENV)).toEqual({ ok: false, reason: 'expired' })
  })
  it('garbage and an unset secret are invalid', () => {
    for (const bad of ['', 'x', 'a.b.c', '.', 'a'.repeat(500)]) expect(verifyLink(bad, now, ENV).ok).toBe(false)
    expect(signLink(ID, 'done', 30, now, {})).toBeNull()
    expect(verifyLink('a.b', now, {}).ok).toBe(false)
  })
})

describe('telegramUrlKeyboard', () => {
  it('is 3 rows of 2 URL buttons within Telegram and proxy limits', () => {
    const prev = process.env.FOLLOWUP_LINK_SECRET
    process.env.FOLLOWUP_LINK_SECRET = ENV.FOLLOWUP_LINK_SECRET
    try {
      for (const loc of ['en', 'es', 'fr']) {
        const kb = telegramUrlKeyboard(ID, loc, 30, now)!
        expect(kb.map((r) => r.length)).toEqual([2, 2, 2])
        for (const b of kb.flat()) {
          expect(b.text.length).toBeLessThanOrEqual(40)
          expect(b.url).toMatch(/^https:\/\/[^/]+\/fu\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
        }
        expect(new Set(kb.flat().map((b) => b.url)).size).toBe(6)
      }
    } finally {
      if (prev === undefined) delete process.env.FOLLOWUP_LINK_SECRET
      else process.env.FOLLOWUP_LINK_SECRET = prev
    }
  })
  it('is null without a link secret', () => {
    const prev = process.env.FOLLOWUP_LINK_SECRET
    delete process.env.FOLLOWUP_LINK_SECRET
    try {
      expect(telegramUrlKeyboard(ID, 'en', 30, now)).toBeNull()
    } finally {
      if (prev !== undefined) process.env.FOLLOWUP_LINK_SECRET = prev
    }
  })
})
