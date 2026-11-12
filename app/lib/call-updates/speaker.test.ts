import { describe, expect, it, vi } from 'vitest'
import { defaultSpeaker, noopSpeaker, pizzaRadioSpeaker, speakerConfigured } from './speaker'

const PROD = { VERCEL_ENV: 'production', PIZZA_RADIO_URL: 'https://radio.example/', PIZZA_RADIO_API_KEY: 'k' }
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })

describe('speakerConfigured / defaultSpeaker (previews never speak)', () => {
  it('needs production and both pizza-radio vars', () => {
    expect(speakerConfigured(PROD)).toBe(true)
    expect(speakerConfigured({ ...PROD, VERCEL_ENV: 'preview' })).toBe(false)
    expect(speakerConfigured({ ...PROD, VERCEL_ENV: undefined })).toBe(false)
    expect(speakerConfigured({ ...PROD, PIZZA_RADIO_URL: '' })).toBe(false)
    expect(speakerConfigured({ ...PROD, PIZZA_RADIO_API_KEY: ' ' })).toBe(false)
  })

  it('a preview gets the no-op speaker even with the vars set', () => {
    expect(defaultSpeaker({ ...PROD, VERCEL_ENV: 'preview' }).live).toBe(false)
    expect(defaultSpeaker(PROD).live).toBe(true)
  })

  it('the no-op speaker logs "preview, not speaking" and never reaches the network', async () => {
    const log = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const s = noopSpeaker(log)
    expect(await s.play({ channelId: '1', clips: [], pauseMaxMs: 1 })).toEqual({ status: 'skipped', reason: 'preview' })
    expect(await s.stop({ channelId: '1' })).toEqual({ ok: false, reason: 'preview' })
    expect(log).toHaveBeenCalledWith('preview, not speaking')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('pizzaRadioSpeaker', () => {
  const make = (...responses: Response[]) => {
    const f = vi.fn()
    for (const r of responses) f.mockResolvedValueOnce(r)
    return { f, speaker: pizzaRadioSpeaker(PROD, f as unknown as typeof fetch) }
  }
  const call = (f: ReturnType<typeof vi.fn>, n = 0) => {
    const [url, init] = f.mock.calls[n] as [string, RequestInit]
    return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined }
  }

  it('play posts the clips with the bearer key and tag', async () => {
    const { f, speaker } = make(json(200, { status: 'playing' }))
    const r = await speaker.play({ channelId: '123456', clips: [{ url: 'https://r2.example/a', label: 'intro' }], pauseMaxMs: 300000 })
    expect(r).toEqual({ status: 'playing' })
    const c = call(f)
    expect(c.url).toBe('https://radio.example/play-url')
    expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(c.body).toMatchObject({ channelId: '123456', tag: 'updates', ifBusy: 'queue', pauseMaxMs: 300000 })
  })

  it('maps queued, 409 busy-elsewhere and failures', async () => {
    const { speaker } = make(json(200, { status: 'queued' }), json(409, { error: 'busy-elsewhere' }), json(500))
    expect((await speaker.play({ channelId: '1', clips: [], pauseMaxMs: 1 })).status).toBe('queued')
    expect(await speaker.play({ channelId: '1', clips: [], pauseMaxMs: 1 })).toEqual({ status: 'skipped', reason: 'busy-elsewhere' })
    await expect(speaker.play({ channelId: '1', clips: [], pauseMaxMs: 1 })).rejects.toThrow(/HTTP 500/)
  })

  it('pause, resume and skip act on the updates tag; 409 means nothing playing', async () => {
    const { f, speaker } = make(json(200, { paused: true }), json(409, { error: 'nothing-playing' }), json(200))
    expect(await speaker.pause({ pauseMaxMs: 1000 })).toEqual({ ok: true })
    expect(call(f, 0).body).toEqual({ tag: 'updates', pauseMaxMs: 1000 })
    expect(await speaker.resume()).toEqual({ ok: false, reason: 'nothing-playing' })
    expect(await speaker.skip()).toEqual({ ok: true })
    expect(call(f, 2).url).toBe('https://radio.example/skip')
  })

  it('stop leaves, and only acts on this call channel', async () => {
    const { f, speaker } = make(json(200, { stopped: true }), json(200, { stopped: false }))
    expect(await speaker.stop({ channelId: '777' })).toEqual({ ok: true })
    expect(call(f).body).toEqual({ leave: true, channelId: '777' })
    expect(await speaker.stop({ channelId: '777' })).toEqual({ ok: false, reason: 'nothing-playing' })
  })
})
