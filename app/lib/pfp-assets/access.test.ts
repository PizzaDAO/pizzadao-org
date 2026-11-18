// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, current: 1, admin: false }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => h.settings[k]) }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn(async () => h.current) }))
vi.mock('@/app/lib/auth-guards', () => ({ isAdminDiscordId: vi.fn(async () => h.admin) }))

import { ForbiddenError } from '@/app/lib/errors/api-errors'
import { assertBaseKindAllowed, assertCanEdit, loadEditAccess } from './access'

beforeEach(() => {
  h.settings = { 'pfp.allowedBaseKinds': ['mafia', 'restyle'], 'pfp.minCompletedLevel': 2 }
  h.current = 1
  h.admin = false
})

describe('allowed base kinds', () => {
  it('refuses upload, discord and static by default, allows mafia and restyle', async () => {
    for (const k of ['upload', 'discord', 'static']) await expect(assertBaseKindAllowed(k)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(assertBaseKindAllowed('mafia')).resolves.toBeUndefined()
    await expect(assertBaseKindAllowed('restyle')).resolves.toBeUndefined()
  })
  it('allows a legacy kind once the setting lists it', async () => {
    h.settings['pfp.allowedBaseKinds'] = ['mafia', 'restyle', 'upload']
    await expect(assertBaseKindAllowed('upload')).resolves.toBeUndefined()
  })
})

describe('level gate (completed level = working-on level - 1)', () => {
  it.each([
    [1, 0, false], // completed Lv. 0
    [2, 1, false], // completed Lv. 1
    [3, 2, true], // completed Lv. 2
    [8, 7, true], // completed Lv. 7
  ])('working-on %i (completed %i) allowed=%s', async (cur, completed, ok) => {
    h.current = cur
    const a = await loadEditAccess('1')
    expect(a).toMatchObject({ completed, allowed: ok, minLevel: 2 })
    if (ok) await expect(assertCanEdit('1')).resolves.toBeUndefined()
    else await expect(assertCanEdit('1')).rejects.toThrow('Reach level 2 to make your PFP.')
  })
  it('follows the setting', async () => {
    h.settings['pfp.minCompletedLevel'] = 1
    h.current = 2
    await expect(assertCanEdit('1')).resolves.toBeUndefined()
  })
  it('admins bypass', async () => {
    h.admin = true
    h.current = 1
    await expect(assertCanEdit('1')).resolves.toBeUndefined()
  })
})
