// @vitest-environment node
// The importer's pure logic, on synthetic data only (no real titles, names, ids or addresses).
import { describe, expect, it } from 'vitest'
import {
  buildImport, classifyLabel, cleanBody, deriveOutcome, eraFor, eraQuorum, parseAmount, parsePayment, parseQuorum, parseSeshResults, parseUsDate, passes, summarize,
  type EraRule, type ImportInputs,
} from './history-import'

const G = '100000000000000001'
const C = '100000000000000002'
const field = (name: string, n: number) => ({ name, value: `\`███   \` | 10% (${n})` })
const embed = (fields: Array<{ name: string; value: string }>, extra: Record<string, unknown> = {}) => ({ title: '📊  Synthetic Poll *results*', description: '**[Detailed Results](https://example.test/r/1)**\n\nBody text', fields, footer: { text: 'This poll has ended' }, ...extra })

describe('parseSeshResults', () => {
  it('reads Aye/Nay/Abstain in any order', () => {
    expect(parseSeshResults({ fields: [field('🥇 Nay', 5), field('🥈 Aye', 3), field('🥉 Abstain', 1)] })).toMatchObject({ ayes: 3, nays: 5, abstains: 1, ambiguous: false })
  })
  it('counts "needs more discussion" as an abstain, and checks "not DAO it" before "DAO it"', () => {
    const c = parseSeshResults({ fields: [field('🥇 <:0_thumbsup:816083318890168351> Let’s DAO it', 15), field('🥈 🤌 Needs more discussion', 1), field('🥉 👎 Let’s not DAO it', 2)] })
    expect(c).toMatchObject({ ayes: 15, nays: 2, abstains: 1, discuss: 1, ambiguous: false })
    expect(classifyLabel('Let’s not DAO IT')).toBe('nay')
    expect(classifyLabel('Let’s DAO IT')).toBe('aye')
  })
  it('reads Yah/Nah and LFG', () => {
    expect(parseSeshResults({ fields: [field('🥇 Yah', 4), field('🥈 Nah', 1), field('🥉 Abstain', 0)] })).toMatchObject({ ayes: 4, nays: 1 })
    expect(classifyLabel('🥇 LFG')).toBe('aye')
  })
  it('takes a single empty emoji label as the aye when no aye is present', () => {
    expect(parseSeshResults({ fields: [field('🥇', 7), field('🥈 Nay', 1), field('🥉 Abstain', 0)] })).toMatchObject({ ayes: 7, nays: 1, ambiguous: false })
  })
  it('flags several empty labels, an empty label next to an aye, and unknown labels as ambiguous', () => {
    expect(parseSeshResults({ fields: [field('🥇', 1), field('🥈', 1), field('🥉 Abstain', 0)] }).ambiguous).toBe(true)
    expect(parseSeshResults({ fields: [field('🥇 Aye', 1), field('🥈', 1)] }).ambiguous).toBe(true)
    expect(parseSeshResults({ fields: [field('🥇 Pineapple', 1)] }).ambiguous).toBe(true)
    expect(parseSeshResults({ fields: [] }).ambiguous).toBe(true)
    expect(parseSeshResults({ fields: [{ name: 'Aye', value: 'no number' }] }).ambiguous).toBe(true)
  })
})

describe('quorum, amounts, dates, body', () => {
  it('parses quorums', () => {
    expect(parseQuorum('15 Votes')).toBe(15)
    expect(parseQuorum('25 Ayes + Abstain')).toBe(25)
    expect(parseQuorum('Quorum: 20')).toBe(20)
    expect(parseQuorum('👍 Ayes + Abstains Needed: 25 for $625-2,500')).toBe(25)
    expect(parseQuorum(null)).toBeNull()
    expect(parseQuorum('none')).toBeNull()
  })
  it('parses amounts, keeping non-USD text as raw', () => {
    expect(parseAmount('$1,330')).toEqual({ usd: 1330, raw: null })
    expect(parseAmount('625 USDC')).toEqual({ usd: 625, raw: null })
    expect(parseAmount('0.5 ETH')).toEqual({ usd: null, raw: '0.5 ETH' })
    expect(parseAmount('')).toEqual({ usd: null, raw: null })
  })
  it('parses US dates and rejects impossible ones', () => {
    expect(parseUsDate('5/22/22')).toBe('2022-05-22')
    expect(parseUsDate('13/40/22')).toBeNull()
    expect(parseUsDate('10/2024')).toBeNull()
  })
  it('drops the detailed-results line from the body', () => {
    expect(cleanBody('**[Detailed Results](https://example.test/r/1)**\n\nHello')).toBe('Hello')
  })
})

