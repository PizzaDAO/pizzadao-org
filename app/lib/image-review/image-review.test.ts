// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: { discordId: 'u1' } as { discordId: string } | null,
  owner: false,
  capo: false,
  votes: new Map<string, { vote: string; comment: string | null }>(),
}))

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(async () => h.session) }))
vi.mock('@/app/lib/mission-review-access', () => ({
  isDreadPizzaRoberts: vi.fn(async () => h.owner),
  resolveRoles: vi.fn(async () => []),
  holdsAny: vi.fn(async () => h.capo),
}))
vi.mock('@/app/lib/member-names', () => ({ memberNamesByDiscordId: vi.fn(async () => new Map()) }))
vi.mock('@/app/lib/db', () => ({
  prisma: {
    imageReviewCandidate: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'c1' ? { id: 'c1' } : null)) },
    imageReviewVote: {
      upsert: vi.fn(async ({ where, create, update }: { where: { candidateId_discordId: { candidateId: string; discordId: string } }; create: { vote: string; comment: string | null }; update: { vote: string; comment: string | null } }) => {
        const k = `${where.candidateId_discordId.candidateId}:${where.candidateId_discordId.discordId}`
        h.votes.set(k, h.votes.has(k) ? update : create)
      }),
    },
  },
}))

import { imageReviewRole, requireImageReviewer } from './access'
import { buildCandidateViews, castVote, exportCsv, MAX_COMMENT, parseVote } from './data'

beforeEach(() => {
  h.session = { discordId: 'u1' }
  h.owner = false
  h.capo = false
  h.votes.clear()
})

describe('access matrix', () => {
  it('logged out is 401', async () => {
    h.session = null
    const a = await requireImageReviewer()
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.response.status).toBe(401)
  })
  it('non-capo is 403', async () => {
    const a = await requireImageReviewer()
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.response.status).toBe(403)
    expect(await imageReviewRole('u1')).toBeNull()
  })
  it('capo is allowed but not owner-only routes', async () => {
    h.capo = true
    expect((await requireImageReviewer()).ok).toBe(true)
    const o = await requireImageReviewer({ ownerOnly: true })
    expect(o.ok).toBe(false)
    if (!o.ok) expect(o.response.status).toBe(403)
  })
  it('owner passes everything', async () => {
    h.owner = true
    const o = await requireImageReviewer({ ownerOnly: true })
    expect(o.ok && o.role).toBe('owner')
  })
})

describe('vote parsing', () => {
  it('accepts YES/NO and trims the comment', () => {
    const r = parseVote({ candidateId: 'c1', vote: 'YES', comment: '  nice  ' })
    expect(r).toEqual({ ok: true, value: { candidateId: 'c1', vote: 'YES', comment: 'nice' } })
  })
  it('rejects a bad vote or missing candidate', () => {
    expect(parseVote({ candidateId: 'c1', vote: 'MAYBE' }).ok).toBe(false)
    expect(parseVote({ vote: 'YES' }).ok).toBe(false)
  })
  it('enforces the comment length', () => {
    expect(parseVote({ candidateId: 'c1', vote: 'NO', comment: 'x'.repeat(MAX_COMMENT) }).ok).toBe(true)
    expect(parseVote({ candidateId: 'c1', vote: 'NO', comment: 'x'.repeat(MAX_COMMENT + 1) }).ok).toBe(false)
  })
})

describe('vote upsert', () => {
  it('keeps one changeable vote per capo per image', async () => {
    expect(await castVote('dough-ball', 'u1', { candidateId: 'c1', vote: 'YES', comment: null })).toBe(true)
    expect(await castVote('dough-ball', 'u1', { candidateId: 'c1', vote: 'NO', comment: 'too pale' })).toBe(true)
    expect(h.votes.size).toBe(1)
    expect(h.votes.get('c1:u1')).toEqual({ vote: 'NO', comment: 'too pale' })
    await castVote('dough-ball', 'u2', { candidateId: 'c1', vote: 'YES', comment: null })
    expect(h.votes.size).toBe(2)
  })
  it('refuses a candidate outside the set', async () => {
    expect(await castVote('dough-ball', 'u1', { candidateId: 'nope', vote: 'YES', comment: null })).toBe(false)
  })
})

describe('views and export', () => {
  const rows = [
    {
      id: 'c1',
      imageUrl: 'https://x/1.png',
      prompt: 'p "quoted"',
      traits: { expression: 'wink', pose: 'salute' },
      position: 0,
      votes: [
        { discordId: 'u1', vote: 'YES' as const, comment: 'love it', updatedAt: new Date(1) },
        { discordId: 'u2', vote: 'NO' as const, comment: '=SUM(A1)', updatedAt: new Date(2) },
      ],
    },
  ]
  it('tallies and marks my vote', () => {
    const [v] = buildCandidateViews(rows, 'u1', new Map([['u2', { name: 'Tony' }]]))
    expect([v.yes, v.no]).toEqual([1, 1])
    expect(v.mine).toEqual({ vote: 'YES', comment: 'love it' })
    expect(v.comments.map((c) => c.name)).toEqual(['A capo', 'Tony'])
  })
  it('exports csv with traits, counts, escaped quotes and neutralized formulas', () => {
    const csv = exportCsv([{ position: 0, imageUrl: 'u', prompt: 'p "q"', traits: { expression: 'wink' }, yes: 1, no: 1, comments: ['=bad'] }])
    const [head, line] = csv.trim().split('\n')
    expect(head).toBe('"position","imageUrl","expression","yes","no","prompt","comments"')
    expect(line).toContain('"p ""q"""')
    expect(line).toContain("'=bad")
  })
})
