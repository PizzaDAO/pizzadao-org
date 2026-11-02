// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { saveSetting, SettingError } from '@/app/lib/settings/store'
import { DATASETS } from './datasets'
import { REFUSED_SOURCE_IS_DB, runImport, type Importer } from './framework'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const noLog = { log: async () => 1 }

function importer(apply = vi.fn(async () => {})): Importer<{ n: number }> {
  return { key: 'x', load: async () => ({ records: [{ key: 'a', value: { n: 1 } }], issues: [] }), existing: async () => new Map(), apply }
}

describe('import apply refused while the data set reads from the database', () => {
  it('refuses an apply when the source is fully "db" (nothing written), allows a dry run', async () => {
    const apply = vi.fn(async () => {})
    const getSource = async () => ({ kind: 'db' as const, crews: null })
    const r = await runImport(importer(apply), 'apply', 't', { ...noLog, source: 'crews', getSource })
    expect(r).toMatchObject({ ok: false, refused: true, applied: false, error: REFUSED_SOURCE_IS_DB })
    expect(apply).not.toHaveBeenCalled()
    const dry = await runImport(importer(apply), 'dry-run', 't', { ...noLog, source: 'crews', getSource })
    expect(dry).toMatchObject({ ok: true, counts: { create: 1 } })
  })

  it('allows an apply during a per-crew pilot and when on the sheet', async () => {
    const apply = vi.fn(async () => {})
    await runImport(importer(apply), 'apply', 't', { ...noLog, source: 'crewTasks', getSource: async () => ({ kind: 'db', crews: new Set(['ops']) }) })
    await runImport(importer(apply), 'apply', 't', { ...noLog, source: 'crewTasks', getSource: async () => ({ kind: 'sheet', crews: null }) })
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('a chunked apply that fails part-way logs how many rows it had written', async () => {
    const log = vi.fn(async () => 9)
    const apply = vi.fn(async (_plan: unknown, progress: (n: number) => void) => {
      progress(100)
      throw new Error('connection lost')
    })
    const r = await runImport(importer(apply as never), 'apply', 't', { log })
    expect(r).toMatchObject({ ok: false, extra: { rowsWrittenBeforeFailure: 100 } })
    expect(JSON.stringify(log.mock.calls[0])).toContain('rowsWrittenBeforeFailure')
  })
})

describe('a sheets.source switch needs a successful import first', () => {
  const tx = { appSetting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({ updatedAt: new Date() })) }, appSettingChange: { create: vi.fn() } }
  beforeEach(() => {
    vi.clearAllMocks()
    m(prisma.$transaction).mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
    m(prisma.appSetting.findMany).mockResolvedValue([])
  })

  it('refuses "db" with no importer or no successful apply, allows it after one, never blocks "sheet"', async () => {
    const restore = DATASETS.splice(0, DATASETS.length)
    DATASETS.push({ key: 'crews', label: 'Crew registry', source: 'crews', description: '', importer: async () => importer() as never })
    try {
      await expect(saveSetting('sheets.source.members', 'db', 'admin')).rejects.toThrow(/no importer/)
      m(prisma.sheetImportRun.findFirst).mockResolvedValue(null)
      await expect(saveSetting('sheets.source.crews', 'db', 'admin')).rejects.toBeInstanceOf(SettingError)
      await expect(saveSetting('sheets.source.crews', 'db', 'admin')).rejects.toThrow(/import on \/admin\/sheets/)
      expect(prisma.sheetImportRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { dataset: 'crews', mode: 'apply', ok: true } }))
      m(prisma.sheetImportRun.findFirst).mockResolvedValue({ id: 1 })
      await expect(saveSetting('sheets.source.crews', 'db', 'admin')).resolves.toBeTruthy()
      m(prisma.sheetImportRun.findFirst).mockResolvedValue(null)
      await expect(saveSetting('sheets.source.crews', 'sheet', 'admin')).resolves.toBeTruthy()
    } finally {
      DATASETS.splice(0, DATASETS.length, ...restore)
    }
  })
})
