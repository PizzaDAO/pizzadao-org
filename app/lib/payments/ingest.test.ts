// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { hashPayee, maskPayee, normalizePayee } from './hash'
import { mapHeaders, parseAmount, parseRow, runIngest, serialToDate, type Cell, type IngestDeps, type NewPaymentRequest } from './ingest'

const ENV = { PAYMENTS_HASH_SECRET: 'test-secret-value' } as unknown as NodeJS.ProcessEnv
const HEADERS = ['Timestamp', 'Email Address', 'Your name', 'Discord ID', 'Amount (USD)', 'What was the work?', 'Wallet address for payment', 'Proposal link']
const WALLET = '0x1234567890abcdef1234567890abcdef12345678'
/** Sheet serial for 2026-10-29 13:05:22 UTC and a day later. */
const SERIAL = 46324.5454
const row = (over: Partial<Record<number, Cell>> = {}): Cell[] => {
  const base: Cell[] = [SERIAL, 'someone@example.com', 'Test Person', '123456789012345678', '$250.00', 'Designed flyers for the event', WALLET, '']
  return base.map((v, i) => (i in over ? (over[i] as Cell) : v))
}

describe('payee hashing', () => {
  it('normalizes then HMACs; the same payee gives the same hash, a different one does not', () => {
    expect(hashPayee(WALLET, ENV)).toBe(hashPayee(` ${WALLET.toUpperCase()} `, ENV))
    expect(hashPayee(WALLET, ENV)).not.toBe(hashPayee('0x0000000000000000000000000000000000000001', ENV))
    expect(hashPayee(WALLET, ENV)).toMatch(/^[0-9a-f]{64}$/)
    expect(normalizePayee('Bank: 12-34 56')).toBe('123456')
  })
  it('depends on the secret and stores nothing when no secret is set', () => {
    expect(hashPayee(WALLET, ENV)).not.toBe(hashPayee(WALLET, { PAYMENTS_HASH_SECRET: 'other' } as never))
    expect(hashPayee(WALLET, {} as never)).toBeNull()
  })
  it('masks to a hint that does not contain the value', () => {
    expect(maskPayee(WALLET)).toBe('0x12...78')
    expect(maskPayee('GB82 WEST 1234 5698 7654 32')).toBe('...32')
    expect(maskPayee('ab')).toBeNull()
  })
})

describe('headers', () => {
  it('maps columns by header and ignores the email column', () => {
    const { map, missing, ambiguous } = mapHeaders(HEADERS)
    expect(missing).toEqual([])
    expect(ambiguous).toEqual([])
    expect(map).toMatchObject({ timestamp: 0, name: 2, discordId: 3, amount: 4, description: 5, payee: 6 })
    expect(Object.values(map)).not.toContain(1)
  })
  it('reports missing required headers', () => {
    expect(mapHeaders(['Timestamp', 'Your name', 'Notes']).missing).toEqual(['amount', 'description'])
  })
  it('a required header that two columns could be is ambiguous, not guessed', () => {
    expect(mapHeaders(['Timestamp', 'Amount', 'Amount in USD', 'What was the work?']).ambiguous).toEqual(['amount'])
    expect(mapHeaders(['Timestamp', 'Submitted', 'Amount', 'What was the work?']).ambiguous).toEqual(['timestamp'])
    // An optional column with two candidates is not a reason to stop.
    expect(mapHeaders(['Timestamp', 'City', 'Home city', 'Amount', 'What was the work?']).ambiguous).toEqual([])
  })
})

describe('parseAmount', () => {
  it('parses amounts and currencies', () => {
    expect(parseAmount('$1,234.50')).toEqual({ value: 1234.5, currency: 'USD' })
    expect(parseAmount('625 USDC')).toEqual({ value: 625, currency: 'USD' })
    expect(parseAmount('€40')).toEqual({ value: 40, currency: 'EUR' })
    expect(parseAmount('EUR 40')).toEqual({ value: 40, currency: 'EUR' })
    expect(parseAmount('12,5')).toEqual({ value: 12.5, currency: 'USD' })
    expect(parseAmount('1.234,50')).toEqual({ value: 1234.5, currency: 'USD' })
    expect(parseAmount(250)).toEqual({ value: 250, currency: 'USD' })
    expect(parseAmount('free')).toBeNull()
    expect(parseAmount('0')).toBeNull()
  })
  it('refuses an ambiguous "1.234" instead of guessing thousands or decimals', () => {
    expect(parseAmount('1.234')).toBeNull()
    expect(parseAmount('12.345')).toBeNull()
    expect(parseAmount('1.23')).toEqual({ value: 1.23, currency: 'USD' })
    expect(parseAmount('1,234')).toEqual({ value: 1234, currency: 'USD' })
  })
  it('reads a currency only from a known code list; other words are ignored', () => {
    expect(parseAmount('about 80 for flyers')).toEqual({ value: 80, currency: 'USD' })
    expect(parseAmount('80 mxn')).toEqual({ value: 80, currency: 'MXN' })
    expect(parseAmount('0.02 eth')).toEqual({ value: 0.02, currency: 'ETH' })
    expect(parseAmount('100 abcd')).toEqual({ value: 100, currency: 'USD' })
  })
})

