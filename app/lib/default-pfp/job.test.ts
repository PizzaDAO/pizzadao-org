// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { runDefaultPfpJob, GenerationRefused, type JobDeps, type JobSettings, type NeedyMember } from './job'
import { generationAllowance, isApproved, isAssignable, isVotedDown, buildAutoPrompt, pickAutoTraits, isSafeTrait, PROPS } from './rules'

const rules = { minYesVotes: 1, votedDownMargin: 1 }
const SETTINGS: JobSettings = {
  enabled: true,
  rules,
  recentActiveDays: 60,
  assignPerRun: 100,
  generate: { perRun: 10, dailyMax: 50, monthlyBudgetUsd: 25, costCents: 10 },
}

type Cand = { id: string; yes: number; no: number; traits: unknown }

/** In-memory store with the same uniqueness semantics as the database (one member per image and vice versa). */
function fakeStore(init: { cands?: Cand[]; needy?: NeedyMember[]; assigned?: Array<[string, string]>; active?: string[]; obsolete?: string[]; usage?: { last24h: number; monthSpentCents: number } }) {
  const cands = new Map((init.cands ?? []).map((c) => [c.id, c]))
  const byMember = new Map<string, string>(init.assigned ?? [])
  const byImage = new Map<string, string>([...byMember].map(([m, c]) => [c, m]))
  const usage = { ...(init.usage ?? { last24h: 0, monthSpentCents: 0 }) }
  const finished: Array<{ id: number; status: string; patch: unknown }> = []
  let genId = 0
  let n = 0
  const store: JobDeps['store'] & { _byMember: Map<string, string>; _cands: Map<string, Cand>; _finished: typeof finished } = {
    _byMember: byMember,
    _cands: cands,
    _finished: finished,
    async votedDownAssignments(r) {
      return [...byMember].filter(([, c]) => isVotedDown(cands.get(c)!, r)).map(([memberId, candidateId]) => ({ memberId, candidateId }))
    },
    async unassign(memberId, candidateId) {
      if (byMember.get(memberId) !== candidateId) return false
      byMember.delete(memberId)
      byImage.delete(candidateId)
      return true
    },
    async obsoleteAssignments() {
      return [...byMember].filter(([m]) => (init.obsolete ?? []).includes(m)).map(([memberId, candidateId]) => ({ memberId, candidateId }))
    },
    async allAssignments() {
      return [...byMember].map(([memberId, candidateId]) => ({ memberId, candidateId }))
    },
    async unassignedCandidates() {
      return [...cands.values()].filter((c) => !byImage.has(c.id))
    },
    async needyMembers() {
      return (init.needy ?? []).filter((m) => !byMember.has(m.memberId))
    },
    async recentlyActive() {
      return new Set(init.active ?? [])
    },
    async claim(memberId, candidateId) {
      await Promise.resolve() // yield: lets two concurrent runs interleave before the check
      if (byImage.has(candidateId) || byMember.has(memberId)) return false
      byMember.set(memberId, candidateId)
      byImage.set(candidateId, memberId)
      return true
    },
    async generationUsage() {
      return { ...usage }
    },
    async reserveGeneration(s) {
      if (generationAllowance(1, s, usage) < 1) return null
      usage.last24h++
      usage.monthSpentCents += s.costCents
      return ++genId
    },
    async finishGeneration(id, status, patch) {
      finished.push({ id, status, patch })
      if (status !== 'ok' && (patch as { costCents?: number }).costCents === 0) usage.monthSpentCents -= 10
    },
    async approvedTraits() {
      return []
    },
    async createCandidate({ imageUrl, traits }) {
      const id = `gen${++n}`
      cands.set(id, { id, yes: 0, no: 0, traits })
      void imageUrl
      return { id }
    },
  }
  return store
}

function deps(store: JobDeps['store'], over: Partial<JobDeps> = {}): JobDeps {
  return {
    settings: SETTINGS,
    now: () => new Date('2026-11-19T12:00:00Z'),
    rnd: Math.random,
    deadlineMs: Date.now() + 60_000,
    store,
    hasStaticPfp: () => false,
    generateImage: vi.fn(async () => Buffer.from('png')),
    uploadImage: vi.fn(async () => 'https://blob.example/auto.png'),
    invalidate: vi.fn(),
    ...over,
  }
}

const members = (n: number, prefix = 'm'): NeedyMember[] => Array.from({ length: n }, (_, i) => ({ memberId: `${prefix}${i}`, discordId: `${prefix}d${i}` }))
const approved = (id: string): Cand => ({ id, yes: 2, no: 0, traits: { round: 1 } })

