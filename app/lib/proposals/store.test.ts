/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
// Store rules against an in-memory Prisma fake and real per-proposal RSA keys: role snapshot, blind issuance (once per
// member), secret changeable ballots, production-only, wallet-backup ciphertext, closing and the pass rule.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/app/lib/db', () => ({
  prisma: new Proxy({}, { get: (_t, k) => fake.current.db[k] }),
}))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildRoles: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ hasRole: vi.fn() }))

import { SETTINGS } from '@/app/lib/settings/registry'
import { resolvePaymentPolicy } from '@/app/lib/payments/policy'
import { BACKUP_BLOB_LENGTH } from './backup'
import { castBallot, createProposal, getBallotBlob, getPublicKey, issueToken, openProposal, saveBallotBlob, settleProposal } from './store'
import { makeFakeDb, makeProposalKey, mintCredentials, startBlind, testEnv } from './test-utils'
import type { ProposalRules } from './rules'
import type { RoleDeps } from './eligibility'

const DAY = 24 * 3600_000
const t0 = new Date('2026-11-04T12:00:00Z')
const policy = resolvePaymentPolicy({ get: ((k: string) => (SETTINGS as any)[k].default) as never, readFailed: false, invalidKeys: [] })
const rules: ProposalRules = { windowDays: 7, generalAyes: 15, policy }
const env = testEnv()

beforeEach(() => {
  fake.current = makeFakeDb()
})

const roleHolders = (ids: string[]): RoleDeps => ({ voterRoleId: async () => '700000000000000001', listRoleHolders: async () => ids })

async function openOne(opts: { amountUsd?: number; voters?: string[] } = {}) {
  const { id } = await createProposal({
    kind: opts.amountUsd == null ? 'GENERAL' : 'FUNDING', title: 'T', body: 'B', amountUsdCents: opts.amountUsd == null ? null : opts.amountUsd * 100,
    eventDate: null, city: null, sponsorLabel: null, proposerDiscordId: 'proposer',
  })
  const r = await openProposal(id, { now: t0, deps: roleHolders(opts.voters ?? ['v1', 'v2', 'v3']), rules, env, keyBits: 2048 })
  expect(r.ok).toBe(true)
  return id
}
const row = (id: string) => fake.current.state.proposal.find((p: any) => p.id === id)

/** The browser flow for one member: blind under the proposal's public key, get a signature (once), unblind. */
async function getToken(id: string, discordId: string, now = new Date(t0.getTime() + 1000)) {
  const b = await startBlind(row(id).keyPublicPem, id)
  const r = await issueToken(id, discordId, b.blinded, { now, env })
  return r.ok ? { ok: true as const, creds: await b.finish(r.blindSignature) } : r
}

describe('opening a proposal', () => {
  it('snapshots the voter-role holders, the window, the tier threshold and a signing key on the proposal', async () => {
    const id = await openOne({ amountUsd: 1000 })
    expect(row(id)).toMatchObject({ status: 'OPEN', eligibleCount: 3, ayesNeeded: 25, voterRoleId: '700000000000000001', countAbstains: true, requireAyesOverNays: true })
    expect(row(id).closesAt.getTime() - row(id).opensAt.getTime()).toBe(7 * DAY)
    expect(fake.current.state.voter.map((v: any) => v.discordId).sort()).toEqual(['v1', 'v2', 'v3'])
    expect(row(id).keyPublicPem).toContain('BEGIN PUBLIC KEY')
    expect(row(id).keyPrivateEnc).not.toContain('PRIVATE')
    expect(await getPublicKey(id)).toEqual({ publicKey: row(id).keyPublicPem, fingerprint: row(id).keyFingerprint })
  })

  it('gives every proposal its own key', async () => {
    const a = await openOne()
    const b = await openOne()
    expect(row(a).keyFingerprint).not.toBe(row(b).keyFingerprint)
  })

  it('uses 15 / 25 / 35 by amount and generalAyes for non-funding proposals', async () => {
    for (const [usd, need] of [[625, 15], [626, 25], [2500, 25], [2501, 35]] as const) {
      fake.current = makeFakeDb()
      const id = await openOne({ amountUsd: usd })
      expect(row(id).ayesNeeded).toBe(need)
    }
    fake.current = makeFakeDb()
    expect(row(await openOne()).ayesNeeded).toBe(15)
  })

  it('opens only once', async () => {
    const id = await openOne()
    expect(await openProposal(id, { now: t0, deps: roleHolders(['x']), rules, env, keyBits: 2048 })).toEqual({ ok: false, code: 'not_draft' })
    expect(fake.current.state.voter.map((v: any) => v.discordId)).not.toContain('x')
  })

  it('stays a draft when the role listing fails (no partial voter list)', async () => {
    const { id } = await createProposal({ kind: 'GENERAL', title: 'T', body: 'B', amountUsdCents: null, eventDate: null, city: null, sponsorLabel: null, proposerDiscordId: 'p' })
    const deps: RoleDeps = { voterRoleId: async () => '7', listRoleHolders: async () => { throw new Error('discord down') } }
    await expect(openProposal(id, { now: t0, deps, rules, env })).rejects.toThrow()
    expect(row(id).status).toBe('DRAFT')
    expect(fake.current.state.voter).toHaveLength(0)
  })
})