const eras: EraRule[] = [
  { from: '2021-01-01', countAbstains: false, requireAyesOverNays: true, tiers: null },
  { from: '2023-09-23', countAbstains: true, requireAyesOverNays: true, tiers: [{ maxUsd: 625, ayes: 15 }, { maxUsd: 2500, ayes: 25 }, { maxUsd: null, ayes: 35 }] },
  { from: '2025-06-16', countAbstains: true, requireAyesOverNays: true, nayRaise: 0.25, tiers: [{ maxUsd: 420, ayes: 15 }, { maxUsd: null, ayes: 35 }] },
]

describe('eras and the pass rule', () => {
  it('picks the era in force and its dollar tier', () => {
    expect(eraFor('2022-01-01', eras).from).toBe('2021-01-01')
    expect(eraFor('2024-01-01', eras).from).toBe('2023-09-23')
    expect(eraQuorum('2022-01-01', 100, eras)).toBeNull()
    expect(eraQuorum('2024-01-01', 600, eras)).toBe(15)
    expect(eraQuorum('2024-01-01', 1000, eras)).toBe(25)
    expect(eraQuorum('2024-01-01', 9000, eras)).toBe(35)
    expect(eraQuorum('2024-01-01', null, eras)).toBeNull()
    expect(eraQuorum('2024-01-01', null, eras, 'GENERAL')).toBe(15)
  })
  it('applies abstains, ayes over nays, and the nay raise per era', () => {
    expect(passes({ ayes: 10, nays: 0, abstains: 5 }, 15, eras[1])).toBe(true)
    expect(passes({ ayes: 10, nays: 0, abstains: 5 }, 15, eras[0])).toBe(false)
    expect(passes({ ayes: 10, nays: 10, abstains: 10 }, 15, eras[1])).toBe(false)
    expect(passes({ ayes: 15, nays: 4, abstains: 0 }, 15, eras[2])).toBe(false) // 15 < 15 + 4/4
    expect(passes({ ayes: 16, nays: 4, abstains: 0 }, 15, eras[2])).toBe(true)
  })
})

describe('outcome precedence', () => {
  const counts = { ayes: 20, nays: 1, abstains: 0, discuss: 0, ambiguous: false }
  const base = { counts, ended: true, statedQuorum: 15, sheetStatus: null, eraQuorum: null, era: eras[1] } as const
  it('override beats everything', () => {
    expect(deriveOutcome({ ...base, override: 'FAILED', sheetStatus: 'PASSED' })).toMatchObject({ status: 'FAILED', source: 'override' })
  })
  it('counts with the stated quorum, corroborated or alone', () => {
    expect(deriveOutcome({ ...base })).toMatchObject({ status: 'PASSED', source: 'votes' })
    expect(deriveOutcome({ ...base, sheetStatus: 'PASSED' })).toMatchObject({ status: 'PASSED', source: 'votes', conflict: false })
  })
  it('a disagreement goes to the sheet and is flagged', () => {
    expect(deriveOutcome({ ...base, sheetStatus: 'FAILED' })).toMatchObject({ status: 'FAILED', source: 'sheet', conflict: true, derived: 'PASSED' })
  })
  it('falls back to the era quorum, then to unresolved; never derives from unended or ambiguous polls', () => {
    expect(deriveOutcome({ ...base, statedQuorum: null, eraQuorum: 15 })).toMatchObject({ status: 'PASSED', source: 'votes_era_quorum' })
    expect(deriveOutcome({ ...base, statedQuorum: null, eraQuorum: null })).toMatchObject({ status: 'UNRESOLVED', source: null })
    expect(deriveOutcome({ ...base, ended: false })).toMatchObject({ status: 'UNRESOLVED' })
    expect(deriveOutcome({ ...base, counts: { ...counts, ambiguous: true } })).toMatchObject({ status: 'UNRESOLVED' })
    expect(deriveOutcome({ ...base, ended: false, sheetStatus: 'PASSED' })).toMatchObject({ status: 'PASSED', source: 'sheet' })
  })
})

