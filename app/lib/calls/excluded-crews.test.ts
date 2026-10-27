// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isCrewExcluded, mentionsApac } from './excluded-crews'

describe('isCrewExcluded', () => {
  it('excludes APAC by id or label by default', () => {
    expect(isCrewExcluded({ id: 'pizzadao_apac', label: 'x' }, {})).toBe(true)
    expect(isCrewExcluded({ id: 'apac', label: '' }, {})).toBe(true)
    expect(isCrewExcluded({ id: 'crew1', label: 'PizzaDAO APAC' }, {})).toBe(true)
    expect(isCrewExcluded({ id: 'crew1', label: 'pizzadao apac crew' }, {})).toBe(true)
  })
  it('does not exclude other crews or look-alike words', () => {
    expect(isCrewExcluded({ id: 'ops', label: 'Ops' }, {})).toBe(false)
    expect(isCrewExcluded({ id: 'community_call', label: 'Community Call' }, {})).toBe(false)
    expect(isCrewExcluded({ id: 'capacity', label: 'Capacity planning' }, {})).toBe(false)
  })
  it('env override replaces the default list', () => {
    const env = { CALL_POST_EXCLUDED_CREWS: 'Ops, Design & Art' }
    expect(isCrewExcluded({ id: 'ops', label: 'Ops' }, env)).toBe(true)
    expect(isCrewExcluded({ id: 'design_art', label: 'x' }, env)).toBe(true)
    expect(isCrewExcluded({ id: 'pizzadao_apac', label: 'PizzaDAO APAC' }, env)).toBe(false)
    expect(isCrewExcluded({ id: 'pizzadao_apac', label: 'x' }, { CALL_POST_EXCLUDED_CREWS: '  ' })).toBe(true)
  })
  it('mentionsApac is word-based and case-insensitive', () => {
    expect(mentionsApac('Coordinate with APAC folks')).toBe(true)
    expect(mentionsApac('the apac-team')).toBe(true)
    expect(mentionsApac('no capacity left')).toBe(false)
    expect(mentionsApac(null)).toBe(false)
  })
})
