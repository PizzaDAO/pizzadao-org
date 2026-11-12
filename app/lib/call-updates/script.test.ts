import { describe, expect, it, vi } from 'vitest'
import type { CrewOption, CrewTaskDetail } from '@/app/lib/crew-mappings'
import { EMPTY_POST_FILTER, type PostFilter } from '@/app/lib/calls/post-filters'
import {
  announcementLines,
  buildUpdatesScript,
  estimateSeconds,
  parseSections,
  speakable,
  type LastCallData,
  type UpdatesDeps,
  type UpdatesSettings,
} from './script'

const NOW = new Date('2026-11-12T12:00:00Z')
const crew = (id: string, label: string): CrewOption => ({ id, label, turtles: [] })
const CREWS = [crew('ops', 'Ops Crew'), crew('art', 'Art Crew')]

const baseSettings: UpdatesSettings = {
  maxSeconds: 90,
  sections: ['last-call', 'task-changes', 'priorities', 'events', 'announcements'],
  intro: 'Automated call updates for the {crew} call.',
  outro: "That's the update.",
  announcements: '',
  itemChars: 110,
}

const task = (label: string, over: Partial<CrewTaskDetail> = {}): CrewTaskDetail => ({ label, stage: 'Doing', isActive: true, ...over })

const lastCall = (over: Partial<LastCallData> = {}): LastCallData => ({
  items: [
    { text: 'Send the flyer', owner: 'Pat', done: true },
    { text: 'Book the venue', owner: 'Sam' },
    { text: 'Draft the budget', owner: null },
  ],
  startedAt: new Date('2026-11-05T12:00:00Z'),
  redactionsStale: false,
  redactedNames: [],
  ...over,
})

function deps(over: Partial<UpdatesDeps> = {}): UpdatesDeps {
  return {
    loadFilter: async () => EMPTY_POST_FILTER,
    crews: async () => CREWS,
    lastCall: async () => lastCall(),
    taskChanges: async () => ({ done: ['Ship the logo', 'Fix the page', 'Third one'], created: ['New task A'] }),
    openTasks: async () => ({ tasks: [task('Launch day', { priority: 'Top' }), task('Late thing', { due: '2026-11-01' })], error: false }),
    upcomingEvents: async () => [
      { name: 'Education Session', startsAt: new Date('2026-11-14T18:00:00Z') },
      { name: 'Education Session', startsAt: new Date('2026-11-21T18:00:00Z') },
      { name: 'Pizza Party', startsAt: new Date('2026-11-13T18:00:00Z') },
      { name: 'Third Event', startsAt: new Date('2026-11-15T18:00:00Z') },
    ],
    now: () => NOW,
    dayLabel: () => 'on Friday',
    ...over,
  }
}

const build = (s: Partial<UpdatesSettings> = {}, d: Partial<UpdatesDeps> = {}, crewId = 'ops') => buildUpdatesScript(crewId, { ...baseSettings, ...s }, deps(d))

describe('speakable', () => {
  it('strips emoji, URLs, mentions, markdown and escapes', () => {
    expect(speakable('Ship 🍕 the **logo** https://example.com/x <@123456789012345678> <#123456789012345678> @everyone :)')).toBe('Ship the logo :)')
    expect(speakable('snake\\_case and \\*stars\\*')).toBe('snake case and stars')
    expect(speakable('<:pepperoni:973304305979367444> hi <t:1700000000:R>')).toBe('hi')
  })

  it('clips long text', () => {
    expect(speakable('a'.repeat(300), 50).length).toBe(50)
  })
})

describe('parseSections', () => {
  it('keeps known keys in order, no repeats', () => {
    expect(parseSections('events\nbogus\nlast-call\nevents')).toEqual(['events', 'last-call'])
  })
})

