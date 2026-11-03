// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { buildProgressReport, followUpIcon, matchFollowUp, NO_REPORT, PICK_CREW, type ProgressDeps } from './progress-report'
import { EMPTY_POST_FILTER, type PostFilter } from './post-filters'
import type { CrewOption } from '@/app/lib/crew-mappings'

const OPS: CrewOption = { id: 'ops', label: 'Ops Crew', turtles: [], event: '123456789012345678' }
const ART: CrewOption = { id: 'art', label: 'Art Crew', turtles: [] }
const NOW = new Date('2026-11-02T12:00:00Z')

const deps = (over: Partial<ProgressDeps> = {}): ProgressDeps => ({
  loadFilter: async () => EMPTY_POST_FILTER,
  crews: async () => [OPS, ART],
  currentEvent: async () => ({ id: '123456789012345678', name: 'Ops call' }),
  lastCall: async () => ({
    items: [
      { text: 'Draft the onboarding checklist for volunteers', owner: 'Dana' },
      { text: 'Book the venue', owner: 'Lee' },
      { text: 'Share notes' },
    ],
    recordingId: 'rec1',
    startedAt: new Date('2026-10-27T18:00:00Z'),
  }),
  followUps: async () => [
    { ownerName: 'Dana', ask: 'Draft the onboarding checklist for the volunteers', status: 'DONE' },
    { ownerName: 'Lee', ask: 'book the venue for the offsite', status: 'NEEDS_HELP' },
    { ownerName: 'Lee', ask: 'secret message text', status: 'DRAFT' },
  ],
  openTasks: async () => ({
    tasks: [
      { label: 'Late thing', priority: 'Mid', stage: 'Doing', due: '2026-10-30', isActive: true },
      { label: 'Top thing', priority: 'Top', stage: 'Todo', isActive: false },
    ],
    error: false,
  }),
  now: () => NOW,
  ...over,
})
const SETTINGS = { maxItems: 8, showFollowups: false }

