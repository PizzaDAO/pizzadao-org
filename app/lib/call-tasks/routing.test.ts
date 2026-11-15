// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn((o) => o) } }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn() }))

import { EMPTY_POST_FILTER } from '@/app/lib/calls/post-filters'
import { isNonCrewId, isRealCrew, realCrews, withoutNonCrewIds } from '@/app/lib/crew-id'
import { buildProposalPrompt, proposalSystemPrompt } from './extract'
import { crewVocab, parseProposals, PROPOSALS_SYSTEM_PROMPT, type ParseContext } from './proposals'
import { buildRouting, isRoutingTarget, parseCrewHints, routeCrew, ROUTING_SYSTEM_RULE, validCrewHints, type Routing } from './routing'
import { isRoutable } from './view'

const REGISTRY = [
  { id: 'ops', label: 'Ops', type: 'crew' },
  { id: 'tech', label: 'Tech', type: 'crew' },
  { id: 'biz_dev', label: 'Biz Dev' }, // no type: a crew
  { id: 'community', label: 'Community', type: 'community' },
  { id: 'town_hall', label: 'Town Hall', type: 'event' },
]

describe('crew filtering', () => {
  it('keeps only real crews: type "crew" or no type, never the community call ids', () => {
    expect(realCrews(REGISTRY).map((c) => c.id)).toEqual(['ops', 'tech', 'biz_dev'])
    expect(isRealCrew({ id: 'community_call' })).toBe(false)
    expect(isRealCrew({ id: 'community', type: 'crew' })).toBe(false)
    expect(isRealCrew({ id: 'ops', type: ' Crew ' })).toBe(true)
    expect(isRealCrew(null)).toBe(false)
  })
  it('flags ids that are not crews', () => {
    expect(isNonCrewId('community', [])).toBe(true)
    expect(isNonCrewId('town_hall', REGISTRY)).toBe(true)
    expect(isNonCrewId('ops', REGISTRY)).toBe(false)
    expect(isNonCrewId('unknown', REGISTRY)).toBe(false)
    expect(isNonCrewId('', REGISTRY)).toBe(false)
  })
  it('drops non-crew entries from a member\'s crew list, by id or label', () => {
    expect(withoutNonCrewIds(['ops', 'Community', 'community_call', 'Town Hall', 'old_crew'], REGISTRY)).toEqual(['ops', 'old_crew'])
  })
})

const routing: Routing = buildRouting(
  [
    { id: 'ops', label: 'Ops', tasks: [{ label: 'Pay the venue' }] },
    { id: 'tech', label: 'Tech' },
  ],
  parseCrewHints('tech: the website and bots\nnot a hint line\nops : events logistics'),
  'ops',
)

describe('routing', () => {
  it('parses hints per crew and validates the setting', () => {
    expect([...parseCrewHints('tech: the website\n\nOps: money').entries()]).toEqual([
      ['tech', 'the website'],
      ['ops', 'money'],
    ])
    expect(validCrewHints('')).toBe(true)
    expect(validCrewHints('tech: site\nops: money\n')).toBe(true)
    expect(validCrewHints('tech site')).toBe(false)
    expect(routing.crews.find((c) => c.id === 'tech')?.hint).toBe('the website and bots')
  })
  it('accepts a listed crew by id or name, else falls back to the default crew', () => {
    expect(routeCrew('tech', routing)).toBe('tech')
    expect(routeCrew('Tech', routing)).toBe('tech')
    expect(routeCrew(' TECH ', routing)).toBe('tech')
    expect(routeCrew('community', routing)).toBe('ops')
    expect(routeCrew('made_up', routing)).toBe('ops')
    expect(routeCrew(null, routing)).toBe('ops')
    expect(isRoutingTarget('tech', routing)).toBe(true)
    expect(isRoutingTarget('community', routing)).toBe(false)
  })
  it('has no fallback when the default crew is not a target', () => {
    const r = buildRouting([{ id: 'tech', label: 'Tech' }], new Map(), 'ops')
    expect(r.fallback).toBeNull()
    expect(routeCrew('nope', r)).toBeNull()
    expect(routeCrew('tech', r)).toBe('tech')
  })
})

function ctx(over: Partial<ParseContext> = {}): ParseContext {
  return {
    recordingId: 'rec1',
    tasksByRef: new Map(),
    speakerByLabel: new Map(),
    members: [],
    vocab: crewVocab([]),
    now: new Date('2026-11-03T12:00:00Z'),
    max: 15,
    filter: EMPTY_POST_FILTER,
    visibleText: '',
    actionItems: [],
    openLabels: [],
    ...over,
  }
}
const create = (label: string, crew?: string | null) => ({
  kind: 'CREATE', task: null, newLabel: label, stage: null, priority: null, lead: null, leadSpeaker: null, due: null,
  reason: 'It was agreed', quote: null, startMs: null, confidence: 'high', ...(crew !== undefined ? { crew } : {}),
})

describe('parsing routed proposals', () => {
  it('assigns each CREATE to the validated crew, or the default crew', () => {
    const out = parseProposals({ items: [create('Fix the bot', 'tech'), create('Book a room', 'community'), create('Write a post', null)] }, ctx({ routing }))
    expect(out.map((d) => [d.changes.label?.to, d.crewId])).toEqual([
      ['Fix the bot', 'tech'],
      ['Book a room', 'ops'],
      ['Write a post', 'ops'],
    ])
  })
  it('a crew call ignores any crew the model returns (stays on the call\'s crew)', () => {
    const [d] = parseProposals({ items: [create('Fix the bot', 'tech')] }, ctx())
    expect(d.crewId).toBeUndefined()
  })
  it('an UPDATE keeps the task\'s own crew', () => {
    const task = { id: 't1', label: 'Old', stage: 'todo', priority: null, due: null, leadName: null, leadMemberId: null, updatedAt: new Date(), crewId: 'community' }
    const [d] = parseProposals({ items: [{ ...create('x', 'tech'), kind: 'DONE', task: 'T1', newLabel: null }] }, ctx({ routing, tasksByRef: new Map([['T1', task]]) }))
    expect(d.kind).toBe('DONE')
    expect(d.crewId).toBe('community')
  })
  it('the prompt lists the crews and the system prompt gets the routing rule only for routed calls', () => {
    const { prompt, ctx: c } = buildProposalPrompt({ recordingId: 'r', segments: [], speakers: [], actionItems: [], tasks: [], members: [], filter: EMPTY_POST_FILTER, today: new Date(), max: 5, routing })
    expect(prompt).toContain('- tech (Tech): the website and bots')
    expect(prompt).toContain('open tasks include: Pay the venue')
    expect(c.routing).toBe(routing)
    expect(proposalSystemPrompt(routing, '')).toContain(ROUTING_SYSTEM_RULE)
    expect(proposalSystemPrompt(undefined, '')).toBe(PROPOSALS_SYSTEM_PROMPT)
    expect(buildProposalPrompt({ recordingId: 'r', segments: [], speakers: [], actionItems: [], tasks: [], members: [], filter: EMPTY_POST_FILTER, today: new Date(), max: 5 }).prompt).not.toContain('Crews a new task')
  })
  it('only new tasks from a non-crew call are routable in the review', () => {
    expect(isRoutable('CREATE', 'tech', 'community')).toBe(true)
    expect(isRoutable('CREATE', 'community', 'community')).toBe(true)
    expect(isRoutable('CREATE', 'ops', 'ops')).toBe(false)
    expect(isRoutable('UPDATE', 'tech', 'community')).toBe(false)
  })
})
