// @vitest-environment node
// Proof-link parsing, link previews (SSRF guard, size cap, timeout) and the
// submit-time pre-check. Every fetch and DNS lookup is mocked.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => {
  const missionCompletion = { updateMany: vi.fn(async () => ({ count: 1 })) }
  const missionReviewEvent = { create: vi.fn(async () => ({})) }
  const tx = { missionCompletion, missionReviewEvent }
  return { prisma: { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } }
})

import { parseFarcasterCast, parseHttpsUrl, parseMediaLink, parsePoapProof, parseRsvPizzaUrl, parseXPost } from './proof-links'
import { isInternalIp, isSafePublicUrl, parseUnfurl, unfurlProof } from './unfurl'
import { fetchCapped } from './net'
import { isAllGreen, isPrecheckedMission, precheckProof, storeCheckResult } from './precheck'
import { prisma } from '../db'
import type { VerifierSources } from './types'

describe('proof links', () => {
  it('https only, bounded', () => {
    expect(parseHttpsUrl('http://x.com/a')).toBeNull()
    expect(parseHttpsUrl('https://user:pw@x.com/a')).toBeNull()
    expect(parseHttpsUrl(`https://x.com/${'a'.repeat(600)}`)).toBeNull()
    expect(parseHttpsUrl(' https://x.com/a ')?.hostname).toBe('x.com')
  })

  it('X posts', () => {
    expect(parseXPost('https://x.com/PizzaFan/status/1844000000000000001')).toEqual({
      handle: 'PizzaFan',
      statusId: '1844000000000000001',
      url: 'https://x.com/PizzaFan/status/1844000000000000001',
    })
    expect(parseXPost('https://mobile.twitter.com/a_b/status/1844000000000000001/photo/1')?.handle).toBe('a_b')
    expect(parseXPost('https://x.com/i/web/status/1844000000000000001')).toMatchObject({ handle: null })
    expect(parseXPost('https://x.com/PizzaFan')).toBeNull()
    expect(parseXPost('https://evil.com/PizzaFan/status/1844000000000000001')).toBeNull()
  })

  it('Farcaster casts', () => {
    expect(parseFarcasterCast('https://warpcast.com/PizzaFan/0xAbC12345')).toEqual({ username: 'pizzafan', hash: '0xabc12345', url: 'https://warpcast.com/PizzaFan/0xAbC12345' })
    expect(parseFarcasterCast('https://farcaster.xyz/~/conversations/0xabc12345')).toMatchObject({ username: null })
    expect(parseFarcasterCast('https://warpcast.com/pizzafan')).toBeNull()
  })

  it('POAP drops and mint links', () => {
    expect(parsePoapProof('12345')).toEqual({ kind: 'drop', dropId: 12345, url: null })
    expect(parsePoapProof('https://poap.gallery/drops/12345')).toMatchObject({ kind: 'drop', dropId: 12345 })
    expect(parsePoapProof('https://poap.gallery/event/777')).toMatchObject({ dropId: 777 })
    expect(parsePoapProof('https://collectors.poap.xyz/drop/88')).toMatchObject({ dropId: 88 })
    expect(parsePoapProof('https://poap.xyz/mint/abcd1234')).toEqual({ kind: 'mint_link', code: 'abcd1234', url: 'https://poap.xyz/mint/abcd1234' })
    expect(parsePoapProof('https://evil.com/drops/1')).toBeNull()
  })

  it('media links (YouTube, X, Drive, Loom)', () => {
    expect(parseMediaLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toMatchObject({ kind: 'youtube', id: 'dQw4w9WgXcQ' })
    expect(parseMediaLink('https://youtube.com/live/dQw4w9WgXcQ')).toMatchObject({ kind: 'youtube' })
    expect(parseMediaLink('https://x.com/a/status/1844000000000000001')).toMatchObject({ kind: 'x', embedUrl: null })
    expect(parseMediaLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv')).toMatchObject({ kind: 'drive' })
    expect(parseMediaLink('https://loom.com/share/0123456789abcdef0123456789abcdef')).toMatchObject({ kind: 'loom' })
    expect(parseMediaLink('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(parseMediaLink('https://vimeo.com/1')).toBeNull()
  })

  it('rsv.pizza event links', () => {
    expect(parseRsvPizzaUrl('https://rsv.pizza/Lisbon')).toEqual({ slug: 'lisbon', url: 'https://rsv.pizza/Lisbon' })
    expect(parseRsvPizzaUrl('https://www.rsv.pizza/rsvp/AbC123')).toMatchObject({ slug: 'abc123' })
    expect(parseRsvPizzaUrl('https://rsv.pizza/host/AbC123/guests')).toMatchObject({ slug: 'abc123' })
    expect(parseRsvPizzaUrl('https://rsv.pizza/gpp')).toBeNull()
    expect(parseRsvPizzaUrl('https://api.rsv.pizza/lisbon')).toBeNull()
  })
})

// ----------------------------------------------------------------- unfurl ---

const publicDns = async () => ['93.184.216.34']

describe('unfurl (proof previews)', () => {
  it('blocks internal addresses: IP literals, localhost, and names that resolve inside', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isInternalIp(ip), ip).toBe(true)
    }
    expect(isInternalIp('93.184.216.34')).toBe(false)
    expect(await isSafePublicUrl('https://localhost/x', publicDns)).toBe(false)
    expect(await isSafePublicUrl('https://169.254.169.254/latest', publicDns)).toBe(false)
    expect(await isSafePublicUrl('https://example.com:8443/', publicDns)).toBe(false)
    expect(await isSafePublicUrl('http://example.com/', publicDns)).toBe(false)
    expect(await isSafePublicUrl('https://sneaky.example/', async () => ['93.184.216.34', '10.0.0.5'])).toBe(false)
    expect(await isSafePublicUrl('https://example.com/', publicDns)).toBe(true)
  })

  it('parses og / twitter meta and makes the image absolute (https only)', () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="My &amp; Post">
      <meta content="A description" name="description">
      <meta property="og:image" content="/img/card.png">
      <meta property="og:site_name" content="Example"></head></html>`
    expect(parseUnfurl(html, 'https://example.com/p/1')).toEqual({
      title: 'My & Post',
      description: 'A description',
      image: 'https://example.com/img/card.png',
      siteName: 'Example',
    })
    expect(parseUnfurl('<title>Only title</title><meta property="og:image" content="http://insecure/x.png">', 'https://e.com')).toEqual({ title: 'Only title' })
  })

  it('fetches a page preview, an image, and follows safe redirects by hand', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u === 'https://short.example/x') return new Response('', { status: 301, headers: { location: 'https://example.com/post' } })
      if (u === 'https://example.com/post') return new Response('<meta property="og:title" content="Post">', { headers: { 'content-type': 'text/html; charset=utf-8' } })
      if (u === 'https://example.com/pic.png') return new Response('PNG', { headers: { 'content-type': 'image/png' } })
      return new Response('', { status: 404 })
    })
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: publicDns }
    expect(await unfurlProof('https://short.example/x', deps)).toEqual({ url: 'https://example.com/post', kind: 'page', title: 'Post' })
    expect(await unfurlProof('https://example.com/pic.png', deps)).toEqual({ url: 'https://example.com/pic.png', kind: 'image' })
    expect(await unfurlProof('https://example.com/missing', deps)).toBeNull()
    for (const call of fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>) expect(call[1].redirect).toBe('manual')
  })

  it('refuses a redirect into the internal network', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }))
    expect(await unfurlProof('https://example.com/r', { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: publicDns })).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never fetches a private host at all', async () => {
    const fetchImpl = vi.fn()
    expect(await unfurlProof('https://internal.corp/x', { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: async () => ['10.0.0.8'] })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('fetchCapped', () => {
  it('cuts the body at maxBytes', async () => {
    const big = 'x'.repeat(10_000)
    const r = await fetchCapped((async () => new Response(big)) as unknown as typeof fetch, 'https://e.com', {}, { maxBytes: 1000 })
    expect(r).toMatchObject({ ok: true, truncated: true })
    expect(r!.text.length).toBe(1000)
  })

  it('times out (null), never throws', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch
    expect(await fetchCapped(hang, 'https://e.com', {}, { timeoutMs: 20 })).toBeNull()
  })
})

// --------------------------------------------------------------- precheck ---

function sources(fetchImpl: typeof fetch): VerifierSources {
  return {
    getXAccount: vi.fn(async () => ({ xUsername: 'pizzafan' })),
    countCallsAttended: vi.fn(),
    getMemberRoles: vi.fn(),
    resolveRoleIds: vi.fn(),
    guildId: () => null,
    resolveChannelId: vi.fn(),
    getChannelMessage: vi.fn(),
    getChannel: vi.fn(),
    countWallets: vi.fn(),
    getReferrals: vi.fn(),
    getVouchesGiven: vi.fn(),
    sharedSignalKinds: vi.fn(),
    getFarcasterAccounts: vi.fn(async () => []),
    getTelegramUsername: vi.fn(async () => null),
    fetch: fetchImpl,
    neynarApiKey: () => null,
    rsvPizzaApiUrl: () => 'https://api.rsv.example',
    rsvPizzaServiceKey: () => null,
    getWalletAddresses: vi.fn(async () => []),
  } as unknown as VerifierSources
}

describe('precheckProof (submit route)', () => {
  const SOCIAL = { verifierKey: 'social_post', verifierParams: { minReplies: 3, minLikes: 10 } }
  const okOembed = (async () => new Response(JSON.stringify({ author_url: 'https://twitter.com/pizzafan' }))) as unknown as typeof fetch

  it('which missions are pre-checked: semi verifiers and manual missions with a link; never the automatic ones', () => {
    expect(isPrecheckedMission('social_post')).toBe(true)
    expect(isPrecheckedMission(null)).toBe(true)
    expect(isPrecheckedMission('x_linked')).toBe(false)
    expect(isPrecheckedMission('referral')).toBe(false)
  })

  it('a wrong kind of link is rejected with the hint (the route writes no row)', async () => {
    const out = await precheckProof({ discordId: '1', memberId: null, mission: SOCIAL, evidence: 'https://instagram.com/p/1', sources: sources(okOembed), unfurl: async () => null })
    expect(out.reject).toMatchObject({ reason: expect.stringMatching(/X or Farcaster/), hint: expect.any(String) })
    expect(out.checkResult).toBeUndefined()
  })

  it('a valid link gets the checks, the confidence and the preview for the PENDING row', async () => {
    const unfurl = vi.fn(async (url: string) => ({ url, kind: 'page' as const, title: 'Post on X' }))
    const out = await precheckProof({
      discordId: '1',
      memberId: null,
      mission: SOCIAL,
      evidence: 'https://x.com/pizzafan/status/1844000000000000001',
      sources: sources(okOembed),
      unfurl,
      now: new Date('2026-10-03T00:00:00Z'),
    })
    expect(out.reject).toBeUndefined()
    expect(out.checkResult).toMatchObject({
      verifier: 'social_post',
      confidence: 'medium',
      checks: [{ ok: true }, { ok: true }, { ok: true }, { ok: null }],
      data: { platform: 'x', author: 'pizzafan' },
      preview: { title: 'Post on X' },
      checkedAt: '2026-10-03T00:00:00.000Z',
    })
    expect(isAllGreen(out.checkResult)).toBe(false) // engagement still needs an eye
    expect(isAllGreen({ confidence: 'high', checks: [{ label: 'x', ok: true }] })).toBe(true)
  })

  it('a verifier that throws is recorded as "could not pre-check", never blocks the submission', async () => {
    const boom = sources(okOembed)
    boom.getXAccount = vi.fn(async () => {
      throw new Error('db down')
    })
    const out = await precheckProof({ discordId: '1', memberId: null, mission: SOCIAL, evidence: 'https://x.com/pizzafan/status/1844000000000000001', sources: boom, unfurl: async () => null })
    expect(out.checkResult).toMatchObject({ summary: "Couldn't pre-check the proof", confidence: 'medium' })
  })

  it('a manual mission only gets a link preview; an automatic mission nothing', async () => {
    const unfurl = vi.fn(async (url: string) => ({ url, kind: 'image' as const }))
    expect((await precheckProof({ discordId: '1', memberId: null, mission: { verifierKey: null, verifierParams: null }, evidence: 'https://e.com/a.png', unfurl })).checkResult).toMatchObject({
      verifier: null,
      checks: [],
      preview: { kind: 'image' },
    })
    expect(await precheckProof({ discordId: '1', memberId: null, mission: { verifierKey: 'x_linked', verifierParams: {} }, evidence: 'https://e.com', unfurl })).toEqual({})
  })

  it('an auto-verified pre-check (L6.1 host confirmed) carries the D9 hold; below L6 it stays a plain all-green review', async () => {
    const GPP = (level: number) => ({ verifierKey: 'gpp_host', verifierParams: {}, level })
    const event = { slug: 'lisbon', city: 'Lisbon', status: 'approved', type: 'gpp', date: null, role: 'host', matchedBy: ['telegram'] }
    const f = (async (input: RequestInfo | URL) =>
      String(input).includes('/api/service/')
        ? new Response(JSON.stringify({ ok: true, matched: true, events: [event] }))
        : new Response(JSON.stringify({ event: { customUrl: 'lisbon', city: 'Lisbon', underbossStatus: 'approved' } }))) as unknown as typeof fetch
    const src = { ...sources(f), rsvPizzaServiceKey: () => 'k', getTelegramUsername: vi.fn(async () => 'cityhost') }
    const OLD = '300000000000000001' // a 2016 snowflake: not a new account
    const held = await precheckProof({ discordId: OLD, memberId: null, mission: GPP(6), evidence: 'https://rsv.pizza/lisbon', sources: src, unfurl: async () => null })
    expect(held.checkResult).toMatchObject({ verifier: 'gpp_host', autoVerified: true, confidence: 'high' })
    expect(held.hold).toBe('HIGH_LEVEL')
    const low = await precheckProof({ discordId: OLD, memberId: null, mission: GPP(2), evidence: 'https://rsv.pizza/lisbon', sources: src, unfurl: async () => null })
    expect(low.checkResult?.autoVerified).toBe(true)
    expect(low.hold).toBeNull()
    const noKey = await precheckProof({ discordId: OLD, memberId: null, mission: GPP(6), evidence: 'https://rsv.pizza/lisbon', sources: { ...src, rsvPizzaServiceKey: () => null }, unfurl: async () => null })
    expect(noKey.checkResult?.autoVerified).toBeUndefined()
    expect(noKey.hold).toBeUndefined()
  })

  it('storeCheckResult with a hold sets holdReason and records AUTO_HELD in one transaction', async () => {
    vi.mocked(prisma.missionCompletion.updateMany).mockClear()
    const ok = await storeCheckResult(9, { verifier: 'gpp_host', summary: 's', confidence: 'high', checks: [], data: {}, checkedAt: 'now', autoVerified: true }, true, 'HIGH_LEVEL')
    expect(ok).toBe(true)
    expect(prisma.missionCompletion.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING' },
      data: expect.objectContaining({ source: 'SEMI', holdReason: 'HIGH_LEVEL' }),
    })
    expect(prisma.missionReviewEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ completionId: 9, actorId: 'auto:gpp_host', action: 'AUTO_HELD', via: 'submit' }),
    })
  })

  it('storeCheckResult writes only onto a PENDING row (source SEMI for verifier-backed checks)', async () => {
    await storeCheckResult(7, { verifier: 'poap_drop', summary: 's', confidence: 'high', checks: [], data: {}, checkedAt: 'now' }, true)
    expect(prisma.missionCompletion.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: 'PENDING' },
      data: expect.objectContaining({ source: 'SEMI', checkResult: expect.objectContaining({ verifier: 'poap_drop' }) }),
    })
  })
})
