import { describe, expect, it, vi } from 'vitest'
import {
  handleTaskProposalButton,
  runTaskProposalReview,
  type ProposalReviewDeps,
  type ProposalReviewJob,
  type ProposalReviewRunDeps,
  type ProposalReviewTarget,
} from '../task-proposal-review'
import type { ApplyOutcome } from '@/app/lib/call-tasks/apply'
import type { Interaction, InteractionResponse } from '../handle'

const ID = 'cmprop000000000000000001'
const URL = 'https://app.example.test/crew/ops#call-updates'

const target = (o: Partial<ProposalReviewTarget> = {}): ProposalReviewTarget => ({ id: ID, kind: 'UPDATE', status: 'PENDING', state: 'open', url: URL, ...o })

function click(customId: string, roles: string[] = ['role-x']): Interaction {
  return { type: 3, application_id: 'app1', token: 'tok1', guild_id: 'g', member: { user: { id: '111111111111111111' }, roles }, data: { custom_id: customId } }
}

const refuse = (headline: string, body?: string): InteractionResponse => ({ type: 4, data: { flags: 64, content: `REFUSED ${headline} ${body ?? ''}`, allowed_mentions: { parse: [] } } })
const refused = (r: InteractionResponse, text?: string) => r.type === 4 && String(r.data?.content).startsWith('REFUSED') && (!text || String(r.data?.content).includes(text))

function makeDeps(o: { role?: 'owner' | 'capo' | null; target?: ProposalReviewTarget | null; enabled?: boolean } = {}) {
  const jobs: ProposalReviewJob[] = []
  const refreshed: string[] = []
  const deps: ProposalReviewDeps = {
    enabled: () => o.enabled ?? true,
    roleFor: async () => (o.role === undefined ? 'capo' : o.role),
    target: async () => (o.target === undefined ? target() : o.target),
    run: (j) => void jobs.push(j),
    refresh: (id) => void refreshed.push(id),
  }
  return { deps, jobs, refreshed }
}

describe('task proposal buttons: refusals', () => {
  it('toggle off', async () => {
    const { deps, jobs } = makeDeps({ enabled: false })
    expect(refused(await handleTaskProposalButton(click(`tp:apply:${ID}`), 'u', deps, refuse), 'turned off')).toBe(true)
    expect(jobs).toHaveLength(0)
  })

  it('permission denied: not a capo or Dread Pizza Roberts (ephemeral, nothing runs)', async () => {
    const { deps, jobs } = makeDeps({ role: null })
    for (const id of [`tp:apply:${ID}`, `tp:dismiss:${ID}`, `tp:confirm:${ID}`]) {
      const r = await handleTaskProposalButton(click(id), 'u', deps, refuse)
      expect(refused(r, "can't decide")).toBe(true)
      expect(r.data?.flags).toBe(64)
    }
    expect(jobs).toHaveLength(0)
  })

  it('gone, or already decided (the card is refreshed)', async () => {
    expect(refused(await handleTaskProposalButton(click(`tp:apply:${ID}`), 'u', makeDeps({ target: null }).deps, refuse), 'no longer exists')).toBe(true)
    const { deps, refreshed, jobs } = makeDeps({ target: target({ status: 'APPLIED', state: 'applied' }) })
    expect(refused(await handleTaskProposalButton(click(`tp:dismiss:${ID}`), 'u', deps, refuse), 'Already decided')).toBe(true)
    expect(refreshed).toEqual([ID])
    expect(jobs).toHaveLength(0)
  })

  it('stale: the task changed since it was proposed: Apply refused with a link, the card refreshed; Dismiss still works', async () => {
    const { deps, refreshed, jobs } = makeDeps({ target: target({ state: 'changed' }) })
    const r = await handleTaskProposalButton(click(`tp:apply:${ID}`), 'u', deps, refuse)
    expect(refused(r, 'task changed')).toBe(true)
    expect(String(r.data?.content)).toContain(URL)
    expect(refreshed).toEqual([ID])
    expect(jobs).toHaveLength(0)
    expect((await handleTaskProposalButton(click(`tp:dismiss:${ID}`), 'u', deps, refuse)).type).toBe(5)
    expect(jobs.map((j) => j.action)).toEqual(['dismiss'])
  })

  it('needs the website (ambiguous lead): Apply and Confirm refused, Dismiss allowed', async () => {
    const { deps, jobs } = makeDeps({ target: target({ state: 'needs-website' }) })
    expect(refused(await handleTaskProposalButton(click(`tp:apply:${ID}`), 'u', deps, refuse), 'needs the website')).toBe(true)
    expect(refused(await handleTaskProposalButton(click(`tp:confirm:${ID}`), 'u', deps, refuse), 'needs the website')).toBe(true)
    await handleTaskProposalButton(click(`tp:dismiss:${ID}`), 'u', deps, refuse)
    expect(jobs.map((j) => j.action)).toEqual(['dismiss'])
  })

  it('hidden: reviewed on the website only', async () => {
    const { deps, jobs } = makeDeps({ target: target({ state: 'hidden' }) })
    expect(refused(await handleTaskProposalButton(click(`tp:dismiss:${ID}`), 'u', deps, refuse), 'website only')).toBe(true)
    expect(jobs).toHaveLength(0)
  })

  it('malformed ids', async () => {
    const { deps } = makeDeps()
    expect(refused(await handleTaskProposalButton(click('tp:apply:x'), 'u', deps, refuse), 'Unknown button')).toBe(true)
    expect(refused(await handleTaskProposalButton(click(`tp:nope:${ID}`), 'u', deps, refuse), 'Unknown button')).toBe(true)
  })
})