describe('production only', () => {
  it('refuses to open, issue or count anything outside production', async () => {
    const id = await openOne()
    const preview = { ...env, VERCEL_ENV: 'preview' } as unknown as NodeJS.ProcessEnv
    const b = await startBlind(row(id).keyPublicPem, id)
    expect(await issueToken(id, 'v1', b.blinded, { now: t0, env: preview })).toEqual({ ok: false, code: 'not_production' })
    const creds = await mintCredentials({ id, ...row(id) }, env)
    expect(await castBallot(id, creds, 'AYE', { now: t0, env: preview })).toEqual({ ok: false, code: 'not_production' })
    const { id: d } = await createProposal({ kind: 'GENERAL', title: 'T', body: 'B', amountUsdCents: null, eventDate: null, city: null, sponsorLabel: null, proposerDiscordId: 'p' })
    expect(await openProposal(d, { now: t0, deps: roleHolders(['a']), rules, env: preview })).toEqual({ ok: false, code: 'not_production' })
    expect(await openProposal(d, { now: t0, deps: roleHolders(['a']), rules, env: {} as NodeJS.ProcessEnv })).toEqual({ ok: false, code: 'not_production' })
    expect(row(d).status).toBe('DRAFT')
    expect(fake.current.state.ballot).toHaveLength(0)
  })
})

describe('role snapshot', () => {
  it('a member who got the role after the proposal opened cannot get a token', async () => {
    const id = await openOne({ voters: ['v1'] })
    expect(await getToken(id, 'late-joiner')).toEqual({ ok: false, code: 'not_eligible' })
    expect((await getToken(id, 'v1')).ok).toBe(true)
  })
})

describe('issuing blind tokens', () => {
  it('issues exactly one token per member per proposal, never again', async () => {
    const id = await openOne()
    expect((await getToken(id, 'v1')).ok).toBe(true)
    expect(await getToken(id, 'v1')).toEqual({ ok: false, code: 'already_issued' })
    const voter = fake.current.state.voter.find((v: any) => v.discordId === 'v1')
    expect(voter.tokenIssuedAt.getTime() % DAY).toBe(0) // day precision only
  })

  it('does not hand out a signature when the claim is lost to a concurrent request', async () => {
    const id = await openOne()
    const b = await startBlind(row(id).keyPublicPem, id)
    const claim = fake.current.db.proposalVoter.updateMany
    fake.current.db.proposalVoter.updateMany = async () => ({ count: 0 })
    const r = await issueToken(id, 'v1', b.blinded, { now: t0, env })
    fake.current.db.proposalVoter.updateMany = claim
    expect(r).toEqual({ ok: false, code: 'already_issued' })
  })

  it('refuses once closed, and for a missing proposal', async () => {
    const id = await openOne()
    const b = await startBlind(row(id).keyPublicPem, id)
    expect(await issueToken(id, 'v1', b.blinded, { now: new Date(t0.getTime() + 8 * DAY), env })).toEqual({ ok: false, code: 'closed' })
    expect(await issueToken('nope', 'v1', b.blinded, { now: t0, env })).toEqual({ ok: false, code: 'not_found' })
  })
})

