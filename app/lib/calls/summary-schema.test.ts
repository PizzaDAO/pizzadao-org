// OpenAI structured outputs (strict mode) require every object property to be listed in `required`;
// optional fields must be expressed as nullable instead.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { summarySchema } from './summarize'

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
    expect(r.success).toBe(true)
  })
})
