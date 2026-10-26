// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildIdentifiers, normalizeDiscordId, normalizeName, normalizeTelegram, normalizeWallet, normalizeXHandle,
} from './identity'

describe('identity normalizers', () => {
  it('Discord mentions and ids become digits', () => {
    expect(normalizeDiscordId('<@123456789012345678>')).toBe('123456789012345678')
    expect(normalizeDiscordId('<@!123456789012345678>')).toBe('123456789012345678')
    expect(normalizeDiscordId('abc')).toBeNull()
  })
  it('X handles and URLs', () => {
    expect(normalizeXHandle('@PizzaDAO')).toBe('pizzadao')
    expect(normalizeXHandle('https://x.com/PizzaDAO?s=20')).toBe('pizzadao')
    expect(normalizeXHandle('twitter.com/PizzaDAO/status/1')).toBe('pizzadao')
    expect(normalizeXHandle('not a handle!')).toBeNull()
  })
  it('EVM wallets lowercase (checksum case dropped), Solana keeps case', () => {
    expect(normalizeWallet('0xAbCdEf0123456789aBcDeF0123456789abcdef01')).toBe('0xabcdef0123456789abcdef0123456789abcdef01')
    const sol = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'
    expect(normalizeWallet(sol)).toBe(sol)
    expect(normalizeWallet('0x123')).toBeNull()
  })
  it('Telegram strips @ and t.me', () => {
    expect(normalizeTelegram('@Some_User')).toBe('some_user')
    expect(normalizeTelegram('https://t.me/Some_User')).toBe('some_user')
  })
  it('names are NFKC, trimmed, lowercased', () => {
    expect(normalizeName('  Ｊohn   DOE ')).toBe('john doe')
    expect(normalizeName(' ')).toBeNull()
  })
  it('buildIdentifiers dedupes and counts invalid', () => {
    const r = buildIdentifiers([
      { kind: 'X_HANDLE', value: '@Foo' },
      { kind: 'X_HANDLE', value: 'https://x.com/foo' },
      { kind: 'DISCORD_ID', value: 'zzz' },
      { kind: 'BOGUS', value: 'x' },
    ])
    expect(r.identifiers).toEqual([{ kind: 'X_HANDLE', value: 'foo' }])
    expect(r.invalid).toBe(2)
  })
})
