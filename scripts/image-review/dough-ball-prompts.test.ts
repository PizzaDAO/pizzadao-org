// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { BASE_DESCRIPTION, buildCandidates } from './dough-ball-prompts'

describe('dough ball prompts (seed --dry-run list)', () => {
  const list = buildCandidates(20)
  it('makes 20 deterministic, distinct prompts', () => {
    expect(list).toHaveLength(20)
    expect(new Set(list.map((c) => c.prompt)).size).toBe(20)
    expect(buildCandidates(20)).toEqual(list)
  })
  it('embeds the base description and the traits', () => {
    for (const c of list) {
      expect(c.prompt.startsWith(BASE_DESCRIPTION)).toBe(true)
      expect(c.prompt).toContain(c.traits.expression)
      expect(c.prompt).toContain(c.traits.accessory)
    }
  })
  it('starts with the favorite combination and never asks for anger', () => {
    expect(list[0].traits.pose).toMatch(/salute/)
    expect(list[0].traits.expression).toMatch(/wink/)
    expect(list[0].traits.outfit).toMatch(/flour-dusted apron/)
    expect(list[0].traits.accessory).toMatch(/oversized fedora/)
    for (const c of list) expect(Object.values(c.traits).join(' ')).not.toMatch(/scowl|angry|tough|arms.crossed/i)
  })
  it('continues the trait list when appending', () => {
    expect(buildCandidates(2, 20)[0].traits).toEqual(buildCandidates(21)[20].traits)
  })
})
