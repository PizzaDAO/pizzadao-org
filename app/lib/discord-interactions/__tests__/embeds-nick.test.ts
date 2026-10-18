import { describe, it, expect } from 'vitest'
import { displayName } from '../embeds'

describe('displayName ignores the Pizza Trainee placeholder (anchovy-52918)', () => {
  it('falls back to the global name, then username', () => {
    expect(displayName({ nick: 'Pizza Trainee', user: { id: '1', username: 'u', global_name: 'Global' } })).toBe('Global')
    expect(displayName({ nick: 'Pizza Trainee', user: { id: '1', username: 'u' } })).toBe('u')
    expect(displayName({ nick: 'Tony', user: { id: '1', username: 'u' } })).toBe('Tony')
  })
})
