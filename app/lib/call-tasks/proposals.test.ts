// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn((o) => o) } }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn() }))

import type { TranscriptSegment } from '@/app/lib/calls/ingest-schema'
import { EMPTY_POST_FILTER } from '@/app/lib/calls/post-filters'
import { buildProposalPrompt } from './extract'
import { crewVocab, doneStage, parseProposals, verifiedQuote, type ParseContext, type TaskRef } from './proposals'

const now = new Date('2026-11-03T12:00:00Z')
const T1: TaskRef = { id: 'task-1', label: 'Update the landing page', stage: 'Doing', priority: 'High', due: null, leadName: 'Ann Lee', leadMemberId: '11', updatedAt: new Date('2026-11-01T00:00:00Z') }
const T2: TaskRef = { id: 'task-2', label: 'Order stickers', stage: 'todo', priority: null, due: '2026-11-20', leadName: null, leadMemberId: null, updatedAt: new Date('2026-11-01T00:00:00Z') }
const T3: TaskRef = { id: 'task-3', label: 'Old thing', stage: 'Done', priority: null, due: null, leadName: null, leadMemberId: null, updatedAt: new Date('2026-10-01T00:00:00Z') }
const members = [
  { id: '11', name: 'Ann Lee', discordId: '900' },
  { id: '12', name: 'Bob Stone', discordId: '901' },
  { id: '13', name: 'Sam Roe', discordId: '902' },
  { id: '14', name: 'Sam Rowe', discordId: '903' },
]

function ctx(over: Partial<ParseContext> = {}): ParseContext {
  const tasks = [T1, T2, T3]
  return {
    recordingId: 'rec1',
    tasksByRef: new Map(tasks.map((t, i) => [`T${i + 1}`, t])),
    speakerByLabel: new Map([['S1', '900']]),
    members,
    vocab: crewVocab(tasks),
    now,
    max: 15,
    filter: EMPTY_POST_FILTER,
    visibleText: 'the landing page is done now we need to order the stickers by friday',
    actionItems: [{ text: 'Print flyers for the meetup' }],
    openLabels: [T1.label, T2.label],
    ...over,
  }
}

const item = (over: Record<string, unknown> = {}) => ({
  kind: 'UPDATE', task: 'T1', newLabel: null, stage: null, priority: null, lead: null, leadSpeaker: null, due: null,
  reason: 'It was discussed', quote: null, startMs: null, confidence: 'high', ...over,
})
const run = (items: unknown[], c: ParseContext = ctx()) => parseProposals({ items }, c)

