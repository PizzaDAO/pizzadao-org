// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  broadcastIdFromUrl,
  buildManifest,
  discoverBroadcasts,
  manifestToCsv,
  parseArchiveJs,
  parseManifest,
  parseManualCsv,
  parseTweetDate,
} from './import-archive'

const ID1 = 'AbCdEfGh12345'
const ID2 = 'ZyXwVuTs98765'

describe('broadcastIdFromUrl', () => {
  it('reads every link shape', () => {
    expect(broadcastIdFromUrl(`https://x.com/i/broadcasts/${ID1}`)).toBe(ID1)
    expect(broadcastIdFromUrl(`https://twitter.com/i/broadcasts/${ID1}?s=20`)).toBe(ID1)
    expect(broadcastIdFromUrl(`https://www.pscp.tv/w/${ID1}`)).toBe(ID1)
    expect(broadcastIdFromUrl(`https://periscope.tv/w/${ID1}`)).toBe(ID1)
    expect(broadcastIdFromUrl(`https://www.pscp.tv/some_user/${ID1}`)).toBe(ID1)
  })
  it('ignores other links', () => {
    expect(broadcastIdFromUrl('https://x.com/i/spaces/1abcdefghijk')).toBeNull()
    expect(broadcastIdFromUrl('https://example.org/i/broadcasts/AbCdEfGh12345')).toBeNull()
    expect(broadcastIdFromUrl('https://x.com/i/broadcasts/short')).toBeNull()
  })
})

describe('parseTweetDate', () => {
  it('parses the archive format and ISO dates', () => {
    expect(parseTweetDate('Wed Oct 28 18:32:12 +0000 2020')).toBe('2020-10-28T18:32:12.000Z')
    expect(parseTweetDate('Wed Oct 28 18:32:12 -0500 2020')).toBe('2020-10-28T23:32:12.000Z')
    expect(parseTweetDate('2021-02-03T04:05:06Z')).toBe('2021-02-03T04:05:06.000Z')
    expect(parseTweetDate('nope')).toBeNull()
    expect(parseTweetDate(5)).toBeNull()
  })
})

describe('archive discovery', () => {
  const js = `window.YTD.tweets.part0 = ${JSON.stringify([
    { tweet: { created_at: 'Wed Oct 28 18:32:12 +0000 2020', full_text: 'Community call live now', entities: { urls: [{ url: 'https://t.co/x', expanded_url: `https://twitter.com/i/broadcasts/${ID1}` }] } } },
    // same broadcast linked again later, in another shape
    { tweet: { created_at: 'Thu Oct 29 10:00:00 +0000 2020', full_text: `Replay https://pscp.tv/w/${ID1}`, entities: { urls: [] } } },
    { tweet: { created_at: 'Fri Oct 30 10:00:00 +0000 2020', full_text: 'x', entities: { urls: [{ expanded_url: `https://www.periscope.tv/someone/${ID2}` }] } } },
    { tweet: { created_at: 'Fri Oct 30 11:00:00 +0000 2020', full_text: 'no links here', entities: { urls: [] } } },
    'garbage',
  ])}`

  it('strips the wrapper and finds the unique broadcasts, earliest post first', () => {
    const found = discoverBroadcasts(parseArchiveJs(js))
    expect(found.map((c) => [c.externalId, c.key, c.url, c.postedAt])).toEqual([
      [ID1, `x-broadcast-${ID1}`, `https://x.com/i/broadcasts/${ID1}`, '2020-10-28T18:32:12.000Z'],
      [ID2, `x-broadcast-${ID2}`, `https://x.com/i/broadcasts/${ID2}`, '2020-10-30T10:00:00.000Z'],
    ])
  })
  it('rejects a file that is not archive data', () => {
    expect(() => parseArchiveJs('hello')).toThrow()
    expect(() => parseArchiveJs('x = {"a":1}')).toThrow()
  })
})

describe('manual csv and manifest', () => {
  const csv = `url,started_at_utc,title,crew_id,include\nhttps://x.com/i/broadcasts/${ID1},2020-10-28T18:00:00Z,"Call, with comma",,y\nnot a link,,,,\n,,,,`

  it('reads usable rows and reports the bad lines', () => {
    const { rows, rejected } = parseManualCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Call, with comma', crewId: 'community_call', include: 'y', startedAt: '2020-10-28T18:00:00.000Z' })
    expect(rejected).toEqual([3])
  })

  it('builds a manifest without overwriting the owner edits and round-trips CSV', () => {
    const archive = discoverBroadcasts([{ tweet: { created_at: 'Wed Oct 28 18:32:12 +0000 2020', full_text: `https://x.com/i/broadcasts/${ID1}` } }, { tweet: { created_at: 'Wed Oct 28 19:32:12 +0000 2020', full_text: `https://x.com/i/broadcasts/${ID2}` } }])
    const first = buildManifest([], archive, [])
    first[0].include = 'y'
    first[0].title = '=HYPERLINK("x")'
    const text = manifestToCsv(first)
    expect(text).toContain("'=HYPERLINK")
    const reread = parseManifest(text)
    expect(reread).toHaveLength(2)
    const again = buildManifest(reread, archive, parseManualCsv(csv).rows)
    expect(again).toHaveLength(2)
    expect(again[0].include).toBe('y')
    expect(again.find((r) => r.external_id === ID1)?.title).toBe("'=HYPERLINK(\"x\")")
  })
})