describe('task proposal buttons: accepted', () => {
  it('Apply / Dismiss: a deferred ephemeral reply and a job; Confirm: a deferred update', async () => {
    const { deps, jobs } = makeDeps()
    const a = await handleTaskProposalButton(click(`tp:apply:${ID}`), '111111111111111111', deps, refuse)
    expect(a).toEqual({ type: 5, data: { flags: 64, allowed_mentions: { parse: [] } } })
    expect(jobs[0]).toMatchObject({ action: 'apply', proposalId: ID, userId: '111111111111111111', url: URL, applicationId: 'app1', token: 'tok1' })
    expect((await handleTaskProposalButton(click(`tp:dismiss:${ID}`), 'u', deps, refuse)).type).toBe(5)
    expect((await handleTaskProposalButton(click(`tp:confirm:${ID}`), 'u', deps, refuse)).type).toBe(6)
    expect(jobs.map((j) => j.action)).toEqual(['apply', 'dismiss', 'confirm'])
  })

  it('the owner (Dread Pizza Roberts) may press too', async () => {
    const { deps, jobs } = makeDeps({ role: 'owner' })
    await handleTaskProposalButton(click(`tp:apply:${ID}`), 'u', deps, refuse)
    expect(jobs).toHaveLength(1)
  })

  it('Cancel just clears the reply', async () => {
    const r = await handleTaskProposalButton(click(`tp:cancel:${ID}`), 'u', makeDeps().deps, refuse)
    expect(r.type).toBe(7)
    expect(r.data?.components).toEqual([])
  })
})

describe('runTaskProposalReview', () => {
  const job = (o: Partial<ProposalReviewJob> = {}): ProposalReviewJob => ({ action: 'apply', proposalId: ID, kind: 'UPDATE', userId: 'u1', url: URL, applicationId: 'app1', token: 'tok1', ...o })
  function runDeps(applyResult: ApplyOutcome = { result: 'applied', taskId: 't1' }) {
    const edits: Array<{ embeds: Array<{ description?: string }>; components: unknown[] }> = []
    const deps: ProposalReviewRunDeps = {
      apply: vi.fn(async () => applyResult),
      dismiss: vi.fn(async () => 'dismissed' as const),
      syncCard: vi.fn(async () => 'edited'),
      edit: async (_a, _t, body) => void edits.push(body),
    }
    return { deps, edits }
  }

  it('apply calls the shared apply (not confirmed, never forced), refreshes the card and says so', async () => {
    const { deps, edits } = runDeps()
    expect(await runTaskProposalReview(job(), deps)).toBe('applied')
    expect(deps.apply).toHaveBeenCalledWith(ID, 'u1', false)
    expect(deps.syncCard).toHaveBeenCalledWith(ID)
    expect(edits[0].embeds[0].description).toContain('Applied.')
  })

  it('dismiss calls the shared dismiss and refreshes the card', async () => {
    const { deps, edits } = runDeps()
    expect(await runTaskProposalReview(job({ action: 'dismiss' }), deps)).toBe('dismissed')
    expect(deps.dismiss).toHaveBeenCalledWith(ID, 'u1')
    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.syncCard).toHaveBeenCalledWith(ID)
    expect(edits[0].embeds[0].description).toContain('Dismissed.')
  })

  it('a change that closes a task asks to confirm; Confirm applies it confirmed', async () => {
    const a = runDeps({ result: 'needs-confirm' })
    expect(await runTaskProposalReview(job({ kind: 'DONE' }), a.deps)).toBe('needs-confirm')
    expect(a.edits[0].embeds[0].description).toContain('marks the task done')
    const ids = (a.edits[0].components[0] as { components: Array<{ custom_id: string }> }).components.map((c) => c.custom_id)
    expect(ids).toEqual([`tp:confirm:${ID}`, `tp:cancel:${ID}`])
    const b = runDeps()
    await runTaskProposalReview(job({ action: 'confirm', kind: 'DONE' }), b.deps)
    expect(b.deps.apply).toHaveBeenCalledWith(ID, 'u1', true)
  })

  it('stale: a conflict changes nothing, says so with a link and refreshes the card', async () => {
    const { deps, edits } = runDeps({ result: 'conflict', current: { label: 'x', stage: 'doing', priority: null, due: null, leadName: null } })
    expect(await runTaskProposalReview(job(), deps)).toBe('conflict')
    expect(edits[0].embeds[0].description).toContain('task changed since')
    expect(edits[0].embeds[0].description).toContain(URL)
    expect(deps.syncCard).toHaveBeenCalled()
  })

  it('a throw is reported, never rethrown', async () => {
    const { deps, edits } = runDeps()
    deps.apply = async () => {
      throw new Error('db')
    }
    expect(await runTaskProposalReview(job(), deps)).toBe('error')
    expect(edits[0].embeds[0].description).toContain('Nothing was changed')
  })
})
