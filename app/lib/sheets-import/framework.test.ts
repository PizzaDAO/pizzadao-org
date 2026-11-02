// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { runImport, type Importer } from './framework'
import { labelKeys, normalizeLabel, planUpserts, stableEqual } from './plan'
import { snapshotTargets } from './snapshot'

type Row = { name: string; n: number }

/** An in-memory importer: the "sheet" is a list, the "database" a map. */
function memoryImporter(sheet: Array<{ key: string; value: Row }>, db: Map<string, Row>, issues = 0): Importer<Row> {
  return {
    key: 'test',
    load: async () => ({ records: sheet, issues: Array.from({ length: issues }, (_, i) => ({ row: i + 2, code: 'missing-name' })) }),
    existing: async () => new Map(db),
    apply: async (plan) => {
      for (const c of plan.create) db.set(c.key, c.value)
      for (const u of plan.update) db.set(u.key, u.value)
    },
  }
}

const noLog = { log: async () => 1 }

describe('planUpserts', () => {
  it('splits into create / update / unchanged / orphan and never deletes', () => {
    const plan = planUpserts(
      [
        { key: 'a', value: { x: 1 } },
        { key: 'b', value: { x: 2 } },
        { key: 'c', value: { x: 3 } },
      ],
      new Map([
        ['a', { x: 1 }],
        ['b', { x: 9 }],
        ['z', { x: 0 }],
      ]),
    )
    expect(plan.create.map((c) => c.key)).toEqual(['c'])
    expect(plan.update.map((c) => c.key)).toEqual(['b'])
    expect(plan.unchanged).toBe(1)
    expect(plan.orphans).toEqual(['z'])
  })

  it('compares values whatever their key order', () => {
    expect(stableEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(stableEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('label keys survive re-ordering and number repeats', () => {
    expect(normalizeLabel('  Ship   the Thing! ')).toBe('ship the thing')
    expect(labelKeys('ops:task', ['A', 'B', 'a'])).toEqual(['ops:task:a', 'ops:task:b', 'ops:task:a#2'])
    expect(new Set(labelKeys('ops:task', ['B', 'A', 'a']))).toEqual(new Set(labelKeys('ops:task', ['A', 'B', 'a'])))
  })
})

describe('runImport', () => {
  it('dry run writes nothing and reports counts; apply twice changes nothing the second time', async () => {
    const db = new Map<string, Row>([['a', { name: 'A', n: 1 }]])
    const sheet = [
      { key: 'a', value: { name: 'A', n: 2 } },
      { key: 'b', value: { name: 'B', n: 1 } },
    ]
    const dry = await runImport(memoryImporter(sheet, db), 'dry-run', 'tester', noLog)
    expect(dry).toMatchObject({ ok: true, applied: false, counts: { create: 1, update: 1, unchanged: 0, orphan: 0 } })
    expect(db.size).toBe(1)

    const first = await runImport(memoryImporter(sheet, db), 'apply', 'tester', noLog)
    expect(first).toMatchObject({ ok: true, applied: true, counts: { create: 1, update: 1 } })
    const second = await runImport(memoryImporter(sheet, db), 'apply', 'tester', noLog)
    expect(second).toMatchObject({ ok: true, applied: false, counts: { create: 0, update: 0, unchanged: 2, orphan: 0 } })
  })

  it('logs every run with counts and never cell contents', async () => {
    const log = vi.fn(async () => 7)
    const r = await runImport(memoryImporter([{ key: 'a', value: { name: 'Secret Name', n: 1 } }], new Map(), 2), 'dry-run', 'tester', { log })
    expect(r.runId).toBe(7)
    expect(r.counts.parseErrors).toBe(2)
    const logged = JSON.stringify(log.mock.calls[0])
    expect(logged).not.toContain('Secret Name')
    expect(JSON.stringify(r)).not.toContain('Secret Name')
  })

  it('a failing load is reported, not thrown, and nothing is applied', async () => {
    const imp: Importer<Row> = { key: 'x', load: async () => Promise.reject(new Error('sheet down')), existing: async () => new Map(), apply: vi.fn() }
    const r = await runImport(imp, 'apply', 'tester', noLog)
    expect(r).toMatchObject({ ok: false, applied: false, error: 'sheet down' })
    expect(imp.apply).not.toHaveBeenCalled()
  })
})

describe('snapshotTargets', () => {
  it('skips the webhook sheet, de-duplicates ids and adds crew sheets', () => {
    const t = snapshotTargets([{ id: 'ops', sheet: 'https://docs.google.com/spreadsheets/d/abc123/edit' }, { id: 'none' }], {})
    expect(t.some((x) => x.sheetKey === 'discordWebhooks')).toBe(false)
    expect(new Set(t.map((x) => x.sheetId)).size).toBe(t.length)
    expect(t.find((x) => x.sheetKey === 'crew:ops')?.sheetId).toBe('abc123')
  })
})
