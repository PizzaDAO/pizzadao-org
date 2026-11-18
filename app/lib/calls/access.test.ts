// @vitest-environment node
// Capo review: who counts as a capo, what a capo may do, and the held-call rules.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn() }))
vi.mock('@/app/lib/calls/post-filters', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/post-filters')>()), loadPostFilter: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({
  isDreadPizzaRoberts: vi.fn(),
  resolveRoles: vi.fn(),
  holdsAny: vi.fn(),
}))

import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { loadPostFilter } from '@/app/lib/calls/post-filters'
import { holdsAny, isDreadPizzaRoberts, resolveRoles } from '@/app/lib/mission-review-access'
import { CALL_CAPO_ROLE_IDS, PIZZA_CAPO_ROLE_ID } from '@/app/ui/constants'
import { CAPO_ACTIONS, autoHoldReason, callReviewRole, canActOnCall, heldReason, requireCallAccess, type CallAction } from './access'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const FILTER = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], ownerOnlyTerms: ['sensitive'], ownerOnlyCrewIds: ['crew_owner'] }
const EMPTY = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], ownerOnlyTerms: [], ownerOnlyCrewIds: [] }
const REC = { id: 'rec1', source: 'DISCORD', status: 'IN_REVIEW', reviewHoldAt: null, crewId: 'crew_a', title: 'Weekly', summary: 'Plain summary', actionItems: [], chapters: [] }

/** A fake role world: who is DPR, who holds which role ids. */
function world(opts: { dpr?: boolean; capo?: boolean; toggle?: boolean; lookupFails?: boolean }) {
  m(isDreadPizzaRoberts).mockImplementation(async () => !!opts.dpr)
  m(toggleEnabled).mockImplementation(async () => opts.toggle ?? true)
  m(resolveRoles).mockImplementation(async () => {
    if (opts.lookupFails) throw new Error('discord down')
    return opts.capo ? [PIZZA_CAPO_ROLE_ID] : []
  })
  m(holdsAny).mockImplementation(async (roles: string[], allowed: string[]) => roles.some((r) => allowed.includes(r)))
}

beforeEach(() => {
  vi.clearAllMocks()
  m(loadPostFilter).mockResolvedValue(EMPTY)
})

describe('callReviewRole', () => {
  it('the owner is the owner whatever the toggle says', async () => {
    world({ dpr: true, toggle: false })
    expect(await callReviewRole('9')).toBe('owner')
    world({ dpr: true, toggle: true })
    expect(await callReviewRole('9')).toBe('owner')
  })
  it('a Pizza Capo is a capo only while the toggle is on', async () => {
    world({ capo: true, toggle: true })
    expect(await callReviewRole('9')).toBe('capo')
    vi.clearAllMocks()
    world({ capo: true, toggle: false })
    expect(await callReviewRole('9')).toBeNull()
    // With the toggle off nothing beyond the owner check is looked up (today's behaviour).
    expect(resolveRoles).not.toHaveBeenCalled()
  })
  it('someone without either role is nobody', async () => {
    world({ toggle: true })
    expect(await callReviewRole('9')).toBeNull()
  })
  it('uses the pinned Pizza Capo role only', () => {
    expect([...CALL_CAPO_ROLE_IDS]).toEqual([PIZZA_CAPO_ROLE_ID])
  })
  it('accepts the role ids of an interaction payload', async () => {
    world({ capo: true })
    expect(await callReviewRole([PIZZA_CAPO_ROLE_ID])).toBe('capo')
  })
  it('fails closed when the role lookup or the toggle read fails', async () => {
    world({ lookupFails: true, toggle: true })
    expect(await callReviewRole('9')).toBeNull()
    world({ capo: true })
    m(toggleEnabled).mockRejectedValue(new Error('db down'))
    expect(await callReviewRole('9')).toBeNull()
  })
})

describe('held calls', () => {
  it('a manual hold wins; the filter holds by crew and by whole-word term across the text', () => {
    expect(heldReason({ ...REC, reviewHoldAt: new Date() }, EMPTY)).toBe('manual')
    expect(heldReason(REC, EMPTY)).toBeNull()
    expect(autoHoldReason({ ...REC, crewId: 'Crew Owner' }, FILTER)).toBe('crew')
    expect(autoHoldReason({ ...REC, title: 'A SENSITIVE topic' }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, summary: 'about sensitive things' }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, actionItems: [{ text: 'do it', owner: 'sensitive' }] }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, actionItems: [{ text: 'a sensitive thing' }] }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, chapters: [{ startMs: 0, title: 'sensitive' }] }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, summary: 'insensitive' }, FILTER)).toBeNull()
  })
  it('an unreadable filter holds the call (fail closed)', () => {
    expect(autoHoldReason(REC, null)).toBe('unreadable')
    expect(canActOnCall('capo', 'view', REC, null)).toBe(false)
    expect(canActOnCall('owner', 'view', REC, null)).toBe(true)
  })
})

