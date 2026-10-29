// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  enabled: true,
  session: { discordId: '111111111111111111' } as { discordId: string } | null,
  holder: true,
  issue: vi.fn(),
  cast: vi.fn(),
  create: vi.fn(),
  getSession: vi.fn(),
  pubkey: vi.fn(),
  saveBlob: vi.fn(),
  getBlob: vi.fn(),
}))

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/app/lib/proposals/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/proposals/constants')>()),
  proposalsEnabled: async () => m.enabled,
}))
vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: async () =>
    m.session ? { ok: true, session: m.session } : { ok: false, response: new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 }) },
}))
vi.mock('@/app/lib/session', () => ({ getSession: m.getSession }))
vi.mock('@/app/lib/rate-limit', () => ({
  enforceRateLimit: async () => null,
  checkKeyedRateLimit: async () => ({ success: true }),
}))
vi.mock('@/app/lib/proposals/proposer', () => ({ canSubmitProposal: async () => m.holder }))
vi.mock('@/app/lib/proposals/lifecycle', () => ({ openAndAnnounce: vi.fn() }))
vi.mock('@/app/lib/proposals/store', () => ({ issueToken: m.issue, castBallot: m.cast, createProposal: m.create, getPublicKey: m.pubkey, saveBallotBlob: m.saveBlob, getBallotBlob: m.getBlob }))

import { POST as createPOST } from './route'
import { POST as tokenPOST } from './[id]/token/route'
import { POST as votePOST } from './[id]/vote/route'
import { GET as pubkeyGET } from './[id]/pubkey/route'
import { GET as backupGET, PUT as backupPUT } from './[id]/backup/route'

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.pizzadao.org/api/proposals/p1/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const voteBody = { token: 'proposal-p1-abc', preparedMessage: 'AA==', signature: 'AA==', choice: 'AYE' }

beforeEach(() => {
  vi.clearAllMocks()
  m.enabled = true
  m.session = { discordId: '111111111111111111' }
  m.holder = true
  m.cast.mockResolvedValue({ ok: true })
  m.issue.mockResolvedValue({ ok: true, blindSignature: 'sig' })
  m.create.mockResolvedValue({ id: 'new1' })
  m.pubkey.mockResolvedValue({ publicKey: 'PEM', fingerprint: 'aaaa bbbb' })
  m.saveBlob.mockResolvedValue('ok')
  m.getBlob.mockResolvedValue({ eligible: true, blob: 'ciphertext' })
})

describe('proposals routes while the feature is off', () => {
  it('everything answers 404', async () => {
    m.enabled = false
    expect((await createPOST(json({}))).status).toBe(404)
    expect((await tokenPOST(json({ blindedMessage: 'x' }), ctx)).status).toBe(404)
    expect((await votePOST(json(voteBody), ctx)).status).toBe(404)
    expect((await pubkeyGET(new Request('https://app.pizzadao.org/x'), ctx)).status).toBe(404)
    expect(m.cast).not.toHaveBeenCalled()
  })
})

describe('POST /api/proposals/[id]/vote (secret)', () => {
  it('needs no session and never reads who is voting', async () => {
    m.session = null
    m.getSession.mockImplementation(() => {
      throw new Error('vote must not read the session')
    })
    const r = await votePOST(json(voteBody), ctx)
    expect(r.status).toBe(200)
    expect(m.cast).toHaveBeenCalledWith('p1', { token: 'proposal-p1-abc', preparedMessage: 'AA==', signature: 'AA==' }, 'AYE')
    // Only token credentials and the choice reach the store: no member id, no request metadata.
    expect(m.cast.mock.calls[0]).toHaveLength(3)
  })

  it('maps store answers to statuses', async () => {
    for (const [code, status] of [['closed', 409], ['invalid_token', 401], ['not_found', 404], ['bad_request', 400]] as const) {
      m.cast.mockResolvedValueOnce({ ok: false, code })
      expect((await votePOST(json(voteBody), ctx)).status).toBe(status)
    }
  })

  it('rejects a body without credentials and a non-JSON request', async () => {
    expect((await votePOST(json({ choice: 'AYE' }), ctx)).status).toBe(400)
    const form = new Request('https://app.pizzadao.org/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
    expect((await votePOST(form, ctx)).status).toBe(415)
  })

  it('logs no token or choice when something breaks', async () => {
    m.cast.mockRejectedValueOnce(new Error('boom proposal-p1-abc AYE'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await votePOST(json(voteBody), ctx)
    expect(r.status).toBe(500)
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/proposal-p1-abc|AYE|boom/)
    spy.mockRestore()
  })
})

describe('POST /api/proposals/[id]/token', () => {
  it('needs a session', async () => {
    m.session = null
    expect((await tokenPOST(json({ blindedMessage: 'x' }), ctx)).status).toBe(401)
    expect(m.issue).not.toHaveBeenCalled()
  })

  it('issues a signature for the signed-in member, once', async () => {
    const r = await tokenPOST(json({ blindedMessage: 'x'.repeat(100) }), ctx)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ blindSignature: 'sig' })
    expect(m.issue).toHaveBeenCalledWith('p1', '111111111111111111', 'x'.repeat(100))
    m.issue.mockResolvedValueOnce({ ok: false, code: 'already_issued' })
    expect((await tokenPOST(json({ blindedMessage: 'x'.repeat(100) }), ctx)).status).toBe(409)
    m.issue.mockResolvedValueOnce({ ok: false, code: 'not_eligible' })
    expect((await tokenPOST(json({ blindedMessage: 'x'.repeat(100) }), ctx)).status).toBe(403)
  })
})

describe('POST /api/proposals', () => {
  const form = { kind: 'FUNDING', title: 'Pizza party', description: 'A party that brings new people.', amount: '900' }

  it('lets a box holder submit', async () => {
    const r = await createPOST(json(form))
    expect(r.status).toBe(201)
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'FUNDING', amountUsdCents: 90000, proposerDiscordId: '111111111111111111' }))
  })

  it('refuses someone without a box, bad input, and logged-out callers', async () => {
    m.holder = false
    expect((await createPOST(json(form))).status).toBe(403)
    m.holder = true
    expect((await createPOST(json({ ...form, title: 'x' }))).status).toBe(400)
    m.session = null
    expect((await createPOST(json(form))).status).toBe(401)
    expect(m.create).not.toHaveBeenCalled()
  })
})
