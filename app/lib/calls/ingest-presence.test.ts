import { describe, expect, it } from 'vitest'
import { parseIngestPayload } from './ingest-schema'

const SESSION = 'ev1394003497153724497-1760000000000'
const A = '111111111111111111'
const body = (over: Record<string, unknown> = {}) => ({
  sessionId: SESSION,
  eventId: '1394003497153724497',
  eventName: 'Ops',
  channelId: '823956905739026442',
  startedAt: '2026-11-03T00:30:00.000Z',
  endedAt: '2026-11-03T01:30:00.000Z',
  endReason: 'empty',
  speakers: [],
  ...over,
})

describe('ingest presence', () => {
  it('is empty when an older recorder sends none', () => {
    expect(parseIngestPayload(body()).presence).toEqual([])
  })

  it('accepts measured presence and ignores unknown fields', () => {
    const p = parseIngestPayload(body({ presence: [{ discordId: A, presentSec: 1800, firstSeenMs: 0, lastSeenMs: 1800000, extra: 'x' }], somethingNew: 1 }))
    expect(p.presence).toEqual([{ discordId: A, presentSec: 1800, firstSeenMs: 0, lastSeenMs: 1800000 }])
  })

  it('drops bad entries instead of failing the ingest', () => {
    const p = parseIngestPayload(
      body({
        presence: [
          { discordId: 'nope', presentSec: 10, firstSeenMs: 0, lastSeenMs: 0 },
          { discordId: A, presentSec: -1, firstSeenMs: 0, lastSeenMs: 0 },
          { discordId: A, presentSec: 'x', firstSeenMs: 0, lastSeenMs: 0 },
          { discordId: A, presentSec: 90_000, firstSeenMs: 0, lastSeenMs: 0 },
          { discordId: A, presentSec: 60, firstSeenMs: 0, lastSeenMs: 60000 },
          { discordId: A, presentSec: 70, firstSeenMs: 0, lastSeenMs: 70000 },
          'junk',
        ],
      }),
    )
    expect(p.presence).toEqual([{ discordId: A, presentSec: 60, firstSeenMs: 0, lastSeenMs: 60000 }])
  })

  it('a non-array presence is ignored', () => {
    expect(parseIngestPayload(body({ presence: 'x' })).presence).toEqual([])
  })
})
