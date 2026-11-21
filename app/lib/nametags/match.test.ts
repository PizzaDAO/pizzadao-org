import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
import { matchIdentifiers } from './match'
import { hashEmail } from '@/app/lib/events-attended/rsv'

function fakeDb(opts: { linked?: { memberId: string; rsvLinkedEmailHash: string }[]; verified?: { memberId: string; hash: string }[]; wallets?: { memberId: string; wallet: string }[] }) {
  const sql: string[] = []
  const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join('?')
    sql.push(q)
    return q.includes('MemberWallet') ? (opts.wallets ?? []) : (opts.verified ?? [])
  })
  const findMany = vi.fn(async () => opts.linked ?? [])
  return { db: { $queryRaw: queryRaw, memberProfileExtras: { findMany } } as never, sql, queryRaw, findMany }
}

const H = hashEmail('  Guest@Example.com ')

describe('matchIdentifiers', () => {
  it('hash parity: lower-cased, trimmed sha256 hex', () => {
    expect(H).toBe(createHash('sha256').update('guest@example.com').digest('hex'))
  })
  it('matches rsv.pizza-linked and verified-email hashes', async () => {
    const { db } = fakeDb({ linked: [{ memberId: '1', rsvLinkedEmailHash: H.toUpperCase() }], verified: [{ memberId: '2', hash: H }] })
    const r = await matchIdentifiers({ emailHashes: [H], wallets: [] }, { matchWallets: true }, db)
    expect(r).toEqual([
      { memberId: '1', emailHash: H },
      { memberId: '2', emailHash: H },
    ])
  })
  it('the verified-email query only ever reads verified rows', async () => {
    const { db, sql } = fakeDb({})
    await matchIdentifiers({ emailHashes: [H], wallets: [] }, { matchWallets: true }, db)
    expect(sql[0]).toContain('"emailVerifiedAt" is not null')
  })
  it('SQL trimming strips the same whitespace as JS trim (tab, NBSP, BOM, unicode spaces)', async () => {
    const { db, sql } = fakeDb({})
    await matchIdentifiers({ emailHashes: [H], wallets: [] }, { matchWallets: true }, db)
    const m = sql[0].match(/regexp_replace\("email", '([^']+)'/)
    expect(m).not.toBeNull()
    // Postgres ARE and JS regex share this syntax for the class: apply the SQL pattern in JS.
    const re = new RegExp(m![1].replace(/\\u([0-9a-f]{4})/gi, '\\u$1'), 'g')
    for (const raw of ['\tGuest@Example.com \n', '\u00a0guest@example.com\u00a0', '\ufeffguest@example.com', '\u2003guest@example.com\u3000', ' guest@example.com ']) {
      expect(raw.replace(re, '')).toBe(raw.trim())
    }
  })
  it('wallets are ignored (no query) unless the setting allows', async () => {
    const w = '0x' + 'AB'.repeat(20)
    const off = fakeDb({ wallets: [{ memberId: '3', wallet: w.toLowerCase() }] })
    expect(await matchIdentifiers({ emailHashes: [], wallets: [w] }, { matchWallets: false }, off.db)).toEqual([])
    expect(off.queryRaw).not.toHaveBeenCalled()
    const on = fakeDb({ wallets: [{ memberId: '3', wallet: w.toLowerCase() }] })
    expect(await matchIdentifiers({ emailHashes: [], wallets: [w] }, { matchWallets: true }, on.db)).toEqual([{ memberId: '3', wallet: w.toLowerCase() }])
    expect(on.sql[0]).toContain("'evm'")
  })
  it('does not query email tables with no hashes, and drops duplicate matches', async () => {
    const none = fakeDb({})
    await matchIdentifiers({ emailHashes: [], wallets: [] }, { matchWallets: true }, none.db)
    expect(none.findMany).not.toHaveBeenCalled()
    const dup = fakeDb({ linked: [{ memberId: '1', rsvLinkedEmailHash: H }], verified: [{ memberId: '1', hash: H }] })
    expect(await matchIdentifiers({ emailHashes: [H], wallets: [] }, { matchWallets: true }, dup.db)).toHaveLength(1)
  })
})
