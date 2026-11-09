// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { publicProfilePath, publicProfileUrl, composeShareText, shareOrCopy } from './share-profile'

afterEach(() => vi.unstubAllGlobals())

describe('profile link helpers', () => {
  it('builds the public profile path and url, never a dashboard link', () => {
    expect(publicProfilePath('42')).toBe('/profile/42')
    expect(publicProfileUrl('42', 'https://app.example/')).toBe('https://app.example/profile/42')
    expect(composeShareText('Vouch for me on PizzaDAO:', 'https://x/profile/42')).toBe('Vouch for me on PizzaDAO: https://x/profile/42')
  })
})

describe('shareOrCopy', () => {
  const opts = { text: 'Vouch for me on PizzaDAO:', url: 'https://x/profile/42' }

  it('uses the Web Share API when present', async () => {
    const share = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { share })
    expect(await shareOrCopy(opts)).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: undefined, text: opts.text, url: opts.url })
  })

  it('does not copy when the share sheet is dismissed', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', {
      share: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) }),
      clipboard: { writeText },
    })
    expect(await shareOrCopy(opts)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies text plus link when sharing is unavailable or fails', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await shareOrCopy(opts)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('Vouch for me on PizzaDAO: https://x/profile/42')
    vi.stubGlobal('navigator', { share: vi.fn(async () => { throw new Error('nope') }), clipboard: { writeText } })
    expect(await shareOrCopy(opts)).toBe('copied')
  })

  it('reports failure when nothing works', async () => {
    vi.stubGlobal('navigator', {})
    expect(await shareOrCopy(opts)).toBe('failed')
  })
})
