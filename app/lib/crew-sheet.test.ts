// Roster parser moved out of /api/crew/[crewId] (jalapeno-82565): behaviour must not change.
import { describe, it, expect } from 'vitest'
import { cellVal, detectSection, parseRoster, extractSheetId } from './crew-sheet'

const row = (...vals: (string | null)[]) => ({ c: vals.map((v) => (v === null ? null : { v })) })

describe('crew-sheet parser', () => {
  it('cellVal normalizes and tolerates empty cells', () => {
    expect(cellVal({ v: '  Hi  ' })).toBe('Hi')
    expect(cellVal(null)).toBe('')
    expect(cellVal({ f: 'fmt' })).toBe('fmt')
  })

  it('detectSection recognizes roster, tasks, goals and agenda headers', () => {
    expect(detectSection(['ID', 'Status', 'Name', 'City'])).toBe('roster')
    expect(detectSection(['Priority', 'Task', 'Goal'])).toBe('tasks')
    expect(detectSection(['Priority', 'Goal'])).toBe('goals')
    expect(detectSection(['Time', 'Step', 'Action'])).toBe('agenda')
    expect(detectSection(['foo', 'bar'])).toBeNull()
  })

  it('parseRoster reads rows until the next section header', () => {
    const rows = [
      row('ID', 'Status', 'Name', 'City', 'Turtles'),
      row('m1', 'Lead', 'Ada', 'NYC', 'Leo'),
      row('m2', 'Active', 'Bob', null, null),
      row('', '', '', '', ''),
      row('', '', 'Task', '', ''), // next section header: stop
      row('m3', 'Lead', 'Cy', 'LA', ''),
    ]
    const roster = parseRoster(rows, 0, ['ID', 'Status', 'Name', 'City', 'Turtles'])
    expect(roster.map((r) => [r.id, r.status, r.name, r.city, r.turtles])).toEqual([
      ['m1', 'Lead', 'Ada', 'NYC', 'Leo'],
      ['m2', 'Active', 'Bob', '', ''],
    ])
  })

  it('extractSheetId pulls the id from a sheet URL', () => {
    expect(extractSheetId('https://docs.google.com/spreadsheets/d/abc-123_X/edit#gid=0')).toBe('abc-123_X')
    expect(extractSheetId('nope')).toBeNull()
  })
})
