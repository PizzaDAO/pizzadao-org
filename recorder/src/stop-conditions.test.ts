import { describe, expect, it } from 'vitest'
import { StopTracker } from './stop-conditions.js'

const MIN = 60_000
const limits = { maxCallMs: 120 * MIN, emptyGraceMs: 5 * MIN }

describe('StopTracker', () => {
  it('keeps recording while humans are present', () => {
    const t = new StopTracker(0, limits)
    t.observeHumans(3, 1 * MIN)
    expect(t.check(60 * MIN)).toBeNull()
  })

  it('stops once the channel has had no humans for 5 minutes', () => {
    const t = new StopTracker(0, limits)
    t.observeHumans(2, 10 * MIN)
    t.observeHumans(0, 20 * MIN)
    expect(t.check(24 * MIN + 59_000)).toBeNull()
    expect(t.check(25 * MIN)).toBe('empty')
  })

  it('does not restart the empty clock on repeated empty observations', () => {
    const t = new StopTracker(0, limits)
    t.observeHumans(0, 10 * MIN)
    t.observeHumans(0, 12 * MIN)
    t.observeHumans(0, 14 * MIN)
    expect(t.check(15 * MIN)).toBe('empty')
  })

  it('resets when someone returns', () => {
    const t = new StopTracker(0, limits)
    t.observeHumans(0, 10 * MIN)
    t.observeHumans(1, 13 * MIN)
    t.observeHumans(0, 14 * MIN)
    expect(t.check(18 * MIN)).toBeNull()
    expect(t.check(19 * MIN)).toBe('empty')
  })

  it('stops an empty channel from the start after the grace period', () => {
    const t = new StopTracker(0, limits)
    t.observeHumans(0, 0)
    expect(t.check(4 * MIN)).toBeNull()
    expect(t.check(5 * MIN)).toBe('empty')
  })

  it('stops at the maximum duration even with people present', () => {
    const t = new StopTracker(1_000, limits)
    t.observeHumans(5, 100 * MIN)
    expect(t.check(1_000 + 120 * MIN - 1)).toBeNull()
    expect(t.check(1_000 + 120 * MIN)).toBe('max-duration')
  })

  it('reports max-duration when both limits are hit', () => {
    const t = new StopTracker(0, { maxCallMs: 10 * MIN, emptyGraceMs: 1 * MIN })
    t.observeHumans(0, 1 * MIN)
    expect(t.check(10 * MIN)).toBe('max-duration')
  })

  describe('no-show protection (event set ACTIVE before anyone arrives)', () => {
    const start = 18 * 60 * MIN // 18:00 session start
    const noShowUntil = start + 30 * MIN // scheduled 18:15 + 15
    const mk = () => new StopTracker(start, limits, noShowUntil)

    it('does not stop as empty at 18:05 when no human has ever been present', () => {
      const t = mk()
      t.observeHumans(0, start)
      expect(t.check(start + 5 * MIN)).toBeNull()
      expect(t.check(start + 29 * MIN)).toBeNull()
    })

    it('keeps recording when people arrive at 18:15 and talk on', () => {
      const t = mk()
      t.observeHumans(0, start)
      t.observeHumans(4, start + 15 * MIN)
      expect(t.check(start + 40 * MIN)).toBeNull()
    })

    it('applies the normal grace once humans were present and left', () => {
      const t = mk()
      t.observeHumans(0, start)
      t.observeHumans(2, start + 15 * MIN)
      t.observeHumans(0, start + 20 * MIN)
      expect(t.check(start + 24 * MIN)).toBeNull()
      expect(t.check(start + 25 * MIN)).toBe('empty')
    })

    it('may stop as empty after scheduled start + 15 minutes if nobody ever came', () => {
      const t = mk()
      t.observeHumans(0, start)
      expect(t.check(start + 30 * MIN)).toBe('empty')
    })

    it('max duration still applies', () => {
      const t = mk()
      t.observeHumans(0, start)
      expect(t.check(start + 120 * MIN)).toBe('max-duration')
    })

    it('without a deadline (null) the old behaviour holds', () => {
      const t = new StopTracker(start, limits, null)
      t.observeHumans(0, start)
      expect(t.check(start + 5 * MIN)).toBe('empty')
    })
  })
})
