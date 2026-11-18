// @vitest-environment node
// Capo review through the real routes: what a capo may do (only with the toggle on, only on a normal
// Discord call), what stays owner-only, and the audit trail. The role lookup, the toggle, the filter and
// the database are faked; the access helper and the routes are the real ones.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn() }))
vi.mock('@/app/lib/calls/post-filters', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/post-filters')>()), loadPostFilter: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn(), resolveRoles: vi.fn(), holdsAny: vi.fn() }))
vi.mock('@/app/lib/calls/review-audit', () => ({ recordCallReviewEvent: vi.fn(async () => undefined) }))
vi.mock('@/app/lib/calls/recordings', () => ({
  publishRecording: vi.fn(),
  unpublishRecording: vi.fn(),
  updateRecordingText: vi.fn(),
  generateAndStoreSummary: vi.fn(),
  getRecording: vi.fn(),
  setSpeakerRedacted: vi.fn(),
  setSegmentRedacted: vi.fn(),
  rejectRecording: vi.fn(),
}))
vi.mock('@/app/lib/calls/recap', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/recap')>()), postCallRecap: vi.fn(async () => 'posted') }))
vi.mock('@/app/lib/calls/bulk', () => ({ bulkActionMax: vi.fn(async () => 5), bulkReview: vi.fn(async () => []) }))

import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { loadPostFilter } from '@/app/lib/calls/post-filters'
import { holdsAny, isDreadPizzaRoberts, resolveRoles } from '@/app/lib/mission-review-access'
import { PIZZA_CAPO_ROLE_ID } from '@/app/ui/constants'
import { generateAndStoreSummary, getRecording, publishRecording, rejectRecording, setSegmentRedacted, setSpeakerRedacted, unpublishRecording, updateRecordingText } from '@/app/lib/calls/recordings'
import { postCallRecap } from '@/app/lib/calls/recap'
import { recordCallReviewEvent } from '@/app/lib/calls/review-audit'
import { POST as publishPOST } from '@/app/api/admin/calls/[id]/publish/route'
import { PATCH as summaryPATCH } from '@/app/api/admin/calls/[id]/summary/route'
import { POST as regeneratePOST } from '@/app/api/admin/calls/[id]/regenerate/route'
import { POST as redactPOST } from '@/app/api/admin/calls/[id]/redact/route'
import { POST as redactLinePOST } from '@/app/api/admin/calls/[id]/redact-line/route'
import { POST as holdPOST } from '@/app/api/admin/calls/[id]/hold/route'
import { POST as removePOST } from '@/app/api/admin/calls/[id]/remove/route'
import { GET as audioGET } from '@/app/api/admin/calls/[id]/audio/route'
import { POST as retryPOST } from '@/app/api/admin/calls/[id]/retry-transcription/route'
import { POST as followupsPOST } from '@/app/api/admin/calls/[id]/followups/route'
import { POST as recapPOST } from '@/app/api/admin/calls/[id]/recap/route'
import { POST as taskProposalsPOST } from '@/app/api/admin/calls/[id]/task-proposals/route'
import { POST as bulkPOST } from '@/app/api/admin/calls/bulk/route'
import { PUT as filtersPUT, GET as filtersGET } from '@/app/api/admin/calls/post-filters/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const ctx = { params: Promise.resolve({ id: 'rec1' }) }
const req = (body?: unknown, method = 'POST') => new Request('https://x/api', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

const EMPTY = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], ownerOnlyTerms: [], ownerOnlyCrewIds: [] }
const REC = { id: 'rec1', source: 'DISCORD', status: 'IN_REVIEW', reviewHoldAt: null, crewId: 'crew_a', title: 'Weekly', summary: 'Plain', actionItems: [], chapters: [], redactionsUpdatedAt: null, summaryGeneratedAt: new Date('2026-11-01T10:00:00Z'), summaryEditedAt: null }

function as(who: 'owner' | 'capo' | 'nobody', toggle: boolean) {
  m(getSession).mockResolvedValue({ discordId: '9' })
  m(isDreadPizzaRoberts).mockImplementation(async () => who === 'owner')
  m(toggleEnabled).mockImplementation(async () => toggle)
  m(resolveRoles).mockImplementation(async () => (who === 'capo' ? [PIZZA_CAPO_ROLE_ID] : []))
  m(holdsAny).mockImplementation(async (roles: string[], allowed: string[]) => roles.some((r) => allowed.includes(r)))
}

beforeEach(() => {
  vi.resetAllMocks()
  m(loadPostFilter).mockResolvedValue(EMPTY)
  m(db.callRecording.findUnique).mockResolvedValue(REC)
  m(publishRecording).mockResolvedValue('ok')
  m(unpublishRecording).mockResolvedValue('ok')
  m(updateRecordingText).mockResolvedValue('ok')
  m(generateAndStoreSummary).mockResolvedValue(true)
  m(setSpeakerRedacted).mockResolvedValue(3)
  m(setSegmentRedacted).mockResolvedValue(true)
  m(rejectRecording).mockResolvedValue(true)
  m(getRecording).mockResolvedValue({ id: 'rec1', status: 'IN_REVIEW' })
  m(postCallRecap).mockResolvedValue('posted')
})

// The capo-allowed calls: [name, run, side effect that must (not) happen]
const capoCalls: Array<[string, () => Promise<Response>, () => unknown]> = [
  ['publish', () => publishPOST(req({ action: 'publish' }), ctx), () => publishRecording],
  ['unpublish', () => publishPOST(req({ action: 'unpublish' }), ctx), () => unpublishRecording],
  ['edit summary', () => summaryPATCH(req({ summary: 'new' }, 'PATCH'), ctx), () => updateRecordingText],
  ['regenerate', () => regeneratePOST(req(), ctx), () => generateAndStoreSummary],
  ['hide speaker', () => redactPOST(req({ discordId: '222222222222222222', confirm: true }), ctx), () => setSpeakerRedacted],
  ['hide line', () => redactLinePOST(req({ key: 'c:123456789', confirm: true }), ctx), () => setSegmentRedacted],
]

describe('toggle off: capos are refused everywhere, exactly like before', () => {
  for (const [name, run, effect] of capoCalls) {
    it(`${name}: 403 for a capo, nothing changes`, async () => {
      as('capo', false)
      expect((await run()).status).toBe(403)
      expect(effect()).not.toHaveBeenCalled()
      expect(recordCallReviewEvent).not.toHaveBeenCalled()
    })
  }
  it('hold: 403 for a capo', async () => {
    as('capo', false)
    expect((await holdPOST(req({ action: 'hold' }), ctx)).status).toBe(403)
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })
  it('the owner is unaffected by the toggle and never loads the capo guard row', async () => {
    as('owner', false)
    for (const [, run, effect] of capoCalls) {
      expect((await run()).status).toBe(200)
      expect(effect()).toHaveBeenCalled()
    }
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
  })
})

describe('toggle on: capos may use the widened routes', () => {
  for (const [name, run, effect] of capoCalls) {
    it(`${name}: allowed for a capo on a normal Discord call`, async () => {
      as('capo', true)
      expect((await run()).status).toBe(200)
      expect(effect()).toHaveBeenCalled()
    })
    it(`${name}: 404 for a capo on a held call`, async () => {
      as('capo', true)
      m(db.callRecording.findUnique).mockResolvedValue({ ...REC, reviewHoldAt: new Date() })
      expect((await run()).status).toBe(404)
      expect(effect()).not.toHaveBeenCalled()
    })
    it(`${name}: 404 for a capo on an imported call`, async () => {
      as('capo', true)
      m(db.callRecording.findUnique).mockResolvedValue({ ...REC, source: 'X_BROADCAST' })
      expect((await run()).status).toBe(404)
      expect(effect()).not.toHaveBeenCalled()
    })
    it(`${name}: 404 for a capo when the owner-only filter holds the call`, async () => {
      as('capo', true)
      m(loadPostFilter).mockResolvedValue({ ...EMPTY, ownerOnlyTerms: ['plain'] })
      expect((await run()).status).toBe(404)
      expect(effect()).not.toHaveBeenCalled()
    })
    it(`${name}: 403 for someone who is neither capo nor owner`, async () => {
      as('nobody', true)
      expect((await run()).status).toBe(403)
      expect(effect()).not.toHaveBeenCalled()
    })
  }
})

describe('capo publish guard', () => {
  it('refuses with a 409 when lines were hidden after the summary was written, without publishing', async () => {
    as('capo', true)
    m(db.callRecording.findUnique).mockResolvedValue({ ...REC, redactionsUpdatedAt: new Date('2026-11-02T10:00:00Z') })
    const res = await publishPOST(req({ action: 'publish' }), ctx)
    expect(res.status).toBe(409)
    expect(publishRecording).not.toHaveBeenCalled()
    expect(postCallRecap).not.toHaveBeenCalled()
  })
  it('publishes once the summary was edited after the hide', async () => {
    as('capo', true)
    m(db.callRecording.findUnique).mockResolvedValue({ ...REC, redactionsUpdatedAt: new Date('2026-11-02T10:00:00Z'), summaryEditedAt: new Date('2026-11-03T10:00:00Z') })
    expect((await publishPOST(req({ action: 'publish' }), ctx)).status).toBe(200)
    expect(publishRecording).toHaveBeenCalledWith('rec1', '9')
  })
  it('an unpublish is not blocked by newer redactions', async () => {
    as('capo', true)
    m(db.callRecording.findUnique).mockResolvedValue({ ...REC, redactionsUpdatedAt: new Date('2026-11-02T10:00:00Z') })
    expect((await publishPOST(req({ action: 'unpublish' }), ctx)).status).toBe(200)
  })
  it('the owner is not blocked (as today: the recap just reports stale-redactions)', async () => {
    as('owner', true)
    m(postCallRecap).mockResolvedValue('stale-redactions')
    const res = await publishPOST(req({ action: 'publish' }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).recap).toBe('stale-redactions')
    expect(publishRecording).toHaveBeenCalled()
  })
})

describe('owner-only routes still refuse capos (toggle on)', () => {
  const ownerOnly: Array<[string, () => Promise<Response>]> = [
    ['audio', () => audioGET(req(undefined, 'GET'), ctx)],
    ['remove', () => removePOST(req({ confirm: true }), ctx)],
    ['retry transcription', () => retryPOST(req(), ctx)],
    ['follow-ups', () => followupsPOST(req(), ctx)],
    ['recap repost', () => recapPOST(req(), ctx)],
    ['task proposals', () => taskProposalsPOST(req(), ctx)],
    ['bulk', () => bulkPOST(req({ action: 'publish', ids: ['abcdefgh1'], confirm: true }))],
    ['post filters (write)', () => filtersPUT(req({ blockedTerms: ['x'] }, 'PUT'))],
    ['post filters (read)', () => filtersGET()],
    ['restore speaker', () => redactPOST(req({ discordId: '222222222222222222', restore: true }), ctx)],
    ['restore line', () => redactLinePOST(req({ key: 'c:123456789', restore: true }), ctx)],
    ['release hold', () => holdPOST(req({ action: 'release' }), ctx)],
  ]
  for (const [name, run] of ownerOnly) {
    it(`${name}: 403 for a capo`, async () => {
      as('capo', true)
      expect((await run()).status).toBe(403)
      expect(rejectRecording).not.toHaveBeenCalled()
      expect(setSpeakerRedacted).not.toHaveBeenCalled()
      expect(setSegmentRedacted).not.toHaveBeenCalled()
      expect(db.callRecording.updateMany).not.toHaveBeenCalled()
      expect(recordCallReviewEvent).not.toHaveBeenCalled()
    })
  }
})

describe('hold', () => {
  it('a capo can put a call on hold, audited', async () => {
    as('capo', true)
    m(db.callRecording.updateMany).mockResolvedValue({ count: 1 })
    const res = await holdPOST(req({ action: 'hold', note: '  private note  ' }), ctx)
    expect(res.status).toBe(200)
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'rec1', reviewHoldAt: null }, data: expect.objectContaining({ reviewHoldBy: '9', reviewHoldNote: 'private note', reviewHoldAt: expect.any(Date) }) })
    expect(recordCallReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ recordingId: 'rec1', actorId: '9', action: 'hold', via: 'web' }), expect.anything())
  })
  it('a second hold is a 409; an over-long note a 400', async () => {
    as('capo', true)
    m(db.callRecording.updateMany).mockResolvedValue({ count: 0 })
    m(db.callRecording.findUnique).mockResolvedValue(REC)
    expect((await holdPOST(req({ action: 'hold' }), ctx)).status).toBe(409)
    expect((await holdPOST(req({ action: 'hold', note: 'x'.repeat(301) }), ctx)).status).toBe(400)
  })
  it('the owner can release a hold, audited', async () => {
    as('owner', true)
    m(db.callRecording.updateMany).mockResolvedValue({ count: 1 })
    expect((await holdPOST(req({ action: 'release' }), ctx)).status).toBe(200)
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'rec1', reviewHoldAt: { not: null } }, data: { reviewHoldAt: null, reviewHoldBy: null, reviewHoldNote: null } })
    expect(recordCallReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'release', via: 'web' }), expect.anything())
  })
  it('the owner can hold even an imported call; a held call is then invisible to a capo', async () => {
    as('owner', true)
    m(db.callRecording.updateMany).mockResolvedValue({ count: 1 })
    expect((await holdPOST(req({ action: 'hold' }), ctx)).status).toBe(200)
    as('capo', true)
    m(db.callRecording.findUnique).mockResolvedValue({ ...REC, reviewHoldAt: new Date() })
    expect((await publishPOST(req({ action: 'publish' }), ctx)).status).toBe(404)
  })
  it('a bad action is a 400', async () => {
    as('capo', true)
    expect((await holdPOST(req({ action: 'nope' }), ctx)).status).toBe(400)
  })
})

