// @vitest-environment node
// jalapeno-82565 v2 — status codes of the bounty write routes (401 / 400 / 403 / 404 / 409).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ForbiddenError, ConflictError, NotFoundError } from '@/app/lib/errors/api-errors'

const getSession = vi.fn()
const bounties = {
  submitBounty: vi.fn(),
  rejectBounty: vi.fn(),
  completeBounty: vi.fn(),
  cancelBounty: vi.fn(),
  claimBounty: vi.fn(),
  giveUpBounty: vi.fn(),
}
vi.mock('@/app/lib/session', () => ({ getSession: () => getSession() }))
vi.mock('@/app/lib/economy', () => ({ requireOnboarded: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/app/lib/bounties', () => ({
  submitBounty: (...a: unknown[]) => bounties.submitBounty(...a),
  rejectBounty: (...a: unknown[]) => bounties.rejectBounty(...a),
  completeBounty: (...a: unknown[]) => bounties.completeBounty(...a),
  cancelBounty: (...a: unknown[]) => bounties.cancelBounty(...a),
  claimBounty: (...a: unknown[]) => bounties.claimBounty(...a),
  giveUpBounty: (...a: unknown[]) => bounties.giveUpBounty(...a),
}))

import { POST as submit } from './submit/route'
import { POST as reject } from './reject/route'
import { POST as complete } from './complete/route'
import { POST as cancel } from './cancel/route'
import { POST as claim } from './claim/route'
import { POST as giveup } from './giveup/route'

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/bounties/x', { method: 'POST', body: JSON.stringify(body) })

const OK = { id: 1, description: 'd', reward: 5, status: 'X' }

const ROUTES: [string, (r: NextRequest) => Promise<Response>, keyof typeof bounties, Record<string, unknown>][] = [
  ['submit', submit, 'submitBounty', { bountyId: 1, note: 'did it' }],
  ['reject', reject, 'rejectBounty', { bountyId: 1, note: 'nope' }],
  ['complete', complete, 'completeBounty', { bountyId: 1 }],
  ['cancel', cancel, 'cancelBounty', { bountyId: 1 }],
  ['claim', claim, 'claimBounty', { bountyId: 1 }],
  ['giveup', giveup, 'giveUpBounty', { bountyId: 1 }],
]

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ discordId: 'u1' })
})

describe.each(ROUTES)('POST /api/bounties/%s', (_name, handler, fn, body) => {
  it('401 with no session', async () => {
    getSession.mockResolvedValue(null)
    expect((await handler(req(body))).status).toBe(401)
    expect(bounties[fn]).not.toHaveBeenCalled()
  })

  it('400 without a bounty id', async () => {
    expect((await handler(req({ ...body, bountyId: undefined }))).status).toBe(400)
    expect(bounties[fn]).not.toHaveBeenCalled()
  })

  it('maps Forbidden / NotFound / Conflict to 403 / 404 / 409', async () => {
    bounties[fn].mockRejectedValueOnce(new ForbiddenError('no'))
    expect((await handler(req(body))).status).toBe(403)
    bounties[fn].mockRejectedValueOnce(new NotFoundError('Bounty'))
    expect((await handler(req(body))).status).toBe(404)
    bounties[fn].mockRejectedValueOnce(new ConflictError('raced'))
    expect((await handler(req(body))).status).toBe(409)
  })

  it('200 on success, acting as the session user', async () => {
    bounties[fn].mockResolvedValueOnce(OK)
    const res = await handler(req(body))
    expect(res.status).toBe(200)
    expect(bounties[fn].mock.calls[0].slice(0, 2)).toEqual(['u1', 1])
  })
})

describe('submit / reject bodies', () => {
  it('submit passes note and link through; a non-string note is a 400', async () => {
    bounties.submitBounty.mockResolvedValueOnce(OK)
    await submit(req({ bountyId: 1, note: 'n', link: 'https://x.test' }))
    expect(bounties.submitBounty).toHaveBeenCalledWith('u1', 1, 'n', 'https://x.test')
    expect((await submit(req({ bountyId: 1, note: 5 }))).status).toBe(400)
  })

  it('reject requires a string note', async () => {
    expect((await reject(req({ bountyId: 1 }))).status).toBe(400)
    expect(bounties.rejectBounty).not.toHaveBeenCalled()
  })
})
