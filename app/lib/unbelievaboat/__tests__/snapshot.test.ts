// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildManifest,
  buildSnapshot,
  normalizeAmount,
  parseCsv,
  snapshotFromCsv,
  snapshotToCsv,
  snapshotToJson,
  validateSnapshot,
  verifyManifest,
} from '../snapshot'
import { FIXTURE_GUILD, fixtureUsers } from './mock-ub'

const fixed = new Date('2026-10-01T12:00:00.000Z')
const snapshot = () => buildSnapshot({ guildId: FIXTURE_GUILD, users: fixtureUsers, pages: 4, apiBase: 'mock', exportedAt: fixed })

describe('snapshot', () => {
  it('normalizes amounts, including Infinity and huge values', () => {
    expect(normalizeAmount(54)).toBe('54')
    expect(normalizeAmount('-20')).toBe('-20')
    expect(normalizeAmount('Infinity')).toBe('Infinity')
    expect(normalizeAmount(Infinity)).toBe('Infinity')
    expect(normalizeAmount('99999999999999999999')).toBe('99999999999999999999')
    expect(normalizeAmount('12.9')).toBe('12')
    expect(normalizeAmount('abc')).toBe('NaN')
    expect(normalizeAmount(null)).toBe('0')
  })

  it('computes totals over finite rows and recomputes total = cash + bank', () => {
    const s = snapshot()
    expect(s.totals.users).toBe(8)
    expect(s.totals.cash).toBe(String(54 + 300 - 50 + 69 + 10 - 20))
    expect(s.totals.bank).toBe(String(1000 + 200 + 500))
    expect(s.users.find((u) => u.discordId === '100000000000000006')?.total).toBe('Infinity')
    expect(s.users[0].rank).toBe(1)
  })

  it('round-trips through CSV', () => {
    const s = snapshot()
    const back = snapshotFromCsv(snapshotToCsv(s), { guildId: FIXTURE_GUILD, exportedAt: s.exportedAt })
    expect(back.users.map((u) => [u.discordId, u.cash, u.bank, u.total])).toEqual(
      s.users.map((u) => [u.discordId, u.cash, u.bank, u.total]),
    )
    expect(back.totals).toEqual(s.totals)
  })

  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ])
  })

  it('manifest detects tampering and verifies the HMAC', () => {
    const s = snapshot()
    const json = snapshotToJson(s)
    const csv = snapshotToCsv(s)
    const m = buildManifest(s, json, csv, 'k3y')
    expect(verifyManifest(m, json, csv, 'k3y')).toEqual({ ok: true, errors: [], signed: true })
    expect(verifyManifest(m, json.replace('1054', '9054'), csv, 'k3y').ok).toBe(false)
    expect(verifyManifest(m, json, csv, 'other-key').errors).toContain('manifest HMAC signature is invalid')
    const unsigned = buildManifest(s, json, csv)
    expect(unsigned.hmacSha256).toBeNull()
    expect(verifyManifest(unsigned, json, csv).ok).toBe(true)
  })

  it('validateSnapshot rejects edited rows, duplicates and bad ids', () => {
    const s = JSON.parse(snapshotToJson(snapshot()))
    expect(() => validateSnapshot(s)).not.toThrow()
    const edited = JSON.parse(JSON.stringify(s))
    edited.users[1].bank = '999999'
    expect(() => validateSnapshot(edited)).toThrow(/totals/)
    const dup = JSON.parse(JSON.stringify(s))
    dup.users.push(dup.users[0])
    expect(() => validateSnapshot(dup)).toThrow(/duplicate/)
    const bad = JSON.parse(JSON.stringify(s))
    bad.users[0].discordId = 'abc'
    expect(() => validateSnapshot(bad)).toThrow(/invalid discordId/)
  })
})