describe('vote rules', () => {
  it('approved needs yes votes and more yes than no; voted down is no leading yes', () => {
    expect(isApproved({ yes: 1, no: 0 }, rules)).toBe(true)
    expect(isApproved({ yes: 0, no: 0 }, rules)).toBe(false)
    expect(isApproved({ yes: 2, no: 2 }, rules)).toBe(false)
    expect(isApproved({ yes: 2, no: 0 }, { ...rules, minYesVotes: 3 })).toBe(false)
    expect(isVotedDown({ yes: 1, no: 2 }, rules)).toBe(true)
    expect(isVotedDown({ yes: 2, no: 2 }, rules)).toBe(false)
    expect(isVotedDown({ yes: 1, no: 2 }, { ...rules, votedDownMargin: 2 })).toBe(false)
  })
  it('unvoted generated images are assignable, unvoted reviewed ones are not, voted down never', () => {
    expect(isAssignable({ id: 'a', yes: 0, no: 0, traits: { round: 'auto' } }, rules)).toBe(true)
    expect(isAssignable({ id: 'a', yes: 0, no: 0, traits: { round: 1 } }, rules)).toBe(false)
    expect(isAssignable({ id: 'a', yes: 0, no: 3, traits: { round: 'auto' } }, rules)).toBe(false)
  })
})

describe('generation caps', () => {
  const s = SETTINGS.generate
  it('is bounded by need, per run, daily max and the monthly budget', () => {
    const u = { last24h: 0, monthSpentCents: 0 }
    expect(generationAllowance(3, s, u)).toBe(3)
    expect(generationAllowance(99, s, u)).toBe(10)
    expect(generationAllowance(99, s, { last24h: 45, monthSpentCents: 0 })).toBe(5)
    expect(generationAllowance(99, s, { last24h: 0, monthSpentCents: 2450 })).toBe(5)
    expect(generationAllowance(99, s, { last24h: 0, monthSpentCents: 2500 })).toBe(0)
    expect(generationAllowance(99, { ...s, perRun: 0 }, u)).toBe(0)
  })
})

describe('prompt', () => {
  it('carries the base description and the round rules, with a safe curated prop', () => {
    const t = pickAutoTraits([], () => 0)
    const p = buildAutoPrompt('BASE', t)
    expect(p.startsWith('BASE')).toBe(true)
    expect(p).toMatch(/NO weapons of any kind/)
    expect(p).toMatch(/never a tie combined with a necklace/)
    expect(t.round).toBe('auto')
    for (const prop of PROPS) expect(isSafeTrait(prop)).toBe(true)
    expect(isSafeTrait('a golden pizza-cutter pendant')).toBe(false)
  })
})