describe('per-proposal keys across proposals', () => {
  it('a token issued under P but labelled Q is refused when cast on Q', async () => {
    const p = await openOne()
    const q = await openOne()
    const forged = await mintCredentials({ id: p, ...row(p) }, env, q)
    expect(await castBallot(q, forged, 'AYE', { now: t0, env })).toEqual({ ok: false, code: 'invalid_token' })
    expect(await castBallot(p, forged, 'AYE', { now: t0, env })).toEqual({ ok: false, code: 'invalid_token' })
    expect(fake.current.state.ballot).toHaveLength(0)
  })

  it('a token from the legacy shared key pair cannot vote on a proposal', async () => {
    const id = await openOne()
    const legacy = await makeProposalKey(id, env) // some other key that is not this proposal's
    expect(await castBallot(id, await mintCredentials(legacy, env), 'AYE', { now: t0, env })).toEqual({ ok: false, code: 'invalid_token' })
  })
})

describe('ballots are secret', () => {
  it('stores no member id, no timestamp and no token on a ballot', async () => {
    const id = await openOne()
    const t = await getToken(id, 'v1')
    if (!t.ok) throw new Error('no token')
    expect(await castBallot(id, t.creds, 'AYE', { now: new Date(t0.getTime() + 2000), env })).toEqual({ ok: true })
    const [b] = fake.current.state.ballot
    expect(Object.keys(b).sort()).toEqual(['choice', 'id', 'proposalId', 'tokenHash'])
    expect(JSON.stringify(b)).not.toContain('v1')
    expect(JSON.stringify(b)).not.toContain(t.creds.token)
  })

  it('the schema gives a ballot no way to name a member, a time or an address', () => {
    const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8')
    const model = schema.match(/model ProposalBallot \{([\s\S]*?)\n\}/)![1]
    const fields = model.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((f) => f && !f.startsWith('@') && !f.startsWith('//'))
    expect(fields).toEqual(['id', 'proposalId', 'tokenHash', 'choice', 'proposal'])
  })

  it('the voter table records issuance but never a choice or a token', () => {
    const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8')
    const model = schema.match(/model ProposalVoter \{([\s\S]*?)\n\}/)![1]
    expect(model).not.toMatch(/choice|tokenHash/i)
  })

  it('the same token replaces the choice; a different token is a different ballot', async () => {
    const id = await openOne()
    const t = await getToken(id, 'v1')
    if (!t.ok) throw new Error('no token')
    await castBallot(id, t.creds, 'AYE', { now: t0, env })
    await castBallot(id, t.creds, 'NAY', { now: new Date(t0.getTime() + DAY), env })
    expect(fake.current.state.ballot).toHaveLength(1)
    expect(fake.current.state.ballot[0].choice).toBe('NAY')
    await castBallot(id, await mintCredentials({ id, ...row(id) }, env), 'ABSTAIN', { now: t0, env })
    expect(fake.current.state.ballot.map((b: any) => b.choice).sort()).toEqual(['ABSTAIN', 'NAY'])
  })

  it('refuses an unsigned or foreign token and a bad choice', async () => {
    const id = await openOne()
    const t = await getToken(id, 'v1')
    if (!t.ok) throw new Error('no token')
    expect(await castBallot(id, { ...t.creds, signature: Buffer.alloc(256).toString('base64') }, 'AYE', { now: t0, env })).toEqual({ ok: false, code: 'invalid_token' })
    expect(await castBallot(id, t.creds, 'MAYBE', { now: t0, env })).toEqual({ ok: false, code: 'bad_request' })
    expect(await castBallot('nope', t.creds, 'AYE', { now: t0, env })).toEqual({ ok: false, code: 'not_found' })
    expect(fake.current.state.ballot).toHaveLength(0)
  })

  it('never logs a token or a choice', async () => {
    const id = await openOne()
    const t = await getToken(id, 'v1')
    if (!t.ok) throw new Error('no token')
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    await castBallot(id, t.creds, 'NAY', { now: t0, env })
    for (const s of spies) expect(s).not.toHaveBeenCalled()
    spies.forEach((s) => s.mockRestore())
  })

  it('no vote after closing, even before the cron has counted', async () => {
    const id = await openOne()
    const t = await getToken(id, 'v1')
    if (!t.ok) throw new Error('no token')
    expect(await castBallot(id, t.creds, 'AYE', { now: new Date(t0.getTime() + 7 * DAY), env })).toEqual({ ok: false, code: 'closed' })
  })
})

