// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from '@/app/lib/settings'
import { SETTINGS } from '@/app/lib/settings/registry'
import { SHEET_SOURCE_KEYS } from '@/app/lib/settings/sheets-settings'
import { getSource, membersMirrorEnabled, readsFromDb, sourceSettingKey, usesDb } from './source'

const findMany = vi.mocked(prisma.appSetting.findMany)
const rows = (o: Record<string, unknown>) => findMany.mockResolvedValue(Object.entries(o).map(([key, value]) => ({ key, value })) as never)
const prod = (o: Record<string, string> = {}) => ({ VERCEL_ENV: 'production', ...o })

beforeEach(() => {
  clearSettingsCache({ all: true })
  findMany.mockReset()
  findMany.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('sheet sources', () => {
  it('every source defaults to the sheet (deploying changes nothing)', async () => {
    for (const key of SHEET_SOURCE_KEYS) {
      expect(SETTINGS[sourceSettingKey(key)].default).toBe('sheet')
      expect((await getSource(key, prod())).kind).toBe('sheet')
    }
    expect(SETTINGS['sheets.mirror.members'].default).toBe(true)
  })

  it('a saved "db" switches production only', async () => {
    rows({ 'sheets.source.crews': 'db' })
    expect(await getSource('crews', prod())).toMatchObject({ kind: 'db', reason: 'setting' })
    clearSettingsCache()
    expect(await getSource('crews', { VERCEL_ENV: 'preview' })).toMatchObject({ kind: 'sheet', reason: 'preview' })
    expect(await getSource('crews', {})).toMatchObject({ kind: 'sheet', reason: 'preview' })
  })

  it('env "sheet" is a kill switch that beats a saved "db"', async () => {
    rows({ 'sheets.source.members': 'db' })
    expect(await getSource('members', prod({ SHEETS_SOURCE_MEMBERS: 'sheet' }))).toMatchObject({ kind: 'sheet', reason: 'env-kill' })
    expect(await getSource('members', prod({ SHEETS_SOURCE_MEMBERS: 'SHEET ' }))).toMatchObject({ kind: 'sheet' })
  })

  it('env "db" flips a preview; an unreadable env value fails toward the sheet', async () => {
    expect(await getSource('crews', { VERCEL_ENV: 'preview', SHEETS_SOURCE_CREWS: 'db' })).toMatchObject({ kind: 'db', reason: 'env' })
    expect(await getSource('crews', { VERCEL_ENV: 'preview', SHEETS_SOURCE_CREWS: 'banana' })).toMatchObject({ kind: 'sheet', reason: 'env-kill' })
  })

  it('crew tasks accept a per-crew pilot list; other sets do not', async () => {
    expect(SETTINGS['sheets.source.crewTasks'].schema.safeParse('db:ops,tech').success).toBe(true)
    expect(SETTINGS['sheets.source.crews'].schema.safeParse('db:ops').success).toBe(false)
    expect(SETTINGS['sheets.source.crewTasks'].schema.safeParse('db:Bad Id').success).toBe(false)
    rows({ 'sheets.source.crewTasks': 'db:ops,tech' })
    const s = await getSource('crewTasks', prod())
    expect(readsFromDb(s, 'ops')).toBe(true)
    expect(readsFromDb(s, 'music')).toBe(false)
    expect(readsFromDb(s)).toBe(false)
    clearSettingsCache()
    expect(await usesDb('crewTasks', 'tech')).toBe(false) // process.env is not production in tests
  })

  it('a failed settings read keeps the last value in force', async () => {
    rows({ 'sheets.source.crews': 'db' })
    expect((await getSource('crews', prod())).kind).toBe('db')
    clearSettingsCache()
    findMany.mockRejectedValue(new Error('down'))
    expect((await getSource('crews', prod())).kind).toBe('db')
  })

  it('members mirror: on by default, off by env kill or saved off', async () => {
    expect(await membersMirrorEnabled(prod())).toBe(true)
    expect(await membersMirrorEnabled(prod({ SHEETS_MIRROR_MEMBERS: 'off' }))).toBe(false)
    rows({ 'sheets.mirror.members': false })
    clearSettingsCache()
    expect(await membersMirrorEnabled(prod())).toBe(false)
  })
})
