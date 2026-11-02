// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const { ops, rec } = vi.hoisted(() => {
  const ops: Array<{ model: string; op: string; args: unknown }> = []
  const rec = (model: string, op: string) => (args: unknown) => {
    const o = { model, op, args }
    ops.push(o)
    return o
  }
  return { ops, rec }
})
vi.mock('@/app/lib/db', () => ({
  prisma: {
    $transaction: vi.fn(async (list: unknown[]) => list),
    announceState: { findUnique: vi.fn(async () => ({ sendValue: '', lastSentValue: '' })), upsert: rec('announceState', 'upsert') },
    announcement: {
      findMany: vi.fn(async () => [
        { naturalKey: 'keep me', text: 'Keep me', url: null, crew: '', status: 'To Do', position: 0, archived: false },
        { naturalKey: 'gone', text: 'Gone', url: null, crew: '', status: 'To Do', position: 1, archived: false },
      ]),
      upsert: rec('announcement', 'upsert'),
      updateMany: rec('announcement', 'updateMany'),
    },
    memberTableLayout: { findUnique: vi.fn(async () => ({ headers: ['', 'Name'] })), upsert: rec('memberTableLayout', 'upsert') },
    member: {
      findMany: vi.fn(async () => [
        { id: '1', cells: [{ v: 1 }, { v: 'A' }], position: 0 },
        { id: '9', cells: [{ v: 9 }, { v: 'Left the sheet' }], position: 1 },
      ]),
      upsert: rec('member', 'upsert'),
    },
  },
}))
vi.mock('@/app/lib/announce/sheet', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/announce/sheet')>()),
  createAnnounceSheetIO: () => ({
    readBlock: async () => ({ sendCell: null, lastSentCell: null, lastErrorCell: null, sendValue: '', lastSentValue: '', specials: [{ text: 'Keep me', url: null, crew: '', status: 'To Do' }] }),
    writeCells: async () => {},
  }),
}))
vi.mock('@/app/lib/sheets/member-repository', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/sheets/member-repository')>()),
  getMembersTableFromSheet: vi.fn(async () => {
    const header = { c: [null, { v: 'Name' }] }
    const row = { c: [{ v: 1 }, { v: 'A' }] }
    return { allRows: [header, row], headerRowIndex: 0, headers: ['', 'Name'], rows: [row] }
  }),
  invalidateMembersCache: vi.fn(),
}))

import { runImport } from './framework'
import { announceImporter } from './announce'
import { membersImporter } from './members'

const noLog = { log: async () => 1 }

describe('rows missing from the sheet', () => {
  it('announce: specials missing from the sheet are archived on apply (and the run counts them)', async () => {
    ops.length = 0
    const dry = await runImport(announceImporter, 'dry-run', 't', noLog)
    expect(dry.counts).toMatchObject({ create: 0, update: 0, orphan: 1 })
    expect(ops).toHaveLength(0)
    const r = await runImport(announceImporter, 'apply', 't', noLog)
    expect(r).toMatchObject({ ok: true, applied: true, counts: { orphan: 1 } })
    const archive = ops.find((o) => o.op === 'updateMany')
    expect(archive?.args).toMatchObject({ where: { naturalKey: { in: ['gone'] }, archived: false }, data: { archived: true } })
  })

  it('members: a member missing from the sheet is only reported, never touched', async () => {
    ops.length = 0
    const r = await runImport(membersImporter, 'apply', 't', noLog)
    expect(r).toMatchObject({ ok: true, applied: false, counts: { orphan: 1, create: 0, update: 0 } })
    expect(ops).toHaveLength(0)
  })
})