describe('wallet backup storage', () => {
  const blob = 'A'.repeat(BACKUP_BLOB_LENGTH)

  it('stores only the opaque fixed-length ciphertext for an eligible voter, and returns it to them alone', async () => {
    const id = await openOne()
    expect(await saveBallotBlob(id, 'v1', blob)).toBe('ok')
    expect(await getBallotBlob(id, 'v1')).toEqual({ eligible: true, blob })
    expect(await getBallotBlob(id, 'v2')).toEqual({ eligible: true, blob: null })
    expect(await saveBallotBlob(id, 'outsider', blob)).toBe('not_eligible')
    expect(await getBallotBlob(id, 'outsider')).toEqual({ eligible: false, blob: null })
  })

  it('is written once: a second backup never overwrites the first', async () => {
    const id = await openOne()
    expect(await saveBallotBlob(id, 'v1', blob)).toBe('ok')
    expect(await saveBallotBlob(id, 'v1', 'B'.repeat(BACKUP_BLOB_LENGTH))).toBe('exists')
    expect((await getBallotBlob(id, 'v1')).blob).toBe(blob)
  })

  it('accepts only the one exact length (so a key, a code or anything else cannot be stored)', async () => {
    const id = await openOne()
    for (const bad of [null, 5, 'short', 'A'.repeat(BACKUP_BLOB_LENGTH - 1), 'A'.repeat(BACKUP_BLOB_LENGTH + 1), 'A'.repeat(BACKUP_BLOB_LENGTH - 1) + '+', ' '.repeat(BACKUP_BLOB_LENGTH)]) {
      expect(await saveBallotBlob(id, 'v1', bad)).toBe('bad_request')
    }
    expect((await getBallotBlob(id, 'v1')).blob).toBeNull()
  })
})

describe('closing and the pass rule', () => {
  // Ballots go straight into the table here (signing 20+ real tokens is slow); the vote path has its own tests above.
  async function voteAll(id: string, choices: Array<'AYE' | 'NAY' | 'ABSTAIN'>) {
    choices.forEach((choice, i) => fake.current.state.ballot.push({ id: `seed${i}`, proposalId: id, tokenHash: `hash${i}`, choice }))
  }
  const rep = (c: 'AYE' | 'NAY' | 'ABSTAIN', n: number) => Array(n).fill(c) as Array<'AYE' | 'NAY' | 'ABSTAIN'>

  it('passes at close with 15 counted and more ayes than nays, and stores the counts', async () => {
    const id = await openOne()
    await voteAll(id, [...rep('AYE', 10), ...rep('ABSTAIN', 5), ...rep('NAY', 2)])
    expect(await settleProposal(id, new Date(t0.getTime() + 7 * DAY + 6 * 60_000))).toMatchObject({ ok: true, outcome: 'passed', ayes: 10, nays: 2, abstains: 5 })
    expect(row(id)).toMatchObject({ status: 'PASSED', ayes: 10, nays: 2, abstains: 5 })
    expect(fake.current.state.event.map((e: any) => e.type)).toContain('CLOSED')
  })

  it('fails with enough turnout but not more ayes than nays, and fails below the threshold', async () => {
    const id = await openOne()
    await voteAll(id, [...rep('AYE', 8), ...rep('NAY', 8), ...rep('ABSTAIN', 8)])
    expect(await settleProposal(id, new Date(t0.getTime() + 8 * DAY))).toMatchObject({ ok: true, outcome: 'failed' })
    fake.current = makeFakeDb()
    const id2 = await openOne()
    await voteAll(id2, rep('AYE', 14))
    expect(await settleProposal(id2, new Date(t0.getTime() + 8 * DAY))).toMatchObject({ ok: true, outcome: 'failed' })
  })

  it('uses the funding tier it opened under (25 ayes for $1,000)', async () => {
    const id = await openOne({ amountUsd: 1000 })
    await voteAll(id, rep('AYE', 24))
    expect(await settleProposal(id, new Date(t0.getTime() + 8 * DAY))).toMatchObject({ outcome: 'failed' })
  })

  it('is not decided early and settles only once', async () => {
    const id = await openOne()
    await voteAll(id, rep('AYE', 20))
    expect(await settleProposal(id, new Date(t0.getTime() + 3 * DAY))).toEqual({ ok: false, code: 'not_due' })
    expect(row(id).status).toBe('OPEN')
    expect((await settleProposal(id, new Date(t0.getTime() + 7 * DAY + 5 * 60_000))).ok).toBe(true)
    expect(await settleProposal(id, new Date(t0.getTime() + 9 * DAY))).toEqual({ ok: false, code: 'not_open' })
  })
})
