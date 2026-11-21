// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveCrewForEvent } from './crew-map'

describe('ad hoc crew call events (Start crew call)', () => {
  it('maps "<Crew label> call" to the crew by its name prefix', () => {
    const crews = [
      { id: 'ops_crew', label: 'Ops Crew' },
      { id: 'tech', label: 'Tech' },
    ]
    expect(resolveCrewForEvent(crews, { eventId: '999999999999999999', eventName: 'Ops Crew call' })).toEqual({ crewId: 'ops_crew', crewLabel: 'Ops Crew' })
    expect(resolveCrewForEvent(crews, { eventId: null, eventName: 'Tech call' })).toEqual({ crewId: 'tech', crewLabel: 'Tech' })
  })
})