describe('runDefaultPfpJob', () => {
  it('toggle off: does nothing, touches nothing', async () => {
    const store = fakeStore({ cands: [approved('c1')], needy: members(1) })
    const spy = vi.spyOn(store, 'needyMembers')
    const d = deps(store, { settings: { ...SETTINGS, enabled: false } })
    const r = await runDefaultPfpJob(d, 'BASE')
    expect(r.skipped).toBe('disabled')
    expect(spy).not.toHaveBeenCalled()
    expect(store._byMember.size).toBe(0)
    expect(d.generateImage).not.toHaveBeenCalled()
  })

  it('pool first, then generate for the rest; each image goes to one member', async () => {
    const store = fakeStore({ cands: [approved('c1'), approved('c2')], needy: members(5) })
    const d = deps(store)
    const r = await runDefaultPfpJob(d, 'BASE')
    expect(r.assignedFromPool).toBe(2)
    expect(r.generated).toBe(3)
    expect(r.assignedGenerated).toBe(3)
    expect(d.generateImage).toHaveBeenCalledTimes(3)
    expect(store._byMember.size).toBe(5)
    expect(new Set(store._byMember.values()).size).toBe(5)
    expect(d.invalidate).toHaveBeenCalledTimes(5)
    // generated images are inserted as auto candidates
    expect([...store._cands.values()].filter((c) => (c.traits as { round?: string }).round === 'auto')).toHaveLength(3)
  })

  it('does not generate while the pool still has images', async () => {
    const store = fakeStore({ cands: [approved('c1'), approved('c2'), approved('c3')], needy: members(2) })
    const d = deps(store)
    await runDefaultPfpJob(d, 'BASE')
    expect(d.generateImage).not.toHaveBeenCalled()
  })

  it('never assigns an unapproved, unvoted reviewed image or a voted-down one', async () => {
    const store = fakeStore({
      cands: [
        { id: 'unvoted', yes: 0, no: 0, traits: { round: 1 } },
        { id: 'down', yes: 0, no: 2, traits: { round: 1 } },
      ],
      needy: members(1),
    })
    const d = deps(store, { settings: { ...SETTINGS, generate: { ...SETTINGS.generate, perRun: 0 } } })
    const r = await runDefaultPfpJob(d, 'BASE')
    expect(r.assignedFromPool).toBe(0)
    expect(store._byMember.size).toBe(0)
    expect(r.stillNeedy).toBe(1)
  })

  it('two concurrent runs never give one image to two members', async () => {
    const store = fakeStore({ cands: Array.from({ length: 8 }, (_, i) => approved(`c${i}`)), needy: members(8) })
    await Promise.all([runDefaultPfpJob(deps(store), 'BASE'), runDefaultPfpJob(deps(store), 'BASE'), runDefaultPfpJob(deps(store), 'BASE')])
    const images = [...store._byMember.values()]
    expect(new Set(images).size).toBe(images.length)
    expect(store._byMember.size).toBe(8)
  })

  it('respects the per-run cap', async () => {
    const store = fakeStore({ needy: members(30) })
    const d = deps(store)
    const r = await runDefaultPfpJob(d, 'BASE')
    expect(r.generated).toBe(10)
    expect(r.stillNeedy).toBe(20)
  })

  it('respects the daily max and the monthly budget', async () => {
    const daily = fakeStore({ needy: members(30), usage: { last24h: 47, monthSpentCents: 0 } })
    expect((await runDefaultPfpJob(deps(daily), 'BASE')).generated).toBe(3)
    const budget = fakeStore({ needy: members(30), usage: { last24h: 0, monthSpentCents: 2480 } })
    expect((await runDefaultPfpJob(deps(budget), 'BASE')).generated).toBe(2)
    const spent = fakeStore({ needy: members(30), usage: { last24h: 0, monthSpentCents: 2500 } })
    const d = deps(spent)
    expect((await runDefaultPfpJob(d, 'BASE')).generated).toBe(0)
    expect(d.generateImage).not.toHaveBeenCalled()
  })

  it('stops after repeated failures and books a refusal at no cost', async () => {
    const store = fakeStore({ needy: members(20) })
    const d = deps(store, { generateImage: vi.fn(async () => { throw new GenerationRefused('no') }), concurrency: 1 })
    const r = await runDefaultPfpJob(d, 'BASE')
    expect(r.generated).toBe(0)
    expect(r.generateFailed).toBe(3)
    expect(store._finished.every((f) => f.status === 'refused' && (f.patch as { costCents: number }).costCents === 0)).toBe(true)
  })

  it('recently active members are served first', async () => {
    const needy = members(6)
    const store = fakeStore({ cands: [approved('c1'), approved('c2')], needy, active: ['md4', 'md5'] })
    await runDefaultPfpJob(deps(store, { settings: { ...SETTINGS, generate: { ...SETTINGS.generate, perRun: 0 } } }), 'BASE')
    expect([...store._byMember.keys()].sort()).toEqual(['m4', 'm5'])
  })

  it('members with static art are skipped', async () => {
    const store = fakeStore({ cands: [approved('c1')], needy: members(2) })
    await runDefaultPfpJob(deps(store, { hasStaticPfp: (id) => id === 'm0' }), 'BASE')
    expect([...store._byMember.keys()]).toEqual(['m1'])
  })

  it('keeps the booked cost when upload or the database fails after the image was generated', async () => {
    const up = fakeStore({ needy: members(1) })
    const r1 = await runDefaultPfpJob(deps(up, { uploadImage: vi.fn(async () => { throw new Error('blob down') }) }), 'BASE')
    expect(r1.generateFailed).toBe(1)
    expect(up._finished[0]).toMatchObject({ status: 'error', patch: {} })
    const db = fakeStore({ needy: members(1) })
    vi.spyOn(db, 'createCandidate').mockRejectedValue(new Error('db down'))
    await runDefaultPfpJob(deps(db), 'BASE')
    expect(db._finished[0]).toMatchObject({ status: 'error', patch: {} })
    // a failure before any image exists is free
    const none = fakeStore({ needy: members(1) })
    await runDefaultPfpJob(deps(none, { generateImage: vi.fn(async () => { throw new Error('http 500') }) }), 'BASE')
    expect(none._finished[0]).toMatchObject({ status: 'error', patch: { costCents: 0 } })
  })

  it('frees the dough ball of a member who now has composed art, static art or was merged', async () => {
    const store = fakeStore({
      cands: [approved('a'), approved('b'), approved('c')],
      assigned: [['m0', 'a'], ['m1', 'b'], ['m2', 'c']],
      obsolete: ['m0'],
    })
    const d = deps(store, { hasStaticPfp: (id) => id === 'm1' })
    const r = await runDefaultPfpJob(d, 'BASE')
    expect(r.released).toBe(2)
    expect([...store._byMember.keys()]).toEqual(['m2'])
    expect(d.invalidate).toHaveBeenCalledWith('m0')
    expect(d.invalidate).toHaveBeenCalledWith('m1')
  })

  it('reassigns a member whose image was voted down, and never gives that image out again', async () => {
    const store = fakeStore({
      cands: [{ id: 'bad', yes: 0, no: 2, traits: { round: 'auto' } }, approved('good')],
      needy: members(1),
      assigned: [['m0', 'bad']],
    })
    const d = deps(store)
    const r = await runDefaultPfpJob(d, 'BASE')
    expect(r.reassigned).toBe(1)
    expect(store._byMember.get('m0')).toBe('good')
    expect([...store._byMember.values()]).not.toContain('bad')
    expect(d.invalidate).toHaveBeenCalledWith('m0')
  })

  it('reassigns by generating when no approved image is left', async () => {
    const store = fakeStore({ cands: [{ id: 'bad', yes: 0, no: 2, traits: { round: 'auto' } }], needy: members(1), assigned: [['m0', 'bad']] })
    const r = await runDefaultPfpJob(deps(store), 'BASE')
    expect(r.reassigned).toBe(1)
    expect(r.assignedGenerated).toBe(1)
    expect(store._byMember.get('m0')).toMatch(/^gen/)
  })
})
