// @vitest-environment node
// The Phase 4 semi-automatic verifiers, every upstream mocked (an injected
// fetch): X oEmbed, Neynar, POAP Compass, YouTube / Loom oEmbed, rsv.pizza.
// Nothing here reaches the network.
import { describe, it, expect, vi } from 'vitest'
import { gppHost, mediaProof, poapDrop, socialPost } from './semi'
import type { VerifierSources, VerifyCtx, VerifyResult } from './types'

const ME = '300000000000000001'

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | null | undefined
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch that answers from `routes` (first match by URL prefix) and fails everything else. */
function mockFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    for (const [prefix, route] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        const r = await route(url, init)
        if (r) return r
      }
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function sources(over: Partial<VerifierSources> = {}): VerifierSources {
  return {
    getXAccount: vi.fn(async () => ({ xUsername: 'PizzaFan' })),
    countCallsAttended: vi.fn(async () => ({ total: 0, calls: 0, byCrew: {} })),
    getMemberRoles: vi.fn(async () => []),
    resolveRoleIds: vi.fn(async () => []),
    guildId: () => null,
    resolveChannelId: vi.fn(async () => null),
    getChannelMessage: vi.fn(async () => null),
    getChannel: vi.fn(async () => null),
    countWallets: vi.fn(async () => 0),
    getReferrals: vi.fn(async () => []),
    sharedSignalKinds: vi.fn(async () => []),
    getFarcasterAccounts: vi.fn(async () => [{ username: 'pizzafan', fid: 4242 }]),
    getTelegramUsername: vi.fn(async () => 'pizzafan_tg'),
    fetch: mockFetch({}) as unknown as typeof fetch,
    neynarApiKey: () => null,
    rsvPizzaApiUrl: () => 'https://api.rsv.example',
    rsvPizzaServiceKey: () => null,
    getWalletAddresses: vi.fn(async () => ['0xAbCdEf0123456789aBcDeF0123456789AbCdEf01']),
    ...over,
  }
}

const ctx = (src: VerifierSources, evidence: string | null): VerifyCtx => ({
  discordId: ME,
  memberId: '1234',
  trigger: 'submit',
  now: new Date('2026-10-03T00:00:00Z'),
  evidence,
  sources: src,
  memo: new Map(),
})

type Review = Extract<VerifyResult, { status: 'needs_review' }>
const asReview = (r: VerifyResult): Review => {
  expect(r.status).toBe('needs_review')
  return r as Review
}
const oks = (r: Review) => r.checks.map((c) => c.ok)

// ------------------------------------------------------------- social_post ---