describe('parseRow', () => {
  const { map } = mapHeaders(HEADERS)
  it('never keeps the raw payee anywhere in the result', () => {
    const r = parseRow(row(), map, 'sheet123', ENV)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const text = JSON.stringify(r.value)
    expect(text).not.toContain(WALLET)
    expect(text).not.toContain(WALLET.slice(2, 30))
    expect(text).not.toContain('someone@example.com')
    expect(r.value.payeeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.value.payeeHint).toBe('0x12...78')
    expect(r.value.amountUsdCents).toBe(25000)
    expect(r.value.sourceRef).toMatch(/^form:[0-9a-f]{48}$/)
  })

  it('the Discord id on a form is a claim: no verified requester', () => {
    const r = parseRow(row(), map, 's', ENV)
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.requesterDiscordId).toBeNull()
    expect(r.value.claimedDiscordId).toBe('123456789012345678')
    expect(r.value.source).toBe('FORM')
  })

  it('the reference comes from the raw timestamp, so display formats cannot change it', () => {
    const a = parseRow(row(), map, 's', ENV)
    const b = parseRow(row({ 5: 'Designed flyers for the event' }), map, 's', ENV)
    const c = parseRow(row({ 0: SERIAL + 1 }), map, 's', ENV)
    const d = parseRow(row(), map, 'other-sheet', ENV)
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error('expected ok')
    expect(a.value.sourceRef).toBe(b.value.sourceRef)
    expect(a.value.sourceRef).not.toBe(c.value.sourceRef)
    expect(a.value.sourceRef).not.toBe(d.value.sourceRef)
    expect(a.submittedAt.toISOString()).toBe(serialToDate(SERIAL).toISOString())
  })

  it('a non-dollar amount gets NO dollar value (it blocks approval until a reviewer enters one)', () => {
    const r = parseRow(row({ 4: '€40' }), map, 's', ENV)
    if (!r.ok) throw new Error('expected ok')
    expect(r.value).toMatchObject({ currency: 'EUR', amountOriginal: 40, amountUsdCents: 0 })
    const unknown = parseRow(row({ 4: '40' }), mapHeaders([...HEADERS, 'Currency']).map, 's', ENV)
    expect(unknown.ok).toBe(true)
    const odd = parseRow([...row(), 'ZZZ'], mapHeaders([...HEADERS, 'Currency']).map, 's', ENV)
    expect(odd).toEqual({ ok: false, reason: 'no_amount' })
    const eur = parseRow([...row(), 'eur'], mapHeaders([...HEADERS, 'Currency']).map, 's', ENV)
    expect(eur.ok && eur.value.amountUsdCents).toBe(0)
  })

  it('rejects rows without an amount, description or timestamp', () => {
    expect(parseRow(row({ 4: 'n/a' }), map, 's', ENV)).toEqual({ ok: false, reason: 'no_amount' })
    expect(parseRow(row({ 4: '1.234' }), map, 's', ENV)).toEqual({ ok: false, reason: 'no_amount' })
    expect(parseRow(row({ 5: '' }), map, 's', ENV)).toEqual({ ok: false, reason: 'no_description' })
    expect(parseRow(row({ 0: '' }), map, 's', ENV)).toEqual({ ok: false, reason: 'no_timestamp' })
    expect(parseRow(row({ 0: 'not a date' }), map, 's', ENV)).toEqual({ ok: false, reason: 'no_timestamp' })
  })

  it('only accepts https proposal links', () => {
    const ok = parseRow(row({ 7: 'https://example.com/poll' }), map, 's', ENV)
    const http = parseRow(row({ 7: 'http://example.com/poll' }), map, 's', ENV)
    const bad = parseRow(row({ 7: 'javascript:alert(1)' }), map, 's', ENV)
    expect(ok.ok && ok.value.proposalUrl).toBe('https://example.com/poll')
    expect(http.ok && http.value.proposalUrl).toBeNull()
    expect(bad.ok && bad.value.proposalUrl).toBeNull()
  })
})

const NOW = new Date('2026-10-30T00:00:00Z') // a day after SERIAL

