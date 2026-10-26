import { describe, it, expect } from 'vitest'
import { crewHasFeature, canonicalCrewId } from '../../app/lib/crew-features.mjs'
import { MAX_DRAFT_TEXT, MAX_NOTES, isHttpsUrl } from '../../app/lib/draft-limits.mjs'

describe('seed script guards share the app rules', () => {
  it('only crews with the drafts feature are accepted', () => {
    expect(crewHasFeature(canonicalCrewId('Communications'), 'drafts')).toBe(true)
    expect(crewHasFeature(canonicalCrewId('tech'), 'drafts')).toBe(false)
  })
  it('limits and https check are the API ones', () => {
    expect(MAX_DRAFT_TEXT).toBe(5000)
    expect(MAX_NOTES).toBe(1000)
    expect(isHttpsUrl('https://a.io')).toBe(true)
    expect(isHttpsUrl('http://a.io')).toBe(false)
  })
})
