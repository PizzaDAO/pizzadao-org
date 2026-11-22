import { describe, expect, it } from 'vitest'
import { hostChecklistFor, parseHostChecklist } from './host-checklist'

const settings = (over: Record<string, unknown> = {}) => ({
  get: (k: string) => ({ 'calls.attendanceCrewAliases': 'community = community_call', 'calls.hostChecklist': '0 min | Start | auto\n\n# comment\nNo time step\n2 min | Check', ...over })[k],
}) as never

describe('host checklist', () => {
  it('parses time | step | note lines, skipping blanks and comments', () => {
    expect(parseHostChecklist('0 min | Start | auto\n\n# c\nNo time\n2 min | Check\n3 min | ')).toEqual([
      { time: '0 min', step: 'Start', note: 'auto' },
      { time: '', step: 'No time', note: null },
      { time: '2 min', step: 'Check', note: null },
    ])
  })

  it('is only for the Community Call, through the crew aliases', () => {
    expect(hostChecklistFor('community', settings())?.length).toBe(3)
    expect(hostChecklistFor('community_call', settings())?.length).toBe(3)
    expect(hostChecklistFor('ops', settings())).toBeNull()
    expect(hostChecklistFor(null, settings())).toBeNull()
    expect(hostChecklistFor('community', settings({ 'calls.hostChecklist': '' }))).toBeNull()
  })
})