function deps(values: Cell[][], over: Partial<IngestDeps> = {}, truncated = false) {
  const store = new Map<string, NewPaymentRequest>()
  const saveStatus = vi.fn(async () => undefined)
  let from: Date | null = new Date('2026-10-01T00:00:00Z')
  const setIngestFrom = vi.fn(async (d: Date) => {
    from = d
  })
  const d: IngestDeps = {
    getSheetId: async () => 'sheet123',
    readValues: async () => ({ values, truncated }),
    getIngestFrom: async () => from,
    setIngestFrom,
    findExistingRefs: async (refs) => new Set(refs.filter((r) => store.has(r))),
    create: async (data) => {
      store.set(data.sourceRef as string, data)
    },
    saveStatus,
    now: () => NOW,
    env: ENV,
    ...over,
  }
  return { d, store, saveStatus, setIngestFrom, setFrom: (x: Date | null) => (from = x) }
}

describe('runIngest', () => {
  it('does nothing when no sheet id is set', async () => {
    const { d, store } = deps([HEADERS, row()], { getSheetId: async () => '' })
    const readValues = vi.fn(d.readValues)
    expect(await runIngest({ ...d, readValues })).toMatchObject({ skipped: 'no_sheet', created: 0 })
    expect(readValues).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  it('fails closed when a required header is missing or ambiguous: nothing ingested, the reason is recorded', async () => {
    const miss = deps([['Timestamp', 'Your name', 'Notes'], [SERIAL, 'y', 'z']])
    const r = await runIngest(miss.d)
    expect(r.error).toMatch(/missing header for amount, description/)
    expect(miss.store.size).toBe(0)
    expect(miss.saveStatus).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))

    const amb = deps([['Timestamp', 'Amount', 'Amount in USD', 'What was the work?'], [SERIAL, '10', '10', 'x']])
    const r2 = await runIngest(amb.d)
    expect(r2.error).toMatch(/more than one column could be amount/)
    expect(amb.store.size).toBe(0)
  })

  it('is idempotent: a second run creates nothing', async () => {
    const values = [HEADERS, row(), row({ 0: SERIAL + 0.1, 4: '75' })]
    const { d, store } = deps(values)
    expect((await runIngest(d)).created).toBe(2)
    expect((await runIngest(d)).created).toBe(0)
    expect(store.size).toBe(2)
  })

  it('stores the hash and hint, never the raw payee; form rows have no verified requester and no member id from a claim', async () => {
    const { d, store } = deps([HEADERS, row()])
    await runIngest(d)
    const saved = [...store.values()][0]
    expect(JSON.stringify(saved)).not.toContain(WALLET)
    expect(saved).toMatchObject({ source: 'FORM', requesterDiscordId: null, claimedDiscordId: '123456789012345678', requesterMemberId: null })
  })

  it('ignores responses from before the "ingest from" moment', async () => {
    const t = deps([HEADERS, row(), row({ 0: SERIAL - 100 })])
    const r = await runIngest(t.d)
    expect(r).toMatchObject({ created: 1, old: 1 })
  })

  it('the first run with no "ingest from" sets it to now and imports no history', async () => {
    const t = deps([HEADERS, row(), row({ 0: SERIAL - 100 })])
    t.setFrom(null)
    const r = await runIngest(t.d)
    expect(t.setIngestFrom).toHaveBeenCalledWith(NOW)
    expect(r).toMatchObject({ created: 0, old: 2 })
  })

  it('counts invalid rows, skips blank ones and survives a read failure', async () => {
    const { d } = deps([HEADERS, row({ 4: 'n/a' }), ['', '', '', '', '', '', '', ''], row()])
    expect(await runIngest(d)).toMatchObject({ created: 1, invalid: 1 })
    const failing = deps([], { readValues: async () => { throw new Error('boom') } })
    expect((await runIngest(failing.d)).error).toBe('read_failed')
  })

  it('treats a unique-constraint race as already ingested', async () => {
    const { d } = deps([HEADERS, row()], { create: async () => { throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }) } })
    const r = await runIngest(d)
    expect(r.error).toBeUndefined()
    expect(r.created).toBe(0)
  })

  it('never creates more than the per-run cap (25 by default)', async () => {
    const many = [HEADERS, ...Array.from({ length: 40 }, (_, i) => row({ 0: SERIAL + i / 1000 }))]
    expect((await runIngest(deps(many).d)).created).toBe(25)
    const five = [HEADERS, ...Array.from({ length: 5 }, (_, i) => row({ 0: SERIAL + i / 1000 }))]
    expect((await runIngest(deps(five, { maxNew: 3 }).d)).created).toBe(3)
  })

  it('warns when only the newest rows of a long sheet were read', async () => {
    const t = deps([HEADERS, row()], {}, true)
    const r = await runIngest(t.d)
    expect(r.truncated).toBe(true)
    expect(t.saveStatus).toHaveBeenCalledWith(expect.objectContaining({ ok: true, warning: expect.stringMatching(/newest rows/) }))
    const full = deps([HEADERS, row()])
    await runIngest(full.d)
    expect(full.saveStatus).toHaveBeenCalledWith(expect.objectContaining({ warning: undefined }))
  })
})