describe('finance lines', () => {
  const tx = `0x${'a'.repeat(64)}`
  it('parses confidence, payments and the chain', () => {
    const l = parsePayment({ title: 'T', dateProposed: '2024-01-01', discordMessage: `https://discord.com/channels/${G}/${C}/100000000000000010`, paid: true, note: 'confidence high; matched', payments: [{ date: '2024-02-01', amount: '0.5', asset: 'ETH', usd: 1905.14, 'txHash or ref': tx, source: 'ledger.csv', payee: 'Someone' }] })
    expect(l.confidence).toBe('high')
    expect(l.message).toBe('100000000000000010')
    expect(l.payments[0]).toMatchObject({ amount: '0.5', asset: 'ETH', usdCents: 190514, txHash: tx, chain: 'ethereum', chainAssumed: true })
  })
  it('treats a non-hash reference as off-chain, and a missing tag as no confidence', () => {
    const l = parsePayment({ title: 'T', note: '', payments: [{ date: '2024-02-01', amount: '100', asset: 'USD', usd: 100, 'txHash or ref': 'paypal-123' }] })
    expect(l.confidence).toBe('none')
    expect(l.payments[0]).toMatchObject({ txHash: null, chain: null, offchainRef: 'paypal-123' })
  })
  it('survives garbage', () => {
    expect(parsePayment(null).payments).toEqual([])
    expect(parsePayment({ payments: 'x' }).payments).toEqual([])
  })
})

// ---- the build, on a small synthetic world
const poll = (id: string, title: string, fields: Array<{ name: string; value: string }>, ts: string, extra: Record<string, unknown> = {}) => ({
  id, timestamp: ts, edited_timestamp: ts, mentions: [], embeds: [embed(fields, { title: `📊  ${title} *results*` })], ...extra,
})
const A = '100000000000000011'
const B = '100000000000000012'
const D = '100000000000000013'
const E1 = '100000000000000014'
const url = (id: string) => `https://discord.com/channels/${G}/${C}/${id}`
const fin = (id: string, conf: string, ref: string) => ({ title: 'x', dateProposed: '2024-03-01', discordMessage: url(id), paid: true, note: `confidence ${conf}`, payments: [{ date: '2024-03-05', amount: '100', asset: 'USDC', usd: 100, 'txHash or ref': ref }] })

function world(over: Partial<ImportInputs> = {}): ImportInputs {
  return {
    guildId: G, channelId: C, eras,
    inventory: [
      { title: 'Alpha event', dateProposed: '2024-03-01', proposer: 'Pat', kind: 'funding', amountUsd: 600, sheetStatus: 'Failed', sheetRows: [2], discordMessages: [url(A)], quorum: '15' },
      { title: 'Alpha event', dateProposed: '2024-03-10', proposer: 'Pat', kind: 'funding', amountUsd: 600, sheetStatus: null, sheetRows: [], discordMessages: [url(B)], quorum: '15' },
      { title: 'Beta', dateProposed: '2024-04-01', kind: 'funding', amountUsd: 900, sheetRows: [], discordMessages: [url(D)] },
    ],
    early: [{ title: 'Early thing', dateProposed: '2021-03-01', proposerDiscordId: '100000000000000099', discordMessages: [url(E1)] }],
    earlyMessages: [{ id: E1, content: 'early text', timestamp: '2021-03-01T00:00:00.000Z', reactions: [{ emoji: { name: '👍' }, count: 4 }, { emoji: { name: '👎' }, count: 1 }], author: { id: '100000000000000099' } }],
    raw: [
      poll(A, 'Alpha event', [field('🥇 Aye', 9), field('🥈 Nay', 0), field('🥉 Abstain', 0)], '2024-03-01T10:00:00.000Z'),
      poll(B, 'Alpha event', [field('🥇 Aye', 20), field('🥈 Nay', 0), field('🥉 Abstain', 0)], '2024-03-10T10:00:00.000Z'),
      poll(D, 'Beta', [field('🥇 Aye', 30), field('🥈 Nay', 1), field('🥉 Abstain', 0)], '2024-04-01T10:00:00.000Z'),
    ],
    sheet: [['Proposal Date', 'Event Date', 'Status', 'Member', 'Proposal', 'Location', 'Amount', 'Attendance', 'Link'], ['3/1/2024', '3/9/24', 'Failed', 'Pat', 'Alpha event', 'Town', '$600', '', url(A)]],
    finance: [], overrides: {}, members: [{ discordId: '100000000000000077', name: 'Pat' }],
    ...over,
  }
}

