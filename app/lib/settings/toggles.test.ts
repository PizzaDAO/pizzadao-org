// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from './index'
import { SETTINGS, SETTING_KEYS } from './registry'
import { TOGGLES, envKillsToggle, toggleEnabled, type ToggleKey } from './toggles'
import { disavowEnabled } from '@/app/lib/disavow/constants'
import { callAgendaEnabled } from '@/app/lib/call-agenda/run'
import { recapPostingEnabled } from '@/app/lib/calls/recap'
import { missionVerifiersEnabled } from '@/app/lib/mission-verify/policy'
import { reviewCardsEnabled } from '@/app/lib/mission-verify/review-cards'
import { reengageEnabled } from '@/app/lib/reengage/run'
import { gamesEnabled } from '@/app/lib/pep-games/config'
import { itemGrantClaimsEnabled } from '@/app/lib/shop-grants'
import { shopSheetSyncEnabled } from '@/app/lib/shop'

const findMany = vi.mocked(prisma.appSetting.findMany)
const rows = (o: Record<string, unknown>) => findMany.mockResolvedValue(Object.entries(o).map(([key, value]) => ({ key, value })) as never)
// Saved rows only count on a production deploy (see the preview test below).
const env = (o: Record<string, string>) => ({ VERCEL_ENV: 'production', ...o }) as unknown as NodeJS.ProcessEnv