describe('social_post (L2.1, D15)', () => {
  const params = socialPost.parse({ minReplies: 3, minLikes: 10, platforms: ['x', 'farcaster'] })
  const xOembed = (author: string) =>
    json({ author_url: `https://twitter.com/${author}`, html: '<blockquote><p>gm <a href="https://t.co/x">pic.twitter.com/x</a> PizzaDAO 🍕</p>&mdash; Fan (@x) <a>Oct 1</a></blockquote>' })

  it('X: the handle in the link and the oEmbed author both match the linked X; engagement left to the reviewer', async () => {
    const f = mockFetch({ 'https://publish.twitter.com/oembed': () => xOembed('pizzafan') })
    const r = asReview(await socialPost.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://x.com/PizzaFan/status/1844000000000000001?s=20'), params))
    expect(oks(r)).toEqual([true, true, true, null])
    expect(r.confidence).toBe('medium')
    expect(r.evidence).toMatchObject({ platform: 'x', statusId: '1844000000000000001', urlHandle: 'PizzaFan', linkedHandle: 'PizzaFan', author: 'pizzafan' })
    expect(r.evidence.text).toContain('gm')
    expect(r.evidence.text).not.toContain('pic.twitter.com')
    expect(r.checks[3].label).toMatch(/3\+ comments and 10\+ likes/)
    expect(String(f.mock.calls[0][0])).toContain(encodeURIComponent('https://x.com/PizzaFan/status/1844000000000000001'))
  })

  it("X: someone else's post (handle in the URL is spoofable, oEmbed tells the truth) is low confidence", async () => {
    const f = mockFetch({ 'https://publish.twitter.com/oembed': () => xOembed('someoneelse') })
    const r = asReview(await socialPost.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://twitter.com/PizzaFan/status/1844000000000000001'), params))
    expect(oks(r)).toEqual([true, true, false, null])
    expect(r.confidence).toBe('low')
  })

  it('X: no linked X account, and X oEmbed down: low, nothing thrown', async () => {
    const f = mockFetch({ 'https://publish.twitter.com/oembed': () => new Response('busy', { status: 503 }) })
    const src = sources({ fetch: f as unknown as typeof fetch, getXAccount: vi.fn(async () => null) })
    const r = asReview(await socialPost.check(ctx(src, 'https://x.com/someone/status/1844000000000000001'), params))
    expect(oks(r)).toEqual([true, false, null, null])
    expect(r.confidence).toBe('low')
  })

  it('X: a network error on oEmbed is "unchecked", never a failure', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const r = asReview(await socialPost.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://x.com/PizzaFan/status/1844000000000000001'), params))
    expect(oks(r)).toEqual([true, true, null, null])
  })

  it('Farcaster with NEYNAR_API_KEY: author fid matches a linked account, likes and replies counted', async () => {
    const f = mockFetch({
      'https://api.neynar.com/v2/farcaster/cast': (_url, init) => {
        expect((init?.headers as Record<string, string>)['x-api-key']).toBe('neynar-test')
        return json({ cast: { author: { fid: 4242, username: 'pizzafan' }, text: 'PizzaDAO rules', reactions: { likes_count: 25 }, replies: { count: 4 } } })
      },
    })
    const src = sources({ fetch: f as unknown as typeof fetch, neynarApiKey: () => 'neynar-test' })
    const r = asReview(await socialPost.check(ctx(src, 'https://warpcast.com/pizzafan/0xabc12345'), params))
    expect(oks(r)).toEqual([true, true, true, true])
    expect(r.confidence).toBe('high')
    expect(r.evidence).toMatchObject({ platform: 'farcaster', authorFid: 4242, likes: 25, replies: 4 })
    expect(String(f.mock.calls[0][0])).toBe(
      `https://api.neynar.com/v2/farcaster/cast?type=url&identifier=${encodeURIComponent('https://warpcast.com/pizzafan/0xabc12345')}`,
    )
  })

  it('Farcaster with a key: another author, too few likes', async () => {
    const f = mockFetch({
      'https://api.neynar.com/': () => json({ cast: { author: { fid: 1, username: 'other' }, reactions: { likes_count: 2 }, replies: { count: 3 } } }),
    })
    const src = sources({ fetch: f as unknown as typeof fetch, neynarApiKey: () => 'k' })
    const r = asReview(await socialPost.check(ctx(src, 'https://farcaster.xyz/other/0xabc12345'), params))
    expect(oks(r)).toEqual([true, false, false, true])
    expect(r.confidence).toBe('low')
  })

  it('Farcaster with a key: a cast Neynar cannot find is low', async () => {
    const f = mockFetch({ 'https://api.neynar.com/': () => json({ message: 'Cast not found' }, 404) })
    const r = asReview(await socialPost.check(ctx(sources({ fetch: f as unknown as typeof fetch, neynarApiKey: () => 'k' }), 'https://warpcast.com/pizzafan/0xabc12345'), params))
    expect(oks(r)).toEqual([true, false])
  })

  it('Farcaster without a key falls back to the URL username check (no fetch)', async () => {
    const f = mockFetch({})
    const r = asReview(await socialPost.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://warpcast.com/PizzaFan/0xabc12345'), params))
    expect(f).not.toHaveBeenCalled()
    expect(oks(r)).toEqual([true, true, null])
    expect(r.confidence).toBe('medium')
  })

  it('anything else is a fail with a hint (no row is written for it)', async () => {
    for (const bad of [null, 'not a url', 'http://x.com/a/status/1844000000000000001', 'https://instagram.com/p/abc', 'https://x.com/PizzaFan']) {
      expect(await socialPost.check(ctx(sources(), bad), params)).toMatchObject({ status: 'fail', hint: expect.stringMatching(/X or Farcaster/) })
    }
    const xOnly = socialPost.parse({ platforms: ['x'] })
    expect(await socialPost.check(ctx(sources(), 'https://warpcast.com/pizzafan/0xabc12345'), xOnly)).toMatchObject({ status: 'fail' })
  })

  it('validates params', () => {
    expect(() => socialPost.parse({ platforms: ['instagram'] })).toThrow()
    expect(socialPost.parse({})).toEqual({ minReplies: 3, minLikes: 10, platforms: ['x', 'farcaster'] })
  })
})

// --------------------------------------------------------------- poap_drop ---

describe('poap_drop (L4.1)', () => {
  const params = poapDrop.parse({})
  const compass = (drop: Record<string, unknown> | null, mints: number | null = 41) =>
    mockFetch({
      'https://public.compass.poap.tech/v1/graphql': (_url, init) => {
        const q = JSON.parse(String(init?.body)).query as string
        if (q.includes('poaps_aggregate')) return mints === null ? json({ errors: [{ message: 'nope' }] }) : json({ data: { poaps_aggregate: { aggregate: { count: mints } } } })
        expect(q).toContain('_eq: 12345')
        return json({ data: { drops: drop ? [drop] : [] } })
      },
    })
  const DROP = { id: 12345, name: 'PizzaDAO Community Call #210', description: 'Weekly call', image_url: 'https://assets.poap.xyz/x.png', start_date: '2026-09-30', end_date: '2026-09-30', city: '', country: '' }

  it('a gallery link: the drop exists, mentions a community call, mint count shown; authorship left to the reviewer', async () => {
    const f = compass(DROP)
    const r = asReview(await poapDrop.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://poap.gallery/drops/12345'), params))
    expect(oks(r)).toEqual([true, true, true, null])
    expect(r.confidence).toBe('medium')
    expect(r.evidence).toMatchObject({ dropId: 12345, name: 'PizzaDAO Community Call #210', mints: 41, image: 'https://assets.poap.xyz/x.png' })
    expect(r.summary).toContain('41 mints')
  })

  it('a bare drop id works too; an unrelated name is left to the reviewer; no mint count when Compass refuses the aggregate', async () => {
    const f = compass({ ...DROP, name: 'Random Meetup', description: '' }, null)
    const r = asReview(await poapDrop.check(ctx(sources({ fetch: f as unknown as typeof fetch }), '#12345'), params))
    expect(oks(r)).toEqual([true, null, null])
    expect(r.evidence.mints).toBeNull()
  })

  it('minMints is enforced when configured', async () => {
    const r = asReview(await poapDrop.check(ctx(sources({ fetch: compass(DROP, 3) as unknown as typeof fetch }), '12345'), poapDrop.parse({ minMints: 10 })))
    expect(oks(r)).toEqual([true, true, false, null])
  })

  it('a drop that does not exist is low; Compass down is unchecked', async () => {
    expect(oks(asReview(await poapDrop.check(ctx(sources({ fetch: compass(null) as unknown as typeof fetch }), '12345'), params)))).toEqual([false, null])
    const down = mockFetch({ 'https://public.compass.poap.tech/': () => new Response('', { status: 502 }) })
    expect(oks(asReview(await poapDrop.check(ctx(sources({ fetch: down as unknown as typeof fetch }), '12345'), params)))).toEqual([null, null])
  })

  it('a mint link is accepted without a lookup; junk is a fail', async () => {
    const f = mockFetch({})
    const r = asReview(await poapDrop.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://poap.xyz/claim/abc123'), params))
    expect(f).not.toHaveBeenCalled()
    expect(r.evidence).toMatchObject({ kind: 'mint_link', code: 'abc123' })
    expect(await poapDrop.check(ctx(sources(), 'https://example.com/drops/1'), params)).toMatchObject({ status: 'fail' })
    expect(await poapDrop.check(ctx(sources(), null), params)).toMatchObject({ status: 'fail' })
  })
})

// ------------------------------------------------------------- media_proof ---

describe('media_proof (L5.1, D16 links only)', () => {
  const params = mediaProof.parse({ kinds: ['youtube', 'x', 'drive', 'loom'] })

  it('YouTube: oEmbed says it is public; preview thumbnail and embed URL kept', async () => {
    const f = mockFetch({ 'https://www.youtube.com/oembed': () => json({ title: 'My PizzaDAO selfie interview', author_name: 'Fan', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg' }) })
    const r = asReview(await mediaProof.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://youtu.be/dQw4w9WgXcQ?t=3'), params))
    expect(oks(r)).toEqual([true, true, null])
    expect(r.evidence).toMatchObject({
      kind: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      title: 'My PizzaDAO selfie interview',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg',
    })
  })

  it('a private / removed video is low; an oEmbed outage is unchecked', async () => {
    const priv = mockFetch({ 'https://www.loom.com/v1/oembed': () => new Response('', { status: 404 }) })
    expect(oks(asReview(await mediaProof.check(ctx(sources({ fetch: priv as unknown as typeof fetch }), 'https://www.loom.com/share/0123456789abcdef0123456789abcdef'), params)))).toEqual([true, false, null])
    const down = mockFetch({ 'https://www.youtube.com/oembed': () => new Response('', { status: 500 }) })
    expect(oks(asReview(await mediaProof.check(ctx(sources({ fetch: down as unknown as typeof fetch }), 'https://www.youtube.com/shorts/dQw4w9WgXcQ'), params)))).toEqual([true, null, null])
  })

  it('Drive has no oEmbed: format check only, no fetch', async () => {
    const f = mockFetch({})
    const r = asReview(await mediaProof.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing'), params))
    expect(f).not.toHaveBeenCalled()
    expect(r.evidence).toMatchObject({ kind: 'drive', embedUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/preview' })
  })

  it('other hosts, or a kind the mission does not allow, fail with the allowed list', async () => {
    expect(await mediaProof.check(ctx(sources(), 'https://vimeo.com/123'), params)).toMatchObject({ status: 'fail', hint: expect.stringMatching(/YouTube, X, Google Drive, Loom/) })
    expect(await mediaProof.check(ctx(sources(), 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view'), mediaProof.parse({ kinds: ['youtube'] }))).toMatchObject({ status: 'fail' })
    expect(() => mediaProof.parse({ kinds: ['tiktok'] })).toThrow()
  })
})

// ---------------------------------------------------------------- gpp_host ---

describe('gpp_host (L6.1, D14)', () => {
  const params = gppHost.parse({ eventType: 'gpp', statuses: ['approved', 'listed'] })
  const EVENT = { id: 'cuid1', name: 'Global Pizza Party Lisbon', city: 'Lisbon', country: 'Portugal', customUrl: 'lisbon', url: 'https://rsv.pizza/lisbon', underbossStatus: 'approved', guestCount: 80, telegramGroup: 'https://t.me/gpplisbon' }
  const rsv = (r: () => Response) => mockFetch({ 'https://api.rsv.example/api/gpp/events/by-city/': r })

  it("finds the party in rsv.pizza's public GPP list; the host Telegram is compared by the reviewer", async () => {
    const f = rsv(() => json({ event: EVENT }))
    const r = asReview(await gppHost.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://rsv.pizza/Lisbon?year=2027'), params))
    expect(String(f.mock.calls[0][0])).toBe('https://api.rsv.example/api/gpp/events/by-city/lisbon')
    expect(oks(r)).toEqual([true, true, true, null])
    expect(r.checks[3].label).toContain('@pizzafan_tg')
    expect(r.evidence).toMatchObject({ slug: 'lisbon', city: 'Lisbon', status: 'approved', guests: 80, memberTelegram: 'pizzafan_tg' })
  })

  it('a pending or cancelled party is low', async () => {
    const r = asReview(await gppHost.check(ctx(sources({ fetch: rsv(() => json({ event: { ...EVENT, underbossStatus: 'pending', cancelledAt: '2026-05-01' } })) as unknown as typeof fetch }), 'https://rsv.pizza/lisbon'), params))
    expect(oks(r)).toEqual([true, true, false, false, null])
    expect(r.confidence).toBe('low')
  })

  it('not in the public list (an invite-code link) or rsv.pizza down: unchecked, never a fail', async () => {
    expect(oks(asReview(await gppHost.check(ctx(sources({ fetch: rsv(() => json({ error: 'GPP event not found for this city' }, 404)) as unknown as typeof fetch }), 'https://rsv.pizza/rsvp/AbC123'), params)))).toEqual([true, null, null])
    expect(oks(asReview(await gppHost.check(ctx(sources({ fetch: rsv(() => new Response('', { status: 500 })) as unknown as typeof fetch }), 'https://rsv.pizza/lisbon'), params)))).toEqual([true, null, null])
  })

  it('a member without a linked Telegram is told so on the card', async () => {
    const src = sources({ fetch: rsv(() => json({ event: EVENT })) as unknown as typeof fetch, getTelegramUsername: vi.fn(async () => null) })
    const r = asReview(await gppHost.check(ctx(src, 'https://rsv.pizza/lisbon'), params))
    expect(r.checks[3].label).toMatch(/No Telegram linked/)
  })

  it('anything but an rsv.pizza event link fails', async () => {
    for (const bad of ['https://rsv.pizza/', 'https://rsv.pizza/login', 'https://lu.ma/lisbon', null]) {
      expect(await gppHost.check(ctx(sources(), bad), params)).toMatchObject({ status: 'fail', hint: expect.stringMatching(/rsv\.pizza/) })
    }
  })

  it('without RSV_PIZZA_SERVICE_KEY the host lookup is never called and nothing is auto-verified', async () => {
    const f = rsv(() => json({ event: EVENT }))
    const r = asReview(await gppHost.check(ctx(sources({ fetch: f as unknown as typeof fetch }), 'https://rsv.pizza/lisbon'), params))
    expect(f).toHaveBeenCalledTimes(1)
    expect(r.autoVerified).toBeUndefined()
    expect(r.evidence.hostLookup).toBeUndefined()
  })

  describe('Phase 5: rsv.pizza host lookup (RSV_PIZZA_SERVICE_KEY)', () => {
    const KEY = 'svc-key'
    const HOST = { slug: 'lisbon', city: 'Lisbon', status: 'approved', type: 'gpp', date: '2026-05-22T18:00:00.000Z', role: 'underboss', matchedBy: ['wallet'] }
    const lookup = (events: unknown[] | (() => Response), event: unknown = EVENT) =>
      mockFetch({
        'https://api.rsv.example/api/gpp/events/by-city/': () => (event ? json({ event }) : json({ error: 'not found' }, 404)),
        'https://api.rsv.example/api/service/gpp-host-lookup': typeof events === 'function' ? events : () => json({ ok: true, matched: events.length > 0, events }),
      })
    const withKey = (f: ReturnType<typeof mockFetch>, over: Partial<VerifierSources> = {}) =>
      sources({ fetch: f as unknown as typeof fetch, rsvPizzaServiceKey: () => KEY, ...over })

    it("sends the member's wallets + Telegram with the service key; a match on this event is auto-verified", async () => {
      const f = lookup([HOST])
      const r = asReview(await gppHost.check(ctx(withKey(f), 'https://rsv.pizza/lisbon'), params))
      const call = f.mock.calls.find((c) => String(c[0]).endsWith('/api/service/gpp-host-lookup'))!
      const init = call[1] as RequestInit
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['x-service-key']).toBe(KEY)
      expect(JSON.parse(String(init.body))).toEqual({ wallets: ['0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'], telegrams: ['pizzafan_tg'] })
      expect(r.autoVerified).toBe(true)
      expect(r.confidence).toBe('high')
      expect(oks(r)).toEqual([true, true, true, true])
      expect(r.checks[3].label).toMatch(/onboarded rsv\.pizza\/lisbon.*wallet/)
      expect(r.summary).toMatch(/^Host confirmed by rsv\.pizza/)
      expect(r.evidence.hostLookup).toMatchObject({ matched: true, events: [{ slug: 'lisbon', role: 'underboss' }] })
    })

    it('an invite-code link outside the public list still matches through the lookup', async () => {
      const f = lookup([{ ...HOST, slug: 'AbC123', role: 'host', city: 'Lagos' }], null)
      const r = asReview(await gppHost.check(ctx(withKey(f), 'https://rsv.pizza/rsvp/AbC123'), params))
      expect(r.autoVerified).toBe(true)
      expect(oks(r)).toEqual([true, true, true, true])
      expect(r.evidence).toMatchObject({ city: 'Lagos', status: 'approved' })
    })

    it('the member hosted another event: shown, not auto-verified', async () => {
      const r = asReview(await gppHost.check(ctx(withKey(lookup([{ ...HOST, slug: 'porto', city: 'Porto' }])), 'https://rsv.pizza/lisbon'), params))
      expect(r.autoVerified).toBeUndefined()
      expect(r.checks[3]).toMatchObject({ ok: null, label: expect.stringMatching(/porto.*but not rsv\.pizza\/lisbon/) })
    })

    it('no match: falls back to the by-hand Telegram compare', async () => {
      const r = asReview(await gppHost.check(ctx(withKey(lookup([])), 'https://rsv.pizza/lisbon'), params))
      expect(r.autoVerified).toBeUndefined()
      expect(oks(r)).toEqual([true, true, true, null, null])
      expect(r.checks[3].label).toMatch(/no approved GPP event/)
      expect(r.checks[4].label).toContain('@pizzafan_tg')
    })

    it('ignores events of another type or status, and never auto-verifies a failing event', async () => {
      const r1 = asReview(await gppHost.check(ctx(withKey(lookup([{ ...HOST, status: 'pending' }, { ...HOST, type: 'standard' }])), 'https://rsv.pizza/lisbon'), params))
      expect(r1.autoVerified).toBeUndefined()
      const r2 = asReview(await gppHost.check(ctx(withKey(lookup([HOST], { ...EVENT, cancelledAt: '2026-05-01' })), 'https://rsv.pizza/lisbon'), params))
      expect(r2.autoVerified).toBeUndefined()
      expect(r2.confidence).toBe('low')
    })

    it('lookup down (401 / 503 / 500 / network): unchecked, degrades to the manual compare', async () => {
      for (const resp of [() => json({ ok: false }, 401), () => json({ ok: false, reason: 'not configured' }, 503), () => new Response('', { status: 500 })]) {
        const r = asReview(await gppHost.check(ctx(withKey(lookup(resp)), 'https://rsv.pizza/lisbon'), params))
        expect(r.autoVerified).toBeUndefined()
        expect(r.checks[3]).toMatchObject({ ok: null, label: 'rsv.pizza host lookup unavailable' })
        expect(r.evidence.hostLookup).toEqual({ state: 'unavailable' })
      }
    })

    it('no wallets and no Telegram: the lookup is skipped', async () => {
      const f = lookup([HOST])
      const src = withKey(f, { getWalletAddresses: vi.fn(async () => []), getTelegramUsername: vi.fn(async () => null) })
      const r = asReview(await gppHost.check(ctx(src, 'https://rsv.pizza/lisbon'), params))
      expect(f.mock.calls.some((c) => String(c[0]).includes('/api/service/'))).toBe(false)
      expect(r.evidence.hostLookup).toEqual({ state: 'no_ids' })
      expect(r.autoVerified).toBeUndefined()
    })
  })
})