describe('buildProgressReport', () => {
  it('uses the crew of the call in progress, lists items and ranked tasks', async () => {
    const r = await buildProgressReport(undefined, SETTINGS, deps())
    expect(r.kind).toBe('report')
    if (r.kind !== 'report') return
    expect(r.crewId).toBe('ops')
    expect(r.text).toContain('Ops Crew progress')
    expect(r.text).toContain('(2026-10-27)')
    expect(r.text).toContain('Draft the onboarding checklist')
    expect(r.text).toContain('(Dana)')
    // overdue before top priority
    expect(r.text.indexOf('Overdue 3d: Late thing')).toBeGreaterThan(-1)
    expect(r.text.indexOf('Overdue')).toBeLessThan(r.text.indexOf('Top priority'))
  })

  it('shows no follow-up status unless the setting is on', async () => {
    const followUps = vi.fn(async () => [])
    const r = await buildProgressReport(undefined, SETTINGS, deps({ followUps }))
    expect(followUps).not.toHaveBeenCalled()
    expect(r.kind === 'report' && /✅|🔄|🆘|⏳/.test(r.text)).toBe(false)
  })

  it('with follow-ups on: status icons only, never message text', async () => {
    const r = await buildProgressReport(undefined, { ...SETTINGS, showFollowups: true }, deps())
    if (r.kind !== 'report') throw new Error('no report')
    expect(r.text).toContain('✅ Draft the onboarding checklist')
    expect(r.text).toContain('🆘 Book the venue')
    expect(r.text).not.toContain('secret message text')
    expect(r.text).toContain('- Share notes') // no owner, no icon
  })

  it('takes the crew option (id or label) over the current call', async () => {
    const r = await buildProgressReport('Art Crew', SETTINGS, deps())
    expect(r.kind === 'report' && r.crewId).toBe('art')
    const r2 = await buildProgressReport('art', SETTINGS, deps())
    expect(r2.kind === 'report' && r2.crewId).toBe('art')
  })

  it('asks to pick a crew when none can be determined', async () => {
    expect(await buildProgressReport(undefined, SETTINGS, deps({ currentEvent: async () => null }))).toEqual({ kind: 'message', text: PICK_CREW })
    expect(await buildProgressReport('nope', SETTINGS, deps())).toEqual({ kind: 'message', text: PICK_CREW })
  })

  it('an excluded crew gets no report, with a generic message', async () => {
    const filter: PostFilter = { excludedCrewIds: ['ops'], excludedCrewLabelTerms: [], blockedTerms: [] }
    const r = await buildProgressReport(undefined, SETTINGS, deps({ loadFilter: async () => filter }))
    expect(r).toEqual({ kind: 'message', text: NO_REPORT })
  })

  it('a filter that cannot be read means no report', async () => {
    const r = await buildProgressReport(undefined, SETTINGS, deps({ loadFilter: async () => { throw new Error('db') } }))
    expect(r).toEqual({ kind: 'message', text: NO_REPORT })
  })

  it('drops items, owners and tasks that mention a blocked term', async () => {
    const filter: PostFilter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ['venue', 'late'] }
    const r = await buildProgressReport(undefined, SETTINGS, deps({ loadFilter: async () => filter }))
    if (r.kind !== 'report') throw new Error('no report')
    expect(r.text).not.toMatch(/venue/i)
    expect(r.text).not.toContain('Late thing')
    expect(r.text).toContain('Top thing')
  })

  it('caps each section at progressMaxItems and handles empty states', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `Item number ${i}` }))
    const r = await buildProgressReport(undefined, { ...SETTINGS, maxItems: 3 }, deps({ lastCall: async () => ({ items: many, recordingId: 'r', startedAt: NOW }) }))
    if (r.kind !== 'report') throw new Error('no report')
    expect(r.text.match(/- Item number/g)).toHaveLength(3)
    const empty = await buildProgressReport(undefined, SETTINGS, deps({ lastCall: async () => null, openTasks: async () => ({ tasks: [], error: true }) }))
    if (empty.kind !== 'report') throw new Error('no report')
    expect(empty.text).toContain('No action items from the last call.')
    expect(empty.text).toContain('could not be loaded')
  })

  it('escapes markdown and mentions in item text', async () => {
    const r = await buildProgressReport(undefined, SETTINGS, deps({ lastCall: async () => ({ items: [{ text: '**bold** <@123> @everyone', owner: 'x' }], recordingId: 'r', startedAt: NOW }) }))
    if (r.kind !== 'report') throw new Error('no report')
    expect(r.text).toContain('\\*\\*bold\\*\\*')
    expect(r.text).not.toContain('<@123>')
  })

  it('never throws: a loader failure is a generic message', async () => {
    const r = await buildProgressReport(undefined, SETTINGS, deps({ lastCall: async () => { throw new Error('boom') } }))
    expect(r).toEqual({ kind: 'message', text: NO_REPORT })
  })
})

describe('follow-up helpers', () => {
  it('maps statuses to icons', () => {
    expect(followUpIcon('DONE')).toBe('✅')
    expect(followUpIcon('IN_PROGRESS')).toBe('🔄')
    expect(followUpIcon('NEEDS_HELP')).toBe('🆘')
    expect(followUpIcon('SENT')).toBe('⏳')
    expect(followUpIcon('DRAFT')).toBeNull()
    expect(followUpIcon('DISMISSED')).toBeNull()
  })
  it('matches by owner, then wording; an ambiguous owner stays unmatched', () => {
    const items = [{ text: 'Write the budget summary document', owner: 'Sam' }, { text: 'Fix the login page bug', owner: 'Sam' }]
    const rows = [{ ownerName: 'sam', ask: 'fix login page bug today', status: 'DONE' }]
    expect(matchFollowUp(items[1], items, rows)?.status).toBe('DONE')
    expect(matchFollowUp(items[0], items, rows)).toBeNull()
    expect(matchFollowUp({ text: 'x' }, items, rows)).toBeNull()
  })
})
