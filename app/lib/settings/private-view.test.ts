// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from './index'
import { listChanges, listSettingViews, maskPrivate } from './store'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB'

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache({ all: true })
  m(prisma.appSetting.findMany).mockResolvedValue([{ key: 'payments.formSheetId', value: SHEET, updatedAt: new Date('2026-11-01T00:00:00Z'), updatedBy: 'x' }])
})

describe('private settings are masked in the admin views', () => {
  it('shows "set" / "not set", never the value, in value, override and default', async () => {
    const v = (await listSettingViews()).find((s) => s.key === 'payments.formSheetId')
    expect(v).toMatchObject({ value: 'set', override: 'set', default: 'not set', modified: true })
    expect(JSON.stringify(v)).not.toContain(SHEET)
    m(prisma.appSetting.findMany).mockResolvedValue([])
    const none = (await listSettingViews()).find((s) => s.key === 'payments.formSheetId')
    expect(none).toMatchObject({ value: 'not set', override: null })
  })

  it('masks the audit history too, and leaves ordinary settings alone', async () => {
    m(prisma.appSettingChange.findMany).mockResolvedValue([
      { id: 1, key: 'payments.formSheetId', oldValue: null, newValue: SHEET, changedBy: 'x', changedAt: new Date(), note: null },
      { id: 2, key: 'missions.maxAttempts', oldValue: 3, newValue: 4, changedBy: 'x', changedAt: new Date(), note: null },
    ])
    const rows = await listChanges()
    expect(rows[0]).toMatchObject({ oldValue: null, newValue: 'set' })
    expect(rows[1]).toMatchObject({ oldValue: 3, newValue: 4 })
  })

  it('maskPrivate', () => {
    expect(maskPrivate('')).toBe('not set')
    expect(maskPrivate('x')).toBe('set')
    expect(maskPrivate(null)).toBeNull()
  })
})
