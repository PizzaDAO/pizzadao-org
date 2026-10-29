// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: { discordId: '111111111111111111' } as { discordId: string } | null,
  pubkey: vi.fn(),
  saveBlob: vi.fn(),
  getBlob: vi.fn(),
}))

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/proposals/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/proposals/constants')>()),
  proposalsEnabled: async () => true,
}))
vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: async () =>
    m.session ? { ok: true, session: m.session } : { ok: false, response: new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 }) },
}))
vi.mock('@/app/lib/proposals/store', () => ({ getPublicKey: m.pubkey, saveBallotBlob: m.saveBlob, getBallotBlob: m.getBlob }))

import { GET as pubkeyGET } from './[id]/pubkey/route'
import { GET as backupGET, PUT as backupPUT } from './[id]/backup/route'

const ctx = { params: Promise.resolve({ id: 'p1' }) }
const req = (init?: RequestInit) => new Request('https://app.pizzadao.org/x', init)
const put = (body: unknown) => backupPUT(req({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { discordId: '111111111111111111' }
  m.pubkey.mockResolvedValue({ publicKey: 'PEM', fingerprint: 'aaaa bbbb' })
  m.saveBlob.mockResolvedValue('ok')
  m.getBlob.mockResolvedValue({ eligible: true, blob: 'ciphertext' })
})

describe('GET /api/proposals/[id]/pubkey', () => {
  it("serves the proposal's own public key and fingerprint", async () => {
    expect(await (await pubkeyGET(req(), ctx)).json()).toEqual({ publicKey: 'PEM', fingerprint: 'aaaa bbbb' })
    m.pubkey.mockResolvedValueOnce(null)
    expect((await pubkeyGET(req(), ctx)).status).toBe(404)
  })
})

describe('wallet backup route', () => {
  it('needs a session and passes only the ciphertext field to the store (the key never reaches the server)', async () => {
    m.session = null
    expect((await put({ blob: 'ciphertext' })).status).toBe(401)
    m.session = { discordId: '111111111111111111' }
    expect((await put({ blob: 'ciphertext', signature: '0xsecret', key: 'k' })).status).toBe(200)
    expect(m.saveBlob).toHaveBeenCalledWith('p1', '111111111111111111', 'ciphertext')
    expect(JSON.stringify(m.saveBlob.mock.calls)).not.toMatch(/0xsecret/)
    m.saveBlob.mockResolvedValueOnce('bad_request')
    expect((await put({ blob: 'x' })).status).toBe(400)
    m.saveBlob.mockResolvedValueOnce('not_eligible')
    expect((await put({ blob: 'x' })).status).toBe(403)
  })

  it('returns the stored ciphertext only to an eligible member', async () => {
    expect(await (await backupGET(req(), ctx)).json()).toEqual({ blob: 'ciphertext' })
    m.getBlob.mockResolvedValueOnce({ eligible: false, blob: null })
    expect((await backupGET(req(), ctx)).status).toBe(403)
  })
})
