// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderFlyerPng } from './flyer'

const f = { title: 'Intro to Dough', presenter: 'A. Baker', startsAt: new Date('2026-11-20T23:30:00Z'), timeZone: 'UTC' }

describe('flyer', () => {
  it('renders the 2.5:1 cover and the 1200x630 post as PNGs', async () => {
    for (const [variant, h] of [['cover', 480], ['post', 630]] as const) {
      const png = await renderFlyerPng(f, variant)
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(1200)
      expect(png.readUInt32BE(20)).toBe(h)
    }
  }, 30000)
})