beforeEach(() => {
  clearSettingsCache({ all: true })
  findMany.mockReset()
  findMany.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('VERCEL_ENV', 'production')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('feature switches: env stays the fallback and the kill switch', () => {
  it('every switch in the registry has an env var, and the registry default is the legacy default', () => {
    const switches = SETTING_KEYS.filter((k) => SETTINGS[k].input.type === 'bool')
    expect(switches.sort()).toEqual((Object.keys(TOGGLES) as ToggleKey[]).sort())
    for (const k of Object.keys(TOGGLES) as ToggleKey[]) {
      // With the env var unset, the legacy behaviour is exactly the registry default.
      expect(TOGGLES[k].legacy(undefined)).toBe(SETTINGS[k].default)
    }
  })

  it('with no rows, production env that is ON today stays ON (disavow, agenda, recap)', async () => {
    const prod = env({ DISAVOW_ENABLED: 'true', CALL_AGENDA_POST_ENABLED: 'true', CALL_RECAP_POST_ENABLED: 'true' })
    expect(await disavowEnabled(prod)).toBe(true)
    expect(await callAgendaEnabled(prod)).toBe(true)
    expect(await recapPostingEnabled(prod)).toBe(true)
  })

  it('with no rows, each switch follows its env var exactly as before', async () => {
    expect(await missionVerifiersEnabled(env({}))).toBe(false)
    expect(await missionVerifiersEnabled(env({ MISSION_VERIFIERS_ENABLED: 'yes' }))).toBe(true)
    expect(await reviewCardsEnabled(env({ MISSION_REVIEW_CARDS_ENABLED: 'on' }))).toBe(true)
    expect(await reengageEnabled(env({ REENGAGE_EMAIL_ENABLED: 'true' }))).toBe(true)
    expect(await reengageEnabled(env({ REENGAGE_EMAIL_ENABLED: '1' }))).toBe(false) // only "true" ever enabled it
    expect(await toggleEnabled('onboarding.traineeNickEnabled', env({ TRAINEE_NICK_ENABLED: 'true' }))).toBe(true)
    expect(await toggleEnabled('portrait.enabled', env({ MAFIA_PORTRAIT_ENABLED: '1' }))).toBe(true)
    expect(await toggleEnabled('crime.enabled', env({ PEP_CRIME_ENABLED: '1' }))).toBe(true)
    expect(await toggleEnabled('crime.enabled', env({ PEP_CRIME_ENABLED: 'true' }))).toBe(false)
    expect(await shopSheetSyncEnabled(env({ SHOP_SHEET_SYNC_ENABLED: '1' }))).toBe(true)
    expect(await shopSheetSyncEnabled(env({ SHOP_SHEET_SYNC_ENABLED: 'true' }))).toBe(false)
  })

  it('item grants stay ON unless paused', async () => {
    expect(await toggleEnabled('shop.itemGrantsEnabled', env({}))).toBe(true)
    expect(await toggleEnabled('shop.itemGrantsEnabled', env({ ITEM_GRANT_CLAIMS: '0' }))).toBe(false)
    rows({ 'shop.itemGrantsEnabled': false })
    clearSettingsCache()
    expect(await toggleEnabled('shop.itemGrantsEnabled', env({}))).toBe(false)
  })

  it('a saved setting takes over from env (on and off)', async () => {
    rows({ 'calls.recapPostEnabled': true })
    expect(await recapPostingEnabled(env({}))).toBe(true)
    expect(await recapPostingEnabled(env({ CALL_RECAP_POST_ENABLED: 'true' }))).toBe(true)
    clearSettingsCache()
    rows({ 'calls.recapPostEnabled': false })
    expect(await recapPostingEnabled(env({ CALL_RECAP_POST_ENABLED: 'true' }))).toBe(false)
  })

  it('env set to off is a kill switch that always wins, even over a saved ON', async () => {
    rows({ 'disavow.enabled': true, 'missions.verifiersEnabled': true, 'shop.itemGrantsEnabled': true })
    for (const off of ['0', 'false', 'off', 'No', ' FALSE ']) {
      expect(envKillsToggle(off)).toBe(true)
      expect(await disavowEnabled(env({ DISAVOW_ENABLED: off }))).toBe(false)
    }
    expect(await missionVerifiersEnabled(env({ MISSION_VERIFIERS_ENABLED: '0' }))).toBe(false)
    expect(await toggleEnabled('shop.itemGrantsEnabled', env({ ITEM_GRANT_CLAIMS: '0' }))).toBe(false)
    // not a kill word
    expect(envKillsToggle('true')).toBe(false)
    expect(envKillsToggle('')).toBe(false)
    expect(envKillsToggle(undefined)).toBe(false)
  })

  it('settings unreadable: every switch that posts, pays or emails goes OFF, even with env ON', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const allOn = env({
      MISSION_VERIFIERS_ENABLED: '1', MISSION_REVIEW_CARDS_ENABLED: '1', CALL_RECAP_POST_ENABLED: '1', CALL_AGENDA_POST_ENABLED: '1',
      DISAVOW_ENABLED: 'true', REENGAGE_EMAIL_ENABLED: 'true', TRAINEE_NICK_ENABLED: 'true', PEP_GAMES_ENABLED: '1',
      PEP_CRIME_ENABLED: '1', MAFIA_PORTRAIT_ENABLED: '1', SHOP_SHEET_SYNC_ENABLED: '1',
    })
    for (const k of Object.keys(TOGGLES) as ToggleKey[]) expect(await toggleEnabled(k, allOn), k).toBe(false)
    expect(await gamesEnabled()).toBe(false)
    expect(await itemGrantClaimsEnabled()).toBe(false)
  })

  it('a stored value that fails its schema also counts as unreadable (off)', async () => {
    rows({ 'disavow.enabled': 'yes' })
    expect(await disavowEnabled(env({ DISAVOW_ENABLED: 'true' }))).toBe(false)
  })

  it('on a preview (not production) saved rows are ignored: a saved ON never reaches it, env decides', async () => {
    rows({ 'disavow.enabled': true, 'games.enabled': true, 'calls.recapPostEnabled': false })
    const preview = (o: Record<string, string>) => ({ VERCEL_ENV: 'preview', ...o }) as unknown as NodeJS.ProcessEnv
    expect(await disavowEnabled(preview({}))).toBe(false)
    expect(await toggleEnabled('games.enabled', preview({}))).toBe(false)
    // env alone still works, and a saved OFF does not switch an env-ON preview off
    expect(await recapPostingEnabled(preview({ CALL_RECAP_POST_ENABLED: 'true' }))).toBe(true)
    // kill switch still wins
    expect(await disavowEnabled(preview({ DISAVOW_ENABLED: 'false' }))).toBe(false)
    // and with no VERCEL_ENV at all (local) it is the same
    expect(await disavowEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })
})
