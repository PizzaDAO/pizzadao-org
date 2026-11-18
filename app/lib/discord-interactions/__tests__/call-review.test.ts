import { describe, expect, it, vi } from 'vitest'
import { handleCallReviewButton, type CallReviewDeps, type CallReviewJob, type CallReviewRole, type CallReviewTarget } from '../call-review'
import { runCallReview, type CallReviewRunDeps, type PublishOutcome, type RecapOutcome } from '../call-review-run'
import type { Interaction, InteractionResponse } from '../handle'

const ID = 'cmcall0000000000000000001'
const V = 'm1abc'
const APP = 'https://app.example.test'

const target = (o: Partial<CallReviewTarget> = {}): CallReviewTarget => ({
  id: ID,
  source: 'DISCORD',
  status: 'IN_REVIEW',
  version: V,
  hasSummary: true,
  held: false,
  staleRedactions: false,
  ...o,
})

function click(customId: string, roles: string[] = ['role-x']): Interaction {
  return { type: 3, application_id: 'app1', token: 'tok1', guild_id: 'g', member: { user: { id: '111111111111111111' }, roles }, data: { custom_id: customId } }
}

const refuse = (headline: string, body?: string): InteractionResponse => ({ type: 4, data: { flags: 64, content: `REFUSED ${headline} ${body ?? ''}`, allowed_mentions: { parse: [] } } })
const refused = (r: InteractionResponse, text?: string) => r.type === 4 && String(r.data?.content).startsWith('REFUSED') && (!text || String(r.data?.content).includes(text))

function makeDeps(o: { role?: CallReviewRole | null; target?: CallReviewTarget | null; enabled?: boolean } = {}) {
  const jobs: CallReviewJob[] = []
  const refreshed: string[] = []
  const deps: CallReviewDeps = {
    enabled: () => o.enabled ?? true,
    roleFor: async () => (o.role === undefined ? 'capo' : o.role),
    target: async () => (o.target === undefined ? target() : o.target),
    run: (j) => void jobs.push(j),
    refresh: (id) => void refreshed.push(id),
    appUrl: APP,
  }
  return { deps, jobs, refreshed }
}