describe('parseProposals', () => {
  it('maps a DONE to the crew\'s own done stage and keeps the stale-check base', () => {
    const [p] = run([item({ kind: 'DONE', task: 'T1' })])
    expect(p.kind).toBe('DONE')
    expect(p.taskId).toBe('task-1')
    expect(p.changes.stage).toEqual({ from: 'Doing', to: 'Done' })
    expect(p.baseUpdatedAt).toEqual(T1.updatedAt)
    expect(p.sourceKey).toBe('rec1:DONE:task-1')
  })

  it('drops unknown task refs, low confidence, and DONE on an already closed task', () => {
    expect(run([item({ task: 'T9' }), item({ task: 'T1', stage: 'now', confidence: 'low' }), item({ kind: 'DONE', task: 'T3' })])).toEqual([])
  })

  it('drops no-op updates and normalises stage and priority to the crew vocabulary', () => {
    expect(run([item({ stage: 'doing', priority: 'high' })])).toEqual([]) // same as now, different case
    const [p] = run([item({ task: 'T2', stage: 'NOW', priority: 'top' })])
    expect(p.changes.stage).toEqual({ from: 'todo', to: 'now' })
    expect(p.changes.priority).toEqual({ from: null, to: 'Top' })
    expect(run([item({ task: 'T2', stage: 'blocked-by-aliens', priority: 'urgent' })])).toEqual([])
  })

  it('accepts a due date only within a sane window', () => {
    const [ok] = run([item({ task: 'T2', due: '2026-11-14' })])
    expect(ok.changes.due).toEqual({ from: '2026-11-20', to: '2026-11-14' })
    expect(run([item({ task: 'T2', due: '2019-01-01' }), item({ task: 'T2', due: 'next friday' })])).toEqual([])
  })

  it('resolves a lead by speaker label or name and keeps ambiguous ones as candidates', () => {
    const [bySpeaker] = run([item({ task: 'T2', lead: 'Ann', leadSpeaker: 'S1' })])
    expect(bySpeaker.leadMemberId).toBe('11')
    expect(bySpeaker.changes.leadMemberId).toEqual({ from: null, to: '11' })
    const [amb] = run([item({ task: 'T2', lead: 'Sam Roxe' })])
    expect(amb.leadMemberId).toBeNull()
    expect(amb.candidates.map((c) => c.memberId).sort()).toEqual(['13', '14'])
    expect(amb.changes.leadMemberId).toBeUndefined()
  })

  it('does not propose the lead the task already has', () => {
    expect(run([item({ lead: 'Ann Lee' })])).toEqual([])
  })

  it('CREATE needs a label, skips ones that match an open task, and links the action item it came from', () => {
    expect(run([item({ kind: 'CREATE', task: null, newLabel: null })])).toEqual([])
    expect(run([item({ kind: 'CREATE', task: null, newLabel: 'order stickers' })])).toEqual([])
    const [p] = run([item({ kind: 'CREATE', task: null, newLabel: 'Print flyers for the meetup', lead: 'Bob Stone', due: '2026-11-10' })])
    expect(p.taskId).toBeNull()
    expect(p.changes.label).toEqual({ from: null, to: 'Print flyers for the meetup' })
    expect(p.changes.due?.to).toBe('2026-11-10')
    expect(p.leadMemberId).toBe('12')
    expect(p.actionItemIdx).toBe(0)
  })

  it('RETIRE hides, never deletes', () => {
    const [p] = run([item({ kind: 'RETIRE', task: 'T2' })])
    expect(p.changes).toEqual({ archived: { from: false, to: true } })
  })

  it('keeps one proposal per task and dedupes by source key', () => {
    const out = run([item({ task: 'T2', stage: 'now' }), item({ task: 'T2', priority: 'Top' }), item({ kind: 'CREATE', task: null, newLabel: 'Book venue' }), item({ kind: 'CREATE', task: null, newLabel: 'book venue' })])
    expect(out.map((p) => p.kind)).toEqual(['UPDATE', 'CREATE'])
  })

  it('applies the blocked-term filter to labels and reasons', () => {
    const filter = { ...EMPTY_POST_FILTER, blockedTerms: ['secretword'] }
    expect(run([item({ task: 'T2', stage: 'now', reason: 'About the secretword plan' })], ctx({ filter }))).toEqual([])
    expect(run([item({ kind: 'CREATE', task: null, newLabel: 'Do the secretword thing' })], ctx({ filter }))).toEqual([])
    expect(run([item({ task: 'T2', stage: 'now' })], ctx({ filter }))).toHaveLength(1)
  })

  it('caps the number of proposals and survives malformed items', () => {
    const many = Array.from({ length: 5 }, (_, i) => item({ kind: 'CREATE', task: null, newLabel: `Brand new idea number ${i} here` }))
    expect(run(many, ctx({ max: 2 }))).toHaveLength(2)
    expect(parseProposals({ items: [{ nonsense: true }, item({ task: 'T2', stage: 'now' })] }, ctx())).toHaveLength(1)
    expect(parseProposals('garbage', ctx())).toEqual([])
  })

  it('keeps a quote only when it is really in the visible transcript', () => {
    const [kept] = run([item({ task: 'T2', stage: 'now', quote: 'we need to order the stickers by Friday', startMs: 61000 })])
    expect(kept.quote).toBe('we need to order the stickers by Friday')
    expect(kept.startMs).toBe(61000)
    const [dropped] = run([item({ task: 'T2', stage: 'now', quote: 'a sentence nobody said on this call', startMs: 5000 })])
    expect(dropped.quote).toBeNull()
    expect(dropped.startMs).toBeNull()
    expect(verifiedQuote('short', 'short')).toBeNull()
  })
})

describe('vocabulary', () => {
  it('uses the crew\'s own spelling of done', () => {
    expect(doneStage(crewVocab([{ stage: 'Done', priority: null }]))).toBe('Done')
    expect(doneStage(crewVocab([{ stage: 'Completed', priority: null }]))).toBe('done')
  })
})

describe('buildProposalPrompt (privacy)', () => {
  const seg = (discordId: string, startMs: number, text: string): TranscriptSegment => ({ discordId, startMs, endMs: startMs + 1000, text }) as TranscriptSegment
  it('sends only the segments it is given, speakers as S1.., tasks as T1.., no raw ids', () => {
    const { prompt, ctx: c } = buildProposalPrompt({
      recordingId: 'rec1',
      segments: [seg('900', 1000, 'the landing page is done'), seg('901', 5000, 'ok')],
      speakers: [{ discordId: '900', displayName: 'Ann' }, { discordId: '901', displayName: 'Bob' }],
      actionItems: [{ text: 'Print flyers', owner: 'Ann' }],
      tasks: [T1, T2],
      members,
      filter: EMPTY_POST_FILTER,
      today: now,
      max: 5,
    })
    expect(prompt).toContain('T1. Update the landing page')
    expect(prompt).toContain('S1 (Ann)')
    expect(prompt).toContain('Print flyers')
    expect(prompt).not.toContain('task-1')
    expect(prompt).not.toContain('900')
    expect(c.tasksByRef.get('T2')?.id).toBe('task-2')
    expect(c.speakerByLabel.get('S2')).toBe('901')
  })
})
