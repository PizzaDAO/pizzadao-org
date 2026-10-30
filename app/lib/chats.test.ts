// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/telegram/rsv-client', () => ({
  rsvTelegramConfigured: vi.fn(() => true),
  cityGroups: vi.fn(),
}))

import { cityGroups, rsvTelegramConfigured } from '@/app/lib/telegram/rsv-client'

const g = (cityKey: string, chatUrl: string | null) => ({ cityKey, title: null, country: 'X', region: 'r', chatUrl, hasChat: !!chatUrl })

beforeEach(() => {
  vi.resetModules()
  vi.mocked(cityGroups).mockReset()
  vi.mocked(rsvTelegramConfigured).mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')))
})

describe('getCityChats via the rsv.pizza proxy', () => {
  it('reads the directory from the proxy (not Supabase) and skips groups without a link', async () => {
    vi.mocked(cityGroups).mockResolvedValue({ ok: true, groups: [g('addis ababa', 'https://t.me/x'), g('nolink', null), g('- nashville', 'https://t.me/y')] })
    const { getCityChats } = await import('./chats')
    const cities = await getCityChats()
    expect(cities.map((c) => c.slug)).toEqual(['addis-ababa', 'nashville'])
    expect(cities[0]).toMatchObject({ name: 'Addis Ababa', chatUrl: 'https://t.me/x', country: 'X', region: 'r' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to the Supabase read when the proxy is unavailable', async () => {
    vi.mocked(cityGroups).mockResolvedValue({ ok: false, reason: 'unavailable' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('RSVPIZZA_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('RSVPIZZA_SUPABASE_ANON_KEY', 'anon')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ city_key: 'oslo', chat_url: 'https://t.me/o', title: null, country: null, region: null, is_supergroup: true }]))))
    const { getCityChats } = await import('./chats')
    expect((await getCityChats()).map((c) => c.slug)).toEqual(['oslo'])
    vi.unstubAllEnvs()
  })

  it('without the key it keeps using Supabase only', async () => {
    vi.mocked(rsvTelegramConfigured).mockReturnValue(false)
    vi.stubEnv('RSVPIZZA_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('RSVPIZZA_SUPABASE_ANON_KEY', 'anon')
    const { getCityChats } = await import('./chats')
    await getCityChats()
    expect(cityGroups).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
