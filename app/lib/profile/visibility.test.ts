import { describe, it, expect } from 'vitest'
import { canView, parseVisibility } from './visibility'
import * as passport from '@/app/lib/passport/visibility'

describe('profile visibility helpers', () => {
  it('parses unknown values as public', () => {
    expect(parseVisibility('members')).toBe('members')
    expect(parseVisibility('nope')).toBe('public')
  })
  it('lets the owner see everything and gates the others', () => {
    expect(canView('private', 'owner')).toBe(true)
    expect(canView('private', 'member')).toBe(false)
    expect(canView('members', 'member')).toBe(true)
    expect(canView('members', 'anonymous')).toBe(false)
    expect(canView('public', 'anonymous')).toBe(true)
  })
  it('is still re-exported from the passport module', () => {
    expect(passport.canView).toBe(canView)
    expect(passport.parseVisibility).toBe(parseVisibility)
  })
})
