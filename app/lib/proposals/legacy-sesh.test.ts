// @vitest-environment node
// The Sesh grace window: only a Discord poll posted BEFORE go-live, only until the end date, never otherwise.
import { describe, expect, it } from 'vitest'
import { discordMessageLinkTime, graceEnd, legacySeshAllowed, seshWindowOpen, snowflakeTime } from './legacy-sesh'

const DAY = 24 * 3600_000
const EPOCH = 1420070400000
/** A snowflake whose embedded time is `t` (synthetic ids only). */
const flake = (t: Date) => (BigInt(t.getTime() - EPOCH) * BigInt(4194304)).toString()
const link = (t: Date, host = 'discord.com') => `https://${host}/channels/123456789012345678/223456789012345678/${flake(t)}`

const live = new Date('2026-12-01T18:00:00Z')

describe('snowflakes and links', () => {
  it('decodes the creation time of a Discord id', () => {
    const t = new Date('2026-11-20T10:30:00.000Z')
    expect(snowflakeTime(flake(t))?.toISOString()).toBe(t.toISOString())
    expect(snowflakeTime('abc')).toBeNull()
  })

  it('reads the message time from message links only', () => {
    const t = new Date('2026-11-20T10:30:00Z')
    expect(discordMessageLinkTime(link(t))?.getTime()).toBe(t.getTime())
    expect(discordMessageLinkTime(link(t, 'ptb.discord.com'))?.getTime()).toBe(t.getTime())
    expect(discordMessageLinkTime(link(t, 'discordapp.com'))?.getTime()).toBe(t.getTime())
    for (const bad of ['https://example.com/poll', 'http://discord.com/channels/1/2/3', 'https://discord.com/channels/123456789012345678/223456789012345678', `https://evil.com/?u=${link(t)}`, '', null, undefined]) {
      expect(discordMessageLinkTime(bad as string)).toBeNull()
    }
  })
})

describe('the window', () => {
  it('ends the saved date (inclusive), else 30 days after go-live; no go-live, no window', () => {
    expect(graceEnd(live, '2026-12-20')?.toISOString()).toBe('2026-12-21T00:00:00.000Z')
    expect(graceEnd(live, '')?.getTime()).toBe(live.getTime() + 30 * DAY)
    expect(graceEnd(null, '')).toBeNull()
    expect(seshWindowOpen({ liveSince: null, untilDate: '' }, live)).toBe(false)
    expect(seshWindowOpen({ liveSince: live, untilDate: '' }, new Date(live.getTime() + 29 * DAY))).toBe(true)
    expect(seshWindowOpen({ liveSince: live, untilDate: '' }, new Date(live.getTime() + 31 * DAY))).toBe(false)
  })

  const now = new Date(live.getTime() + 3 * DAY)

  it('allows a poll posted before go-live, inside the window', () => {
    expect(legacySeshAllowed(link(new Date(live.getTime() - 2 * DAY)), live, '', now)).toBe(true)
  })

  it('blocks a poll posted after go-live, whatever the dates', () => {
    expect(legacySeshAllowed(link(new Date(live.getTime() + 1000)), live, '', now)).toBe(false)
    expect(legacySeshAllowed(link(new Date(live.getTime() + DAY)), live, '2030-01-01', now)).toBe(false)
  })

  it('blocks everything once the window has closed (saved end date or 30 days)', () => {
    const old = link(new Date(live.getTime() - DAY))
    expect(legacySeshAllowed(old, live, '', new Date(live.getTime() + 31 * DAY))).toBe(false)
    expect(legacySeshAllowed(old, live, '2026-12-02', now)).toBe(false) // a past end date closes it early
    expect(legacySeshAllowed(old, live, '2026-12-04', now)).toBe(true)
  })

  it('fails closed: no go-live moment, a bad link, or a non-Discord link', () => {
    const old = link(new Date(live.getTime() - DAY))
    expect(legacySeshAllowed(old, null, '', now)).toBe(false)
    expect(legacySeshAllowed('https://example.com/poll', live, '', now)).toBe(false)
    expect(legacySeshAllowed(null, live, '', now)).toBe(false)
  })
})