describe('capo scope (removed, early and sensitive calls)', () => {
  it('a capo never gets a REJECTED, RECORDED or PROCESSING call, or one without a summary; the owner does', () => {
    for (const status of ['REJECTED', 'RECORDED', 'PROCESSING']) {
      expect(canActOnCall('capo', 'view', { ...REC, status }, EMPTY), status).toBe(false)
      expect(canActOnCall('owner', 'view', { ...REC, status }, EMPTY), status).toBe(true)
    }
    expect(canActOnCall('capo', 'view', { ...REC, summary: null }, EMPTY)).toBe(false)
    expect(canActOnCall('capo', 'view', { ...REC, summary: '  ' }, EMPTY)).toBe(false)
    expect(canActOnCall('capo', 'view', { ...REC, status: 'PUBLISHED' }, EMPTY)).toBe(true)
  })
  it('the filter scans the event name, crew label and the visible transcript, not hidden lines', () => {
    const seg = (text: string, over: Record<string, unknown> = {}) => ({ discordId: '111111111111111111', startMs: 0, endMs: 1, text, ...over })
    expect(autoHoldReason({ ...REC, transcript: [seg('we talked about the Sensitive thing')] }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, eventName: 'sensitive call' }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, crewLabel: 'The Sensitive Crew' }, FILTER)).toBe('term')
    expect(autoHoldReason({ ...REC, transcript: [seg('sensitive')], redactedSpeakerIds: ['111111111111111111'] }, FILTER)).toBeNull()
    expect(canActOnCall('capo', 'view', { ...REC, transcript: [seg('sensitive')] }, FILTER)).toBe(false)
  })
})

describe('canActOnCall matrix', () => {
  const capoActions: CallAction[] = ['view', 'publish', 'unpublish', 'editSummary', 'regenerate', 'hide', 'hold']
  const ownerOnly: CallAction[] = ['restore', 'reject', 'audio', 'retryTranscription', 'recapRepost', 'followups', 'bulk', 'postFilters', 'releaseHold', 'admin']

  it('the capo list is exactly the plan', () => {
    expect([...CAPO_ACTIONS].sort()).toEqual([...capoActions].sort())
  })
  it('a capo may do each capo action on a normal Discord call, and nothing owner-only', () => {
    for (const a of capoActions) expect(canActOnCall('capo', a, REC, EMPTY), a).toBe(true)
    for (const a of ownerOnly) expect(canActOnCall('capo', a, REC, EMPTY), a).toBe(false)
  })
  it('a capo gets nothing on a held, auto-held or imported call', () => {
    for (const a of capoActions) {
      expect(canActOnCall('capo', a, { ...REC, reviewHoldAt: new Date() }, EMPTY), a).toBe(false)
      expect(canActOnCall('capo', a, { ...REC, title: 'sensitive' }, FILTER), a).toBe(false)
      expect(canActOnCall('capo', a, { ...REC, crewId: 'crew_owner' }, FILTER), a).toBe(false)
      expect(canActOnCall('capo', a, { ...REC, source: 'X_BROADCAST' }, EMPTY), a).toBe(false)
    }
  })
  it('the owner may do everything, held or imported', () => {
    for (const a of [...capoActions, ...ownerOnly]) {
      expect(canActOnCall('owner', a, { ...REC, reviewHoldAt: new Date(), source: 'X_BROADCAST' }, FILTER), a).toBe(true)
    }
  })
  it('nobody may do anything', () => {
    expect(canActOnCall(null, 'view', REC, EMPTY)).toBe(false)
  })
})

describe('requireCallAccess', () => {
  it('401 without a session, 403 for nobody and for a capo with the toggle off', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await requireCallAccess('rec1', 'view') as { response: Response }).response.status).toBe(401)
    m(getSession).mockResolvedValue({ discordId: '9' })
    world({})
    expect((await requireCallAccess('rec1', 'view') as { response: Response }).response.status).toBe(403)
    world({ capo: true, toggle: false })
    expect((await requireCallAccess('rec1', 'view') as { response: Response }).response.status).toBe(403)
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
  })
  it('a capo on an owner-only action is a 403 before the call is even loaded', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    world({ capo: true })
    for (const a of ['restore', 'audio', 'releaseHold', 'bulk'] as const) {
      expect((await requireCallAccess('rec1', a) as { response: Response }).response.status, a).toBe(403)
    }
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
  })
  it('a capo gets the call on a normal Discord call and a 404 on held, imported or unknown ones', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    world({ capo: true })
    m(db.callRecording.findUnique).mockResolvedValue(REC)
    const ok = await requireCallAccess('rec1', 'publish')
    expect(ok).toMatchObject({ ok: true, role: 'capo', rec: { id: 'rec1' } })
    for (const rec of [{ ...REC, reviewHoldAt: new Date() }, { ...REC, source: 'X_BROADCAST' }, null]) {
      m(db.callRecording.findUnique).mockResolvedValue(rec)
      expect((await requireCallAccess('rec1', 'publish') as { response: Response }).response.status).toBe(404)
    }
  })
  it('a capo gets a 404 when the filter holds the call or cannot be read', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    world({ capo: true })
    m(db.callRecording.findUnique).mockResolvedValue({ ...REC, summary: 'a sensitive call' })
    m(loadPostFilter).mockResolvedValue(FILTER)
    expect((await requireCallAccess('rec1', 'view') as { response: Response }).response.status).toBe(404)
    m(db.callRecording.findUnique).mockResolvedValue(REC)
    m(loadPostFilter).mockRejectedValue(new Error('unreadable'))
    expect((await requireCallAccess('rec1', 'view') as { response: Response }).response.status).toBe(404)
  })
  it('the owner passes without loading the call, for any action', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    world({ dpr: true })
    expect(await requireCallAccess('rec1', 'audio')).toMatchObject({ ok: true, role: 'owner', rec: null })
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
  })
})
