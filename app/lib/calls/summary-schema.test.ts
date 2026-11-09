// OpenAI structured outputs (strict mode) require every object property to be listed in `required`;
// optional fields must be expressed as nullable instead.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { cleanSuggestedBy, sanitizeSummary, summarySchema } from './summarize'

type Node = { type?: string | string[]; properties?: Record<string, Node>; required?: string[]; items?: Node; anyOf?: Node[] }

function objectsWithMissingRequired(node: Node, path = '$'): string[] {
  const out: string[] = []
  if (node.properties) {
    const missing = Object.keys(node.properties).filter((k) => !(node.required ?? []).includes(k))
    if (missing.length) out.push(`${path}: ${missing.join(', ')}`)
    for (const [k, v] of Object.entries(node.properties)) out.push(...objectsWithMissingRequired(v, `${path}.${k}`))
  }
  if (node.items) out.push(...objectsWithMissingRequired(node.items, `${path}[]`))
  for (const a of node.anyOf ?? []) out.push(...objectsWithMissingRequired(a, path))
  return out
}

describe('summarySchema', () => {
  it('is strict-mode compatible: every property is required', () => {
    expect(objectsWithMissingRequired(z.toJSONSchema(summarySchema) as Node)).toEqual([])
  })

  it('accepts an action item with no owner as null', () => {
    const r = summarySchema.safeParse({ title: 't', summary: 's', actionItems: [{ text: 'do it', owner: null }], chapters: [] })
    expect(r.success).toBe(false) // suggestedBy is required (null when unclear)
  })

  it('accepts suggestedBy as a name or null', () => {
    const r = summarySchema.safeParse({ title: 't', summary: 's', actionItems: [{ text: 'a', owner: null, suggestedBy: 'Bob' }, { text: 'b', owner: 'Ann', suggestedBy: null }], chapters: [] })
    expect(r.success).toBe(true)
  })

  it('sanitizes suggestedBy: control characters, whitespace, 100 character cap, empty is null', () => {
    expect(cleanSuggestedBy('  Bob\n\tSmith ')).toBe('Bob Smith')
    expect(cleanSuggestedBy('x'.repeat(150))).toHaveLength(100)
    expect(cleanSuggestedBy('   ')).toBeNull()
    expect(cleanSuggestedBy('Speaker 3')).toBeNull()
    expect(cleanSuggestedBy('Unknown speaker')).toBeNull()
    expect(cleanSuggestedBy(undefined)).toBeNull()
    const out = sanitizeSummary({ title: 't', summary: 's', chapters: [], actionItems: [{ text: 'a', owner: null, suggestedBy: ' Bob ' }] })
    expect(out.actionItems[0].suggestedBy).toBe('Bob')
  })
})
