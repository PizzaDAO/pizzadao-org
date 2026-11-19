// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: { discordId: 'u1' } as { discordId: string } | null,
  owner: false,
  capo: false,
  current: 3 as number | 'throw',
  minLevel: 2,
  setComments: new Map<string, string>(),
  votes: new Map<string, { vote: string; comment: string | null }>(),
}))

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(async () => h.session) }))
vi.mock('@/app/lib/mission-review-access', () => ({
  isDreadPizzaRoberts: vi.fn(async () => h.owner),
  resolveRoles: vi.fn(async () => []),
  holdsAny: vi.fn(async () => h.capo),
}))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => h.minLevel) }))
vi.mock('@/app/lib/missions', () => ({
  getCurrentLevel: vi.fn(async () => {
    if (h.current === 'throw') throw new Error('db down')
    return h.current
  }),
}))
vi.mock('@/app/lib/member-names', () => ({ memberNamesByDiscordId: vi.fn(async () => new Map()) }))
vi.mock('@/app/lib/db', () => ({
  prisma: {
    imageReviewSet: { findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => (where.slug === 'dough-ball' ? { id: 's1' } : null)) },
    imageReviewSetComment: {
      upsert: vi.fn(async ({ where, create, update }: { where: { setId_discordId: { setId: string; discordId: string } }; create: { comment: string }; update: { comment: string } }) => {
        const k = `${where.setId_discordId.setId}:${where.setId_discordId.discordId}`
        h.setComments.set(k, h.setComments.has(k) ? update.comment : create.comment)
      }),
      deleteMany: vi.fn(async ({ where }: { where: { setId: string; discordId: string } }) => {
        h.setComments.delete(`${where.setId}:${where.discordId}`)
      }),
    },
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
import { buildCandidateViews, buildSetComments, castVote, exportCsv, exportSetComments, MAX_COMMENT, MAX_SET_COMMENT, parseSetComment, parseVote, saveSetComment } from './data'

beforeEach(() => {
  h.session = { discordId: 'u1' }
  h.owner = false
  h.capo = false
  h.votes.clear()
  h.setComments.clear()
  h.current = 3
  h.minLevel = 2
})

describe('access matrix', () => {
  it('logged out is 401', async () => {
    h.session = null
    const a = await requireImageReviewer()
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.response.status).toBe(401)
  })
  it('member below the minimum level is 403 (level 1 done = working on 2)', async () => {
    h.current = 2
    const a = await requireImageReviewer()
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.response.status).toBe(403)
    expect(await imageReviewRole('u1')).toBeNull()
  })
  it('member who completed level 2 (working on 3) is allowed but not owner-only', async () => {
    h.current = 3
    const a = await requireImageReviewer()
    expect(a.ok && a.role).toBe('member')
    const o = await requireImageReviewer({ ownerOnly: true })
    expect(o.ok).toBe(false)
  })
  it('the minimum comes from the setting', async () => {
    h.current = 3
    h.minLevel = 3
    expect(await imageReviewRole('u1')).toBeNull()
    h.minLevel = 1
    h.current = 2
    expect(await imageReviewRole('u1')).toBe('member')
  })
  it('unreadable level denies a plain member (fails closed)', async () => {
    h.current = 'throw'
    expect(await imageReviewRole('u1')).toBeNull()
  })
  it('capo is allowed at level 0 and when the level is unreadable', async () => {
    h.capo = true
    h.current = 'throw'
    expect(await imageReviewRole('u1')).toBe('capo')
  })
  it('owner is allowed at any level', async () => {
    h.owner = true
    h.current = 1
    expect(await imageReviewRole('u1')).toBe('owner')
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
    expect(v.comments.map((c) => c.name)).toEqual(['A member', 'Tony'])
  })
  it('exports csv with traits, counts, escaped quotes and neutralized formulas', () => {
    const csv = exportCsv([{ position: 0, imageUrl: 'u', prompt: 'p "q"', traits: { expression: 'wink' }, yes: 1, no: 1, comments: ['=bad'] }])
    const [head, line] = csv.trim().split('\n')
    expect(head).toBe('"position","imageUrl","expression","yes","no","prompt","comments"')
    expect(line).toContain('"p ""q"""')
    expect(line).toContain("'=bad")
  })
})

describe('overall set comment', () => {
  it('validates length and trims; empty clears', () => {
    expect(parseSetComment({ comment: '  hi  ' })).toEqual({ ok: true, value: 'hi' })
    expect(parseSetComment({ comment: '   ' })).toEqual({ ok: true, value: null })
    expect(parseSetComment({ comment: 'x'.repeat(MAX_SET_COMMENT) }).ok).toBe(true)
    expect(parseSetComment({ comment: 'x'.repeat(MAX_SET_COMMENT + 1) }).ok).toBe(false)
    expect(parseSetComment({ comment: 5 }).ok).toBe(false)
  })
  it('keeps one comment per member per set (upsert) and clears on empty', async () => {
    expect(await saveSetComment('dough-ball', 'u1', 'first')).toBe(true)
    expect(await saveSetComment('dough-ball', 'u1', 'second')).toBe(true)
    await saveSetComment('dough-ball', 'u2', 'other')
    expect(h.setComments.size).toBe(2)
    expect(h.setComments.get('s1:u1')).toBe('second')
    await saveSetComment('dough-ball', 'u1', null)
    expect(h.setComments.size).toBe(1)
  })
  it('refuses an unknown set', async () => {
    expect(await saveSetComment('nope', 'u1', 'x')).toBe(false)
  })
  it('shows to viewers with my own marked and is included in the export', () => {
    const rows = [
      { discordId: 'u2', comment: 'later', updatedAt: new Date(2) },
      { discordId: 'u1', comment: 'earlier', updatedAt: new Date(1) },
    ]
    const names = new Map([['u2', { name: 'Tony' }]])
    expect(buildSetComments(rows, 'u1', names)).toEqual([
      { name: 'A member', comment: 'earlier', mine: true },
      { name: 'Tony', comment: 'later', mine: false },
    ])
    const exported = exportSetComments(rows, names)
    expect(exported).toEqual(['A member: earlier', 'Tony: later'])
    const csv = exportCsv([], exported)
    expect(csv).toContain('"OVERALL"')
    expect(csv).toContain('"Tony: later"')
  })
})
