// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

describe('server clock persistence', () => {
  it('restores the stored offset on load, before any Date header', async () => {
    sessionStorage.clear()
    localStorage.setItem('pizzadao:proposals-clock', JSON.stringify({ offset: 5 * 60_000, at: Date.now() }))
    const c = await import('./client')
    expect(Math.abs(c.serverNow() - (Date.now() + 5 * 60_000))).toBeLessThan(2000)
  })
  it('stores the offset in both session and local storage when a Date header arrives', async () => {
    const c = await import('./client')
    c.noteServerDate({ headers: { get: () => new Date(Date.now() + 60_000).toUTCString() } })
    expect(JSON.parse(sessionStorage.getItem('pizzadao:proposals-clock')!).offset).toBeGreaterThan(50_000)
    expect(JSON.parse(localStorage.getItem('pizzadao:proposals-clock')!).offset).toBeGreaterThan(50_000)
  })
})