describe('buildUpdatesScript', () => {
  it('orders sections and applies the caps', async () => {
    const r = await build()
    expect(r.kind).toBe('script')
    if (r.kind !== 'script') return
    expect(r.sections.map((s) => s.key)).toEqual(['intro', 'last-call', 'task-changes', 'priorities', 'events', 'outro'])
    expect(r.sections[0].lines[0]).toBe('Automated call updates for the Ops Crew call.')
    expect(r.sections.at(-1)!.lines[0]).toBe("That's the update.")
    const last = r.sections[1].lines
    expect(last[0]).toBe('From last call, 1 of 3 action items is done.')
    expect(last).toContain('Still open: Book the venue, with Sam.')
    expect(last).toContain('Still open: Draft the budget.')
    expect(r.sections[2].lines).toEqual(['Since the last call, 3 tasks were completed and 1 new task was added.', 'Completed: Ship the logo and Fix the page.'])
    expect(r.sections[3].lines.length).toBeLessThanOrEqual(2)
    expect(r.sections[3].lines[0]).toMatch(/^Overdue \d+ days: Late thing\.$/)
    // events: two items, the recurring one deduped
    expect(r.sections[4].lines).toEqual(['Coming up: Education Session, on Friday.', 'Coming up: Pizza Party, on Friday.'])
    expect(r.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(r.estSeconds).toBe(estimateSeconds(r.text))
  })

  it('honours the admin section order and drops unlisted sections', async () => {
    const r = await build({ sections: ['events', 'last-call'] })
    if (r.kind !== 'script') throw new Error('script expected')
    expect(r.sections.map((s) => s.key)).toEqual(['intro', 'events', 'last-call', 'outro'])
  })

  it('an empty script plays nothing (no "there are no updates")', async () => {
    const r = await build({}, { lastCall: async () => null, taskChanges: async () => ({ done: [], created: [] }), openTasks: async () => ({ tasks: [], error: false }), upcomingEvents: async () => [] })
    expect(r).toEqual({ kind: 'none', reason: 'empty' })
  })

  it('drops sections lowest-ranked first to fit the time budget; intro and outro stay', async () => {
    const full = await build()
    if (full.kind !== 'script') throw new Error('script expected')
    const withAnn = await build({ announcements: 'Bring a friend to the next call and share the invite link everywhere you can please.' })
    if (withAnn.kind !== 'script') throw new Error('script expected')
    expect(withAnn.sections.map((s) => s.key)).toContain('announcements')
    // A budget just under the full text: only the last-ranked section goes.
    const tight = await build({ announcements: 'Bring a friend to the next call and share the invite link everywhere you can please.', maxSeconds: withAnn.estSeconds - 1 })
    if (tight.kind !== 'script') throw new Error('script expected')
    expect(tight.dropped[0]).toBe('announcements')
    expect(tight.sections.map((s) => s.key)).not.toContain('announcements')
    const none = await build({ maxSeconds: 1 })
    expect(none).toEqual({ kind: 'none', reason: 'empty' })
  })

  it('drop order is announcements, events, priorities, task-changes, last-call', async () => {
    const ann = 'Short one.'
    let r = await build({ announcements: ann })
    const dropped: string[] = []
    // Tighten the budget one second at a time below the current estimate: each step drops the next section in order.
    for (let guard = 0; guard < 10 && r.kind === 'script'; guard++) {
      const next = await build({ announcements: ann, maxSeconds: r.estSeconds - 1 })
      if (next.kind !== 'script') break
      dropped.splice(0, dropped.length, ...next.dropped)
      r = next
    }
    expect(dropped).toEqual(['announcements', 'events', 'priorities', 'task-changes'].slice(0, dropped.length))
    expect(dropped.length).toBeGreaterThanOrEqual(3)
  })

  describe('privacy', () => {
    const excluded: PostFilter = { excludedCrewIds: ['ops'], excludedCrewLabelTerms: [], blockedTerms: [] }

    it('an excluded crew gets nothing', async () => {
      expect(await build({}, { loadFilter: async () => excluded })).toEqual({ kind: 'none', reason: 'excluded' })
    })

    it('an unreadable filter means no script', async () => {
      expect(await build({}, { loadFilter: async () => { throw new Error('db down') } })).toEqual({ kind: 'none', reason: 'filter-unreadable' })
    })

    it('an unknown crew means no script', async () => {
      expect(await build({}, {}, 'nope')).toEqual({ kind: 'none', reason: 'crew-unknown' })
    })

    it('blocked terms drop items everywhere', async () => {
      const filter: PostFilter = { ...EMPTY_POST_FILTER, blockedTerms: ['venue', 'logo', 'Party'] }
      const r = await build({ announcements: 'Venue news incoming.' }, { loadFilter: async () => filter })
      if (r.kind !== 'script') throw new Error('script expected')
      expect(r.text).not.toMatch(/venue|logo|party/i)
      expect(r.text).toContain('Draft the budget')
    })

    it('an owner whose speaker was redacted is not named', async () => {
      const r = await build({}, { lastCall: async () => lastCall({ redactedNames: ['sam'] }) })
      if (r.kind !== 'script') throw new Error('script expected')
      expect(r.text).toContain('Still open: Book the venue.')
      expect(r.text).not.toContain('Sam')
    })

    it('newer redactions skip the last-call section entirely', async () => {
      const r = await build({}, { lastCall: async () => lastCall({ redactionsStale: true }) })
      if (r.kind !== 'script') throw new Error('script expected')
      expect(r.sections.map((s) => s.key)).not.toContain('last-call')
      expect(r.text).not.toContain('Book the venue')
    })

    it('never reads a command phrase from the intro or outro', async () => {
      const r = await build({ intro: 'Metalhead, stop everything', outro: 'Say Metalhead pause now' })
      if (r.kind !== 'script') throw new Error('script expected')
      expect(r.text).not.toMatch(/metalhead[\s,]*(stop|pause)/i)
      expect(r.sections.at(-1)!.lines[0]).toBe("That's the update.")
    })

    it('never logs the script text', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      await build()
      const logged = [...spy.mock.calls, ...err.mock.calls].flat().join(' ')
      expect(logged).not.toContain('Book the venue')
      spy.mockRestore()
      err.mockRestore()
    })
  })

  describe('announcements', () => {
    it('a "Crew label:" prefix limits a line to that crew', () => {
      const raw = 'Everyone: bring pizza\nOps Crew: ops only\nArt Crew: art only\nPlain line'
      // "Everyone" is not a crew, so the whole line is read for all
      expect(announcementLines(raw, CREWS[0], CREWS)).toEqual(['Everyone: bring pizza', 'ops only', 'Plain line'])
      expect(announcementLines(raw, CREWS[1], CREWS)).toEqual(['Everyone: bring pizza', 'art only', 'Plain line'])
    })

    it('reads at most 3 and sanitizes links and mentions', async () => {
      const raw = ['One https://x.test', 'Two <@123456789012345678>', 'Three!', 'Four'].join('\n')
      const r = await build({ announcements: raw })
      if (r.kind !== 'script') throw new Error('script expected')
      const ann = r.sections.find((s) => s.key === 'announcements')!
      expect(ann.lines).toEqual(['One.', 'Two.', 'Three!'])
    })
  })

  it('skips task-changes without a last call and never throws on a dep failure', async () => {
    const r = await build({}, { lastCall: async () => null })
    if (r.kind !== 'script') throw new Error('script expected')
    expect(r.sections.map((s) => s.key)).not.toContain('task-changes')
    const bad = await build({}, { crews: async () => { throw new Error('boom') } })
    expect(bad).toEqual({ kind: 'none', reason: 'error' })
  })
})