describe('buildImport', () => {
  it('makes one row per poll, the early post as reactions, and stable keys', () => {
    const r = buildImport(world())
    expect(r.errors).toEqual([])
    expect(r.rows.map((x) => x.importKey).sort()).toEqual([`discord:${A}`, `discord:${B}`, `discord:${D}`, `early:${E1}`].sort())
    const early = r.rows.find((x) => x.importKey === `early:${E1}`)!
    expect(early).toMatchObject({ status: 'UNRESOLVED', votesRecorded: false, ayes: 0 })
    expect(early.historical.reactions).toEqual([{ emoji: '👍', count: 4 }, { emoji: '👎', count: 1 }])
    const again = buildImport(world())
    expect(again.rows.map((x) => x.importKey)).toEqual(r.rows.map((x) => x.importKey))
    expect(JSON.stringify(again.rows)).toBe(JSON.stringify(r.rows))
  })

  it('derives outcomes: stated quorum, era quorum, and links the proposer', () => {
    const r = buildImport(world())
    const a = r.rows.find((x) => x.importKey === `discord:${A}`)!
    const d = r.rows.find((x) => x.importKey === `discord:${D}`)!
    expect(a).toMatchObject({ status: 'FAILED', outcomeSource: 'votes', proposerDiscordId: '100000000000000077', ayesNeeded: 15, kind: 'FUNDING', amountUsdCents: 60000 })
    expect(d).toMatchObject({ status: 'PASSED', outcomeSource: 'votes_era_quorum', ayesNeeded: 25, ayes: 30, nays: 1 })
    expect(r.review.noQuorum.map((x) => x.key)).toContain(`discord:${D}`)
  })

  it('reattaches a sheet row by override, keeps a reattempt as its own row, and links the earlier attempt', () => {
    const r = buildImport(world({ overrides: { [`discord:${A}`]: { sheetRows: [] }, [`discord:${B}`]: { sheetRows: [2], outcome: 'PASSED' } } }))
    expect(r.errors).toEqual([])
    const a = r.rows.find((x) => x.importKey === `discord:${A}`)!
    const b = r.rows.find((x) => x.importKey === `discord:${B}`)!
    expect(a.links.some((l) => l.kind === 'sheet')).toBe(false)
    expect(b.links.some((l) => l.kind === 'sheet' && l.sourceKey === 'sheet:2')).toBe(true)
    expect(b.historical.resubmissionOf).toBe(`discord:${A}`)
    expect(b.links.some((l) => l.sourceKey === `resub:discord:${A}`)).toBe(true)
    expect(r.review.reattachedSheetRows).toHaveLength(2)
  })

  it('fails when two overrides claim one sheet row, or an override points at a missing row', () => {
    const r = buildImport(world({ overrides: { [`discord:${A}`]: { sheetRows: [2] }, [`discord:${B}`]: { sheetRows: [2] } } }))
    expect(r.errors.join(' ')).toMatch(/claimed by two overrides/)
    expect(buildImport(world({ overrides: { [`discord:${B}`]: { sheetRows: [99] } } })).errors.join(' ')).toMatch(/does not exist/)
  })

  it('never leaves a sheet row on two polls: the inventory link yields to an override elsewhere', () => {
    const r = buildImport(world({ overrides: { [`discord:${B}`]: { sheetRows: [2] } } }))
    expect(r.errors).toEqual([])
    const holders = r.rows.filter((x) => x.links.some((l) => l.sourceKey === 'sheet:2'))
    expect(holders.map((x) => x.importKey)).toEqual([`discord:${B}`])
  })

  it('imports only high-confidence payments; medium ones go to the review list', () => {
    const tx1 = `0x${'b'.repeat(64)}`
    const tx2 = `0x${'c'.repeat(64)}`
    const r = buildImport(world({ finance: [fin(D, 'high', tx1), fin(B, 'medium', tx2)] }))
    const d = r.rows.find((x) => x.importKey === `discord:${D}`)!
    const b = r.rows.find((x) => x.importKey === `discord:${B}`)!
    expect(d.payments.map((p) => p.txHash)).toEqual([tx1])
    expect(b.payments).toEqual([])
    expect(r.review.mediumPayments).toHaveLength(1)
  })

  it('matches finance lines by title and date when there is no message, and reports the unmatched', () => {
    const tx = `0x${'d'.repeat(64)}`
    const r = buildImport(world({ finance: [{ title: 'Beta', dateProposed: '2024-04-01', discordMessage: null, note: 'confidence high', payments: [{ date: '2024-04-05', amount: '1', asset: 'USDC', usd: 1, 'txHash or ref': tx }] }, { title: 'Nobody', dateProposed: '2020-01-01', note: 'confidence high', payments: [{ date: '2020-01-02', amount: '1', asset: 'USDC', usd: 1, 'txHash or ref': `0x${'e'.repeat(64)}` }] }] }))
    expect(r.rows.find((x) => x.importKey === `discord:${D}`)!.payments).toHaveLength(1)
    expect(r.review.unmatchedFinance).toHaveLength(1)
  })

  it('a sheet "Paid" row with no matched payment gets a no-tx payment, a Failed one does not', () => {
    const sheet = [world().sheet[0], ['3/1/2024', '', 'Paid', 'Pat', 'Alpha event', 'Town', '$600', '', url(A)]]
    const r = buildImport(world({ sheet }))
    const a = r.rows.find((x) => x.importKey === `discord:${A}`)!
    // 9 ayes against 15 but the sheet says Paid: the sheet wins, flagged, and a no-tx payment is recorded.
    expect(a).toMatchObject({ status: 'PASSED', outcomeSource: 'sheet' })
    expect(a.payments).toHaveLength(1)
    expect(a.payments[0]).toMatchObject({ source: 'sheet', txHash: null })
    const failed = buildImport(world()).rows.find((x) => x.importKey === `discord:${A}`)!
    expect(failed.payments).toEqual([])
  })

  it('moves a finance line to another row with financeFrom and sets a chain', () => {
    const tx = `0x${'f'.repeat(64)}`
    const r = buildImport(world({ finance: [fin(A, 'high', tx)], overrides: { [`discord:${B}`]: { financeFrom: [A], paymentChains: { [tx]: 'polygon' }, outcome: 'PASSED' } } }))
    expect(r.rows.find((x) => x.importKey === `discord:${A}`)!.payments).toEqual([])
    expect(r.rows.find((x) => x.importKey === `discord:${B}`)!.payments[0]).toMatchObject({ txHash: tx, chain: 'polygon', chainAssumed: false })
  })

  it('exclude and mergeInto drop a row (merge keeps its sheet row as a link)', () => {
    const r = buildImport(world({ overrides: { [`discord:${D}`]: { exclude: true } } }))
    expect(r.rows.find((x) => x.importKey === `discord:${D}`)).toBeUndefined()
    const m = buildImport(world({ overrides: { [`discord:${A}`]: { mergeInto: `discord:${B}` } } }))
    expect(m.rows.find((x) => x.importKey === `discord:${A}`)).toBeUndefined()
    expect(m.rows.find((x) => x.importKey === `discord:${B}`)!.links.some((l) => l.sourceKey === `merged:${A}`)).toBe(true)
  })

  it('summarizes', () => {
    const s = summarize(buildImport(world()).rows)
    expect(s.rows).toBe(4)
    expect(s.byKeyKind).toEqual({ discord: 3, early: 1 })
  })
})