describe('call review buttons: refusals', () => {
  it('toggle off', async () => {
    const { deps, jobs } = makeDeps({ enabled: false })
    const r = await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', deps, refuse)
    expect(refused(r, 'turned off')).toBe(true)
    expect(String(r.data?.content)).toContain(`/admin/calls/${ID}`)
    expect(jobs).toHaveLength(0)
  })
  it('no role', async () => {
    const { deps, jobs } = makeDeps({ role: null })
    expect(refused(await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', deps, refuse), "can't review")).toBe(true)
    expect(refused(await handleCallReviewButton(click(`cr:hold:${ID}`), 'u', deps, refuse), "can't review")).toBe(true)
    expect(jobs).toHaveLength(0)
  })
  it('unknown id and imported calls', async () => {
    expect(refused(await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', makeDeps({ target: null }).deps, refuse), 'no longer exists')).toBe(true)
    expect(refused(await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', makeDeps({ target: target({ source: 'X_BROADCAST' }) }).deps, refuse), 'no longer exists')).toBe(true)
  })
  it('already published refreshes the card', async () => {
    const { deps, jobs, refreshed } = makeDeps({ target: target({ status: 'PUBLISHED' }) })
    expect(refused(await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', deps, refuse), 'Already handled')).toBe(true)
    expect(refreshed).toEqual([ID])
    expect(jobs).toHaveLength(0)
  })
  it('version mismatch is refused and refreshes the card', async () => {
    const { deps, jobs, refreshed } = makeDeps({ target: target({ version: 'zzz' }) })
    expect(refused(await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', deps, refuse), 'summary changed')).toBe(true)
    expect(refused(await handleCallReviewButton(click(`cr:confirm:${ID}:${V}`), 'u', deps, refuse), 'summary changed')).toBe(true)
    expect(refreshed).toEqual([ID, ID])
    expect(jobs).toHaveLength(0)
  })
  it('a capo is refused a held call, no summary, and stale redactions (with the website link)', async () => {
    for (const [t, text] of [
      [target({ held: true }), 'held for the owner'],
      [target({ hasSummary: false }), 'no summary'],
      [target({ staleRedactions: true }), 'Needs the website'],
    ] as const) {
      const { deps, jobs } = makeDeps({ target: t })
      const r = await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', deps, refuse)
      expect(refused(r, text)).toBe(true)
      expect(String(r.data?.content)).toContain(`/admin/calls/${ID}`)
      expect(jobs).toHaveLength(0)
    }
  })
  it('malformed and unknown cr: ids', async () => {
    const { deps } = makeDeps()
    expect(refused(await handleCallReviewButton(click('cr:approve:short'), 'u', deps, refuse), 'Unknown button')).toBe(true)
    expect(refused(await handleCallReviewButton(click('cr:nope:abcdefgh1234'), 'u', deps, refuse), 'Unknown button')).toBe(true)
  })
})

describe('call review buttons: accepted clicks', () => {
  it('a capo approving gets an ephemeral deferral and an approve job', async () => {
    const { deps, jobs } = makeDeps()
    const r = await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), '111111111111111111', deps, refuse)
    expect(r).toMatchObject({ type: 5, data: { flags: 64 } })
    expect(jobs).toEqual([{ action: 'approve', recordingId: ID, userId: '111111111111111111', role: 'capo', applicationId: 'app1', token: 'tok1' }])
  })
  it('confirm carries the confirmed version into the job; approve does not', async () => {
    const a = makeDeps()
    await handleCallReviewButton(click(`cr:confirm:${ID}:${V}`), 'u', a.deps, refuse)
    expect(a.jobs[0].version).toBe(V)
    const b = makeDeps()
    await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', b.deps, refuse)
    expect(b.jobs[0].version).toBeUndefined()
  })
  it('confirm is a deferred update', async () => {
    const { deps, jobs } = makeDeps()
    const r = await handleCallReviewButton(click(`cr:confirm:${ID}:${V}`), 'u', deps, refuse)
    expect(r.type).toBe(6)
    expect(jobs[0]).toMatchObject({ action: 'confirm', role: 'capo' })
  })
  it('the owner is accepted on a held call and over stale redactions', async () => {
    for (const t of [target({ held: true }), target({ staleRedactions: true })]) {
      const { deps, jobs } = makeDeps({ role: 'owner', target: t })
      expect((await handleCallReviewButton(click(`cr:approve:${ID}:${V}`), 'u', deps, refuse)).type).toBe(5)
      expect(jobs[0]).toMatchObject({ role: 'owner' })
    }
  })
  it('hold: any reviewer, even a stale card; no version needed', async () => {
    const { deps, jobs } = makeDeps({ target: target({ version: 'newer' }) })
    const r = await handleCallReviewButton(click(`cr:hold:${ID}`), 'u', deps, refuse)
    expect(r).toMatchObject({ type: 5, data: { flags: 64 } })
    expect(jobs[0]).toMatchObject({ action: 'hold' })
  })
  it('cancel dismisses the preview without any check', async () => {
    const { deps, jobs } = makeDeps({ role: null })
    const r = await handleCallReviewButton(click(`cr:cancel:${ID}`), 'u', deps, refuse)
    expect(r.type).toBe(7)
    expect(r.data?.components).toEqual([])
    expect(jobs).toHaveLength(0)
  })
})

function makeRun(o: { publish?: PublishOutcome; recap?: RecapOutcome; preview?: Awaited<ReturnType<CallReviewRunDeps['preview']>>; current?: Awaited<ReturnType<CallReviewRunDeps['current']>> } = {}) {
  const order: string[] = []
  const edits: Array<{ embeds: Array<{ description: string }>; components: unknown[] }> = []
  const audits: unknown[] = []
  const deps: CallReviewRunDeps = {
    preview: async () => (o.preview === undefined ? { text: 'RECAP TEXT', channelLabel: '#crew', postingOn: true, willSkip: false, version: V } : o.preview),
    publish: async (id, by, role, version) => (order.push(`publish:${role}:${by}:${version ?? '-'}`), o.publish ?? 'ok'),
    recap: async () => (order.push('recap'), o.recap ?? 'posted'),
    audit: async (ev) => void (order.push('audit'), audits.push(ev)),
    current: async () => o.current === undefined ? { status: 'IN_REVIEW', reviewedBy: null } : o.current,
    hold: async () => 'ok',
    syncCard: async () => void order.push('sync'),
    edit: async (_a, _t, body) => void (order.push('edit'), edits.push(body as never)),
    appUrl: APP,
  }
  return { deps, order, edits, audits }
}
const jobOf = (action: CallReviewJob['action'], role: CallReviewRole = 'capo'): CallReviewJob => ({ action, recordingId: ID, userId: '111111111111111111', role, ...(action === 'confirm' ? { version: V } : {}), applicationId: 'a', token: 't' })

describe('runCallReview', () => {
  it('approve: the preview shows the exact recap and target with Confirm carrying the version', async () => {
    const { deps, edits, order } = makeRun()
    expect(await runCallReview(jobOf('approve'), deps)).toBe('previewed')
    expect(order).toEqual(['edit']) // nothing is published by a preview
    expect(edits[0].embeds[0].description).toContain('RECAP TEXT')
    expect(edits[0].embeds[0].description).toContain('posted in #crew')
    const buttons = (edits[0].components[0] as { components: Array<{ custom_id: string }> }).components
    expect(buttons.map((b) => b.custom_id)).toEqual([`cr:confirm:${ID}:${V}`, `cr:cancel:${ID}`])
  })
  it('approve: says so when posting is off or no channel', async () => {
    const off = makeRun({ preview: { text: 't', channelLabel: '#c', postingOn: false, willSkip: false, version: V } })
    await runCallReview(jobOf('approve'), off.deps)
    expect(off.edits[0].embeds[0].description).toContain('posting is off')
    const none = makeRun({ preview: { text: 't', channelLabel: null, postingOn: true, willSkip: false, version: V } })
    await runCallReview(jobOf('approve'), none.deps)
    expect(none.edits[0].embeds[0].description).toContain('No recap will be posted')
  })
  it('approve: no preview means nothing offered', async () => {
    const { deps, edits } = makeRun({ preview: null })
    expect(await runCallReview(jobOf('approve'), deps)).toBe('no-preview')
    expect(edits[0].components).toEqual([])
  })
  it('confirm: publish (capo guard), then recap, audit, card sync, then the reply, in that order', async () => {
    const { deps, order, edits, audits } = makeRun()
    expect(await runCallReview(jobOf('confirm'), deps)).toBe('published')
    expect(order).toEqual([`publish:capo:111111111111111111:${V}`, 'recap', 'audit', 'sync', 'edit'])
    expect(audits).toEqual([{ recordingId: ID, actorId: '111111111111111111', recap: 'posted' }])
    expect(edits[0].embeds[0].description).toContain('Published.')
    expect(edits[0].embeds[0].description).toContain('recap was posted')
    expect(edits[0].components).toEqual([])
  })
  it('confirm: the owner publishes without the capo guard', async () => {
    const { deps, order } = makeRun()
    await runCallReview(jobOf('confirm', 'owner'), deps)
    expect(order[0]).toBe(`publish:owner:111111111111111111:${V}`)
  })
  it('confirm: a conflict shows the retry copy and posts nothing', async () => {
    const { deps, order, edits, audits } = makeRun({ publish: 'conflict' })
    expect(await runCallReview(jobOf('confirm'), deps)).toBe('conflict')
    expect(order).not.toContain('recap')
    expect(audits).toHaveLength(0)
    expect(edits[0].embeds[0].description).toContain('changed while publishing')
    expect(edits[0].embeds[0].description).toContain('/admin/calls/')
  })
  it('a losing double Confirm does not overwrite the winner\'s "Published." reply', async () => {
    for (const result of ['conflict', 'already'] as const) {
      const { deps, edits, order } = makeRun({ publish: result, current: { status: 'PUBLISHED', reviewedBy: '111111111111111111' } })
      expect(await runCallReview(jobOf('confirm'), deps)).toBe('already')
      expect(edits).toHaveLength(0)
      expect(order).not.toContain('recap')
    }
    // Published by someone else meanwhile: say so, still no error copy and no recap.
    const other = makeRun({ publish: 'conflict', current: { status: 'PUBLISHED', reviewedBy: '999999999999999999' } })
    expect(await runCallReview(jobOf('confirm'), other.deps)).toBe('already')
    expect(other.edits[0].embeds[0].description).toContain('Already published')
    // A real conflict (still in review) keeps the retry copy.
    const real = makeRun({ publish: 'conflict', current: { status: 'IN_REVIEW', reviewedBy: null } })
    await runCallReview(jobOf('confirm'), real.deps)
    expect(real.edits[0].embeds[0].description).toContain('changed while publishing')
  })
  it('confirm: every other refusal posts nothing and links the website', async () => {
    for (const result of ['stale-redactions', 'transcribing', 'incomplete', 'not-allowed', 'not-found'] as const) {
      const { deps, order, edits } = makeRun({ publish: result })
      expect(await runCallReview(jobOf('confirm'), deps)).toBe(result)
      expect(order).not.toContain('recap')
      expect(edits[0].components).toEqual([])
    }
  })
  it('a double confirm: the second sees "already" and posts no second recap', async () => {
    let published = false
    const { deps, order } = makeRun()
    deps.publish = async () => {
      if (published) return 'already'
      published = true
      return 'ok'
    }
    await runCallReview(jobOf('confirm'), deps)
    await runCallReview(jobOf('confirm'), deps)
    expect(order.filter((x) => x === 'recap')).toHaveLength(1)
  })
  it('a recap failure still reports the publish and audits it', async () => {
    const { deps, edits, audits } = makeRun({ recap: 'failed' })
    expect(await runCallReview(jobOf('confirm'), deps)).toBe('published')
    expect(audits[0]).toMatchObject({ recap: 'failed' })
    expect(edits[0].embeds[0].description).toContain('could not be posted')
  })
  it('a thrown publish tells the reviewer nothing changed', async () => {
    const { deps, edits } = makeRun()
    deps.publish = async () => {
      throw new Error('db down')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runCallReview(jobOf('confirm'), deps)).toBe('error')
    expect(edits[0].embeds[0].description).toContain('Nothing was changed')
  })
  it('hold: holds, syncs the card and says so', async () => {
    const { deps, edits, order } = makeRun()
    expect(await runCallReview(jobOf('hold'), deps)).toBe('ok')
    expect(order).toEqual(['edit', 'sync'])
    expect(edits[0].embeds[0].description).toContain('Held for owner review')
  })
})
