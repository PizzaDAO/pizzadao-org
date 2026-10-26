// @vitest-environment node
// Route-level checks for the crew drafts API (status codes, no DELETE).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getSession = vi.fn()
vi.mock('@/app/lib/session', () => ({ getSession: () => getSession() }))
vi.mock('@/app/lib/crew-drafts', async () => {
  const { ForbiddenError } = await import('@/app/lib/errors/api-errors')
  return {
    listDrafts: vi.fn(async (_u: string, crewId: string) => {
      if (crewId === 'outsider') throw new ForbiddenError('Crew members only')
      return { access: { member: true, manager: false }, drafts: [] }
    }),
    createDraft: vi.fn(async () => ({ id: 1 })),
    updateDraft: vi.fn(async () => ({ id: 1, status: 'ready' })),
  }
})

import * as collection from './route'
import * as item from './[draftId]/route'
import { createDraft, updateDraft } from '@/app/lib/crew-drafts'

const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/crew/comms/drafts', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const cctx = (crewId = 'comms') => ({ params: Promise.resolve({ crewId }) })
const ictx = (draftId = '1') => ({ params: Promise.resolve({ crewId: 'comms', draftId }) })

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ discordId: 'u1' })
})

describe('drafts routes', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await collection.GET(req(), cctx())).status).toBe(401)
    expect((await collection.POST(req({}), cctx())).status).toBe(401)
    expect((await item.PATCH(req({ status: 'ready' }), ictx())).status).toBe(401)
  })
  it('403 for non-members on GET', async () => {
    expect((await collection.GET(req(), cctx('outsider'))).status).toBe(403)
  })
  it('POST creates (201) and rejects a missing body (400)', async () => {
    expect((await collection.POST(req({ platform: 'x', text: 'hi' }), cctx())).status).toBe(201)
    expect(createDraft).toHaveBeenCalled()
    expect((await collection.POST(req(undefined), cctx())).status).toBe(400)
  })
  it('PATCH rejects a bad id and a bad body, and forwards a good one in one call', async () => {
    expect((await item.PATCH(req({ status: 'ready' }), ictx('abc'))).status).toBe(400)
    expect((await item.PATCH(req(undefined), ictx())).status).toBe(400)
    expect((await item.PATCH(req([1]), ictx())).status).toBe(400)
    expect(updateDraft).not.toHaveBeenCalled()
    expect((await item.PATCH(req({ text: 'x', status: 'ready' }), ictx())).status).toBe(200)
    expect(updateDraft).toHaveBeenCalledTimes(1)
    expect(updateDraft).toHaveBeenCalledWith('u1', 'comms', 1, { text: 'x', status: 'ready' })
  })
  it('exposes no DELETE (archive is the only removal)', () => {
    expect('DELETE' in item).toBe(false)
    expect('DELETE' in collection).toBe(false)
  })
})
