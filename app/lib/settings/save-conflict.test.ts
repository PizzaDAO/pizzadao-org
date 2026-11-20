// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { saveSetting, SettingError } from './store'
import { clearSettingsCache, getSetting } from './index'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const tx = {
  appSetting: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  appSettingChange: { create: vi.fn() },
}

beforeEach(() => {
  vi.clearAllMocks()
  m(prisma.$transaction).mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  tx.appSetting.findUnique.mockResolvedValue(null)
})

describe('saveSetting with expectedUpdatedAt = null ("only if there is no row yet")', () => {
  it('inserts with create, never upsert', async () => {
    tx.appSetting.create.mockResolvedValue({ updatedAt: new Date() })
    await saveSetting('missions.maxAttempts', 4, 'x', { expectedUpdatedAt: null })
    expect(tx.appSetting.create).toHaveBeenCalled()
    expect(tx.appSetting.upsert).not.toHaveBeenCalled()
  })

  it('a concurrent insert (unique violation) is a 409 conflict and writes no audit row', async () => {
    tx.appSetting.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    const err = await saveSetting('missions.maxAttempts', 4, 'x', { expectedUpdatedAt: null }).catch((e) => e)
    expect(err).toBeInstanceOf(SettingError)
    expect(err.status).toBe(409)
    expect(tx.appSettingChange.create).not.toHaveBeenCalled()
  })

  it('other errors are not turned into conflicts', async () => {
    tx.appSetting.create.mockRejectedValue(new Error('boom'))
    await expect(saveSetting('missions.maxAttempts', 4, 'x', { expectedUpdatedAt: null })).rejects.toThrow('boom')
  })

  it('without expectedUpdatedAt it still upserts', async () => {
    tx.appSetting.upsert.mockResolvedValue({ updatedAt: new Date() })
    await saveSetting('missions.maxAttempts', 4, 'x')
    expect(tx.appSetting.upsert).toHaveBeenCalled()
    expect(tx.appSetting.create).not.toHaveBeenCalled()
  })
})

describe('saving clears the cached settings in this instance', () => {
  it('the next read after a save goes to the database again', async () => {
    const findMany = m(prisma.appSetting.findMany)
    findMany.mockResolvedValue([{ key: 'missions.maxAttempts', value: 5 }])
    clearSettingsCache({ all: true })
    expect(await getSetting('missions.maxAttempts')).toBe(5)
    expect(await getSetting('missions.maxAttempts')).toBe(5)
    expect(findMany).toHaveBeenCalledTimes(1) // cached

    tx.appSetting.upsert.mockResolvedValue({ updatedAt: new Date() })
    findMany.mockResolvedValue([{ key: 'missions.maxAttempts', value: 4 }])
    await saveSetting('missions.maxAttempts', 4, 'x')
    expect(await getSetting('missions.maxAttempts')).toBe(4)
    expect(findMany).toHaveBeenCalledTimes(2)
  })
})
