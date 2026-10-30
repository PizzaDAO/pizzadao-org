// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { configWarnings } from './admin'

const g = (cityKey: string, hasChat: boolean) => ({ cityKey, title: null, country: null, region: null, chatUrl: null, hasChat })

describe('configWarnings', () => {
  it('flags configured city keys that are unknown or have no group yet', () => {
    const groups = [g('alpha', true), g('beta', false)]
    expect(configWarnings([{ crewId: 'ops', cityKeys: 'Alpha, beta, nowhere' }], ['alpha', 'gone'], groups)).toEqual([
      { source: 'crew', crewId: 'ops', cityKey: 'beta', problem: 'no_chat' },
      { source: 'crew', crewId: 'ops', cityKey: 'nowhere', problem: 'unknown' },
      { source: 'announce', crewId: undefined, cityKey: 'gone', problem: 'unknown' },
    ])
  })

  it('is empty when everything resolves', () => {
    expect(configWarnings([{ crewId: 'ops', cityKeys: 'alpha' }], ['alpha'], [g('alpha', true)])).toEqual([])
  })
})