describe('audit events (via web)', () => {
  const ev = (action: string, metadata?: unknown) => expect(recordCallReviewEvent).toHaveBeenCalledWith({ recordingId: 'rec1', actorId: '9', action, via: 'web', ...(metadata ? { metadata } : {}) })

  it('publish records the recap result, unpublish just the action', async () => {
    as('capo', true)
    await publishPOST(req({ action: 'publish' }), ctx)
    ev('publish', { recap: 'posted' })
    await publishPOST(req({ action: 'unpublish' }), ctx)
    ev('unpublish')
  })
  it('a re-click on an already published call records nothing', async () => {
    as('capo', true)
    m(publishRecording).mockResolvedValue('already')
    await publishPOST(req({ action: 'publish' }), ctx)
    expect(recordCallReviewEvent).not.toHaveBeenCalled()
  })
  it('a failed publish records nothing', async () => {
    as('capo', true)
    m(publishRecording).mockResolvedValue('conflict')
    expect((await publishPOST(req({ action: 'publish' }), ctx)).status).toBe(409)
    expect(recordCallReviewEvent).not.toHaveBeenCalled()
  })
  it('summary edit, regenerate and hide are recorded without any text', async () => {
    as('capo', true)
    await summaryPATCH(req({ summary: 'secret text' }, 'PATCH'), ctx)
    ev('summary_edit')
    await regeneratePOST(req(), ctx)
    ev('regenerate')
    await redactPOST(req({ discordId: '222222222222222222', confirm: true }), ctx)
    ev('redact', { kind: 'speaker', restore: false })
    await redactLinePOST(req({ key: 'c:123456789', confirm: true }), ctx)
    ev('redact', { kind: 'line', restore: false })
    expect(JSON.stringify(m(recordCallReviewEvent).mock.calls)).not.toContain('secret text')
  })
  it('owner actions are recorded too: restore and remove', async () => {
    as('owner', true)
    await redactPOST(req({ discordId: '222222222222222222', restore: true }), ctx)
    ev('redact', { kind: 'speaker', restore: true })
    await removePOST(req({ confirm: true }), ctx)
    ev('reject')
  })
})
