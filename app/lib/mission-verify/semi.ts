/**
 * Semi-automatic verifiers (plans/mission-verification.md §2, Phase 4).
 *
 * They pre-check a submitted proof link and return `needs_review` with the
 * checks a reviewer sees on the review card and in the web panel
 * (MissionCompletion.checkResult), plus a confidence hint:
 *
 *   high    every check passed
 *   medium  nothing failed, but something could not be checked (by eye)
 *   low     a check failed (e.g. the post is by another account)
 *
 * They never approve: a reviewer clicks Approve. A proof that isn't the right
 * kind of link at all is a `fail` (the member gets the hint, nothing is
 * written). Upstreams that are down make a check `null`, never a fail.
 *
 *   social_post  L2.1  X: the post author matches the linked X handle (URL path,
 *                      confirmed by X's public oEmbed when it answers); likes and
 *                      comments need the paid API, so a reviewer judges them.
 *                      Farcaster (D15): with NEYNAR_API_KEY the cast is fetched,
 *                      its author fid must be a linked Farcaster account, and the
 *                      likes / replies are counted; without it, the URL username.
 *   poap_drop    L4.1  the drop exists on POAP Compass (name, dates, mints); the
 *                      creator isn't public, so a reviewer confirms authorship.
 *   media_proof  L5.1  YouTube / X / Drive / Loom link format (D16: links only),
 *                      reachability via oEmbed where the platform has one.
 *   gpp_host     L6.1  an rsv.pizza event link that rsv.pizza's public GPP list
 *                      knows (and its status). The public list has no host
 *                      Telegram, so the reviewer compares the member's linked
 *                      Telegram by hand (D14; Phase 5 adds a service endpoint).
 */
import { fetchPoapDrop } from '../poap'
import { fetchJsonCapped } from './net'
import { parseFarcasterCast, parseHttpsUrl, parseMediaLink, parsePoapProof, parseRsvPizzaUrl, parseXPost, type MediaKind } from './proof-links'
import { asObject, confidenceOf, positiveInt, stringList, type SemiCheck, type Verifier, type VerifyCtx, type VerifyResult } from './types'

const fail = (reason: string, hint: string): VerifyResult => ({ status: 'fail', reason, hint })

function review(summary: string, checks: SemiCheck[], evidence: Record<string, unknown>): VerifyResult {
  return { status: 'needs_review', summary, checks, confidence: confidenceOf(checks), evidence }
}

const sameHandle = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase()

/** The X handle behind a post, from X's public oEmbed (no API key). null = X didn't answer. */
async function xOembedAuthor(ctx: VerifyCtx, url: string): Promise<{ handle: string; text: string | null } | null> {
  const r = await fetchJsonCapped<{ author_url?: string; html?: string }>(
    ctx.sources.fetch,
    `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`,
  )
  const author = r?.ok ? r.json?.author_url : undefined
  if (!author) return null
  const handle = author.replace(/\/+$/, '').split('/').pop() ?? ''
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null
  const text = (r?.json?.html ?? '')
    .replace(/<a [^>]*>(pic\.twitter\.com|https?:\/\/t\.co)[^<]*<\/a>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;[\s\S]*$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return { handle, text: text ? text.slice(0, 280) : null }
}

// ------------------------------------------------------------ social_post ---

type SocialParams = { minReplies: number; minLikes: number; platforms: Array<'x' | 'farcaster'> }

export const socialPost: Verifier<SocialParams> = {
  key: 'social_post',
  mode: 'semi',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    const platforms = (o.platforms === undefined ? ['x', 'farcaster'] : stringList(o.platforms, 'platforms')) as SocialParams['platforms']
    if (platforms.some((x) => x !== 'x' && x !== 'farcaster')) throw new Error('platforms must be "x" and/or "farcaster"')
    return { minReplies: positiveInt(o.minReplies, 'minReplies', 3), minLikes: positiveInt(o.minLikes, 'minLikes', 10), platforms }
  },
  async check(ctx, { minReplies, minLikes, platforms }) {
    const where = platforms.map((p) => (p === 'x' ? 'X' : 'Farcaster')).join(' or ')
    const hint = `Submit the link to your post on ${where} (e.g. https://x.com/you/status/123…).`
    const url = parseHttpsUrl(ctx.evidence)
    if (!url) return fail('No post link submitted', hint)
    const engagement = `${minReplies}+ comments and ${minLikes}+ likes`

    const x = platforms.includes('x') ? parseXPost(url) : null
    if (x) {
      const linked = (await ctx.sources.getXAccount(ctx.discordId))?.xUsername ?? null
      const author = await xOembedAuthor(ctx, x.url)
      const checks: SemiCheck[] = [{ label: 'X post link', ok: true }]
      if (!linked) checks.push({ label: 'No X account linked on the profile to compare the author with', ok: false })
      else if (x.handle) checks.push({ label: `Link is under @${x.handle}; linked X is @${linked}`, ok: sameHandle(x.handle, linked) })
      else checks.push({ label: `Link has no handle; linked X is @${linked}`, ok: null })
      if (author) {
        const expect = linked ?? x.handle
        checks.push({ label: `X says the author is @${author.handle}`, ok: expect ? sameHandle(author.handle, expect) : null })
      } else {
        checks.push({ label: "X didn't confirm the author (open the post)", ok: null })
      }
      checks.push({ label: `Engagement (${engagement}): check by eye, needs the paid X API`, ok: null })
      return review(`X post${author ? ` by @${author.handle}` : x.handle ? ` under @${x.handle}` : ''}`, checks, {
        platform: 'x',
        url: x.url,
        statusId: x.statusId,
        urlHandle: x.handle,
        linkedHandle: linked,
        ...(author ? { author: author.handle, ...(author.text ? { text: author.text } : {}) } : {}),
      })
    }

    const fc = platforms.includes('farcaster') ? parseFarcasterCast(url) : null
    if (fc) return checkCast(ctx, fc, minReplies, minLikes, engagement)

    return fail(`That isn't a ${where} post link`, hint)
  },
}

type NeynarCast = {
  hash?: string
  text?: string
  author?: { fid?: number; username?: string }
  reactions?: { likes_count?: number; recasts_count?: number }
  replies?: { count?: number }
}

async function checkCast(
  ctx: VerifyCtx,
  fc: NonNullable<ReturnType<typeof parseFarcasterCast>>,
  minReplies: number,
  minLikes: number,
  engagement: string,
): Promise<VerifyResult> {
  const linked = await ctx.sources.getFarcasterAccounts(ctx.memberId)
  const checks: SemiCheck[] = [{ label: 'Farcaster cast link', ok: true }]
  const evidence: Record<string, unknown> = { platform: 'farcaster', url: fc.url, hash: fc.hash, urlUsername: fc.username, linked: linked.map((l) => l.username) }
  const key = ctx.sources.neynarApiKey()

  let cast: NeynarCast | null | 'unknown' = 'unknown'
  if (key) {
    const r = await fetchJsonCapped<{ cast?: NeynarCast }>(
      ctx.sources.fetch,
      `https://api.neynar.com/v2/farcaster/cast?type=url&identifier=${encodeURIComponent(fc.url)}`,
      { headers: { 'x-api-key': key } },
    )
    if (r && (r.status === 404 || (r.status === 400 && !r.json?.cast))) cast = null
    else if (r?.ok && r.json?.cast) cast = r.json.cast
  }

  if (cast === null) {
    checks.push({ label: "Neynar can't find that cast", ok: false })
    return review('Farcaster cast (not found)', checks, evidence)
  }

  if (cast !== 'unknown') {
    const fid = cast.author?.fid ?? null
    const username = cast.author?.username?.toLowerCase() ?? null
    const likes = cast.reactions?.likes_count ?? null
    const replies = cast.replies?.count ?? null
    Object.assign(evidence, { authorFid: fid, author: username, likes, replies, ...(cast.text ? { text: cast.text.slice(0, 280) } : {}) })
    if (!linked.length) checks.push({ label: `Cast by @${username ?? fid}; no Farcaster account linked on the profile`, ok: false })
    else {
      const match = linked.some((l) => (l.fid !== null && fid !== null ? l.fid === fid : sameHandle(l.username, username)))
      checks.push({ label: `Cast by @${username ?? fid}; linked Farcaster ${linked.map((l) => `@${l.username}`).join(', ')}`, ok: match })
    }
    checks.push({ label: `${likes ?? '?'} likes (need ${minLikes})`, ok: likes === null ? null : likes >= minLikes })
    checks.push({ label: `${replies ?? '?'} replies (need ${minReplies})`, ok: replies === null ? null : replies >= minReplies })
    return review(`Farcaster cast by @${username ?? fid}: ${likes ?? '?'} likes, ${replies ?? '?'} replies`, checks, evidence)
  }

  // No NEYNAR_API_KEY (or Neynar down): the URL check only.
  if (!linked.length) checks.push({ label: 'No Farcaster account linked on the profile to compare the author with', ok: false })
  else if (fc.username) {
    checks.push({ label: `Link is under @${fc.username}; linked Farcaster ${linked.map((l) => `@${l.username}`).join(', ')}`, ok: linked.some((l) => sameHandle(l.username, fc.username)) })
  } else checks.push({ label: 'Link has no username (open the cast)', ok: null })
  checks.push({ label: `Engagement (${engagement}): check by eye${key ? ', Neynar unreachable' : ''}`, ok: null })
  return review(`Farcaster cast${fc.username ? ` under @${fc.username}` : ''}`, checks, evidence)
}

// -------------------------------------------------------------- poap_drop ---

const COMMUNITY_CALL = /community\s*call|pizza\s*dao|pizzadao|rare\s*pizzas/i

export const poapDrop: Verifier<{ minMints: number | null }> = {
  key: 'poap_drop',
  mode: 'semi',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    return { minMints: o.minMints === undefined ? null : positiveInt(o.minMints, 'minMints') }
  },
  async check(ctx, { minMints }) {
    const hint = 'Submit the POAP drop link (https://poap.gallery/drops/12345) or the drop ID.'
    const proof = parsePoapProof(ctx.evidence)
    if (!proof) return fail('No POAP drop link or ID submitted', hint)
    const authorship: SemiCheck = { label: "Who made the drop: a reviewer confirms (POAP doesn't publish creators)", ok: null }

    if (proof.kind === 'mint_link') {
      return review('POAP mint link (drop not resolved)', [
        { label: 'POAP mint / claim link', ok: true },
        { label: "A mint link doesn't say which drop it is: open it, or ask for the drop ID", ok: null },
        authorship,
      ], { kind: 'mint_link', url: proof.url, code: proof.code })
    }

    const drop = await fetchPoapDrop(proof.dropId, ctx.sources.fetch)
    const evidence: Record<string, unknown> = { kind: 'drop', dropId: proof.dropId, url: proof.url ?? `https://poap.gallery/drops/${proof.dropId}` }
    if (drop === 'unknown') {
      return review(`POAP drop #${proof.dropId}`, [{ label: `Drop #${proof.dropId}: POAP Compass unreachable (open the link)`, ok: null }, authorship], evidence)
    }
    if (!drop) {
      return review(`POAP drop #${proof.dropId} (not found)`, [{ label: `Drop #${proof.dropId} doesn't exist on POAP`, ok: false }, authorship], evidence)
    }
    Object.assign(evidence, {
      name: drop.name,
      startDate: drop.startDate,
      mints: drop.mints,
      image: drop.imageUrl,
      url: drop.galleryUrl,
    })
    const checks: SemiCheck[] = [
      { label: `Drop #${drop.id} exists: "${drop.name}"${drop.startDate ? ` (${drop.startDate})` : ''}`, ok: true },
      { label: 'Name mentions a community call / PizzaDAO', ok: COMMUNITY_CALL.test(`${drop.name} ${drop.description}`) ? true : null },
    ]
    if (minMints !== null) checks.push({ label: `${drop.mints ?? '?'} mints (need ${minMints})`, ok: drop.mints === null ? null : drop.mints >= minMints })
    else if (drop.mints !== null) checks.push({ label: `${drop.mints} mints so far`, ok: true })
    checks.push(authorship)
    return review(`POAP "${drop.name}"${drop.mints !== null ? ` · ${drop.mints} mints` : ''}`, checks, evidence)
  },
}

// ------------------------------------------------------------ media_proof ---

const MEDIA_LABEL: Record<MediaKind, string> = { youtube: 'YouTube', x: 'X', drive: 'Google Drive', loom: 'Loom' }

export const mediaProof: Verifier<{ kinds: MediaKind[] }> = {
  key: 'media_proof',
  mode: 'semi',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    const kinds = (o.kinds === undefined ? ['youtube', 'x', 'drive', 'loom'] : stringList(o.kinds, 'kinds')) as MediaKind[]
    if (kinds.some((k) => !(k in MEDIA_LABEL))) throw new Error('kinds must be youtube / x / drive / loom')
    return { kinds }
  },
  async check(ctx, { kinds }) {
    const allowed = kinds.map((k) => MEDIA_LABEL[k]).join(', ')
    const hint = `Submit a link to your video (${allowed}).`
    if (!parseHttpsUrl(ctx.evidence)) return fail('No video link submitted', hint)
    const m = parseMediaLink(ctx.evidence)
    if (!m || !kinds.includes(m.kind)) return fail(`That isn't a ${allowed} video link`, hint)

    const evidence: Record<string, unknown> = { kind: m.kind, url: m.url, embedUrl: m.embedUrl, thumbnail: m.thumbnail }
    const checks: SemiCheck[] = [{ label: `${MEDIA_LABEL[m.kind]} link`, ok: true }]
    if (m.oembed) {
      const r = await fetchJsonCapped<{ title?: string; author_name?: string; thumbnail_url?: string; author_url?: string }>(ctx.sources.fetch, m.oembed)
      if (r?.ok && r.json) {
        const title = r.json.title?.slice(0, 200)
        Object.assign(evidence, {
          ...(title ? { title } : {}),
          ...(r.json.author_name ? { author: r.json.author_name.slice(0, 100) } : {}),
          ...(r.json.thumbnail_url?.startsWith('https://') ? { thumbnail: r.json.thumbnail_url } : {}),
        })
        checks.push({ label: `Public and playable${title ? `: "${title}"` : ''}${r.json.author_name ? ` by ${r.json.author_name}` : ''}`, ok: true })
      } else if (r && (r.status === 401 || r.status === 403 || r.status === 404)) {
        checks.push({ label: `${MEDIA_LABEL[m.kind]} says the video is private or gone`, ok: false })
      } else {
        checks.push({ label: `${MEDIA_LABEL[m.kind]} didn't answer (open the link)`, ok: null })
      }
    } else {
      checks.push({ label: 'Drive sharing can only be checked by opening the link', ok: null })
    }
    checks.push({ label: 'It is a selfie interview by the member: a reviewer watches', ok: null })
    return review(`${MEDIA_LABEL[m.kind]} video${typeof evidence.title === 'string' ? `: "${evidence.title}"` : ''}`, checks, evidence)
  },
}

// --------------------------------------------------------------- gpp_host ---

type GppParams = { eventType: string; statuses: string[] }

type GppEvent = {
  id?: string
  name?: string
  city?: string
  country?: string
  customUrl?: string | null
  inviteCode?: string | null
  url?: string
  date?: string | null
  eventType?: string
  underbossStatus?: string
  guestCount?: number
  telegramGroup?: string | null
  eventImageUrl?: string | null
  cancelledAt?: string | null
}

export const gppHost: Verifier<GppParams> = {
  key: 'gpp_host',
  mode: 'semi',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    const eventType = o.eventType === undefined ? 'gpp' : String(o.eventType).trim()
    if (!eventType) throw new Error('eventType must be a string')
    const statuses = o.statuses === undefined ? ['approved', 'listed'] : stringList(o.statuses, 'statuses')
    return { eventType, statuses: statuses.map((s) => s.toLowerCase()) }
  },
  async check(ctx, { statuses }) {
    const hint = 'Submit the rsv.pizza link of the party you onboarded (e.g. https://rsv.pizza/yourcity).'
    const link = parseRsvPizzaUrl(ctx.evidence)
    if (!link) return fail('No rsv.pizza event link submitted', hint)

    const telegram = await ctx.sources.getTelegramUsername(ctx.discordId)
    const tgCheck: SemiCheck = telegram
      ? { label: `Host Telegram isn't public on rsv.pizza: compare with the member's @${telegram}`, ok: null }
      : { label: 'No Telegram linked on the member profile to compare with the host', ok: null }
    const evidence: Record<string, unknown> = { url: link.url, slug: link.slug, memberTelegram: telegram }
    const checks: SemiCheck[] = [{ label: 'rsv.pizza event link', ok: true }]

    const r = await fetchJsonCapped<{ event?: GppEvent }>(
      ctx.sources.fetch,
      `${ctx.sources.rsvPizzaApiUrl()}/api/gpp/events/by-city/${encodeURIComponent(link.slug)}`,
    )
    if (!r || (!r.ok && r.status !== 404)) {
      checks.push({ label: 'rsv.pizza unreachable (open the link)', ok: null }, tgCheck)
      return review(`rsv.pizza/${link.slug}`, checks, evidence)
    }
    const ev = r.ok ? r.json?.event : undefined
    if (!ev) {
      checks.push({ label: `rsv.pizza/${link.slug} isn't in the public Global Pizza Party list (an invite code link? open it)`, ok: null }, tgCheck)
      return review(`rsv.pizza/${link.slug} (not in the GPP list)`, checks, evidence)
    }
    const status = (ev.underbossStatus ?? 'pending').toLowerCase()
    Object.assign(evidence, {
      eventId: ev.id,
      name: ev.name,
      city: ev.city,
      country: ev.country,
      date: ev.date,
      status,
      guests: ev.guestCount,
      telegramGroup: ev.telegramGroup ?? null,
      image: ev.eventImageUrl ?? null,
      ...(ev.url ? { url: ev.url } : {}),
    })
    checks.push({ label: `Global Pizza Party: ${ev.name ?? link.slug}${ev.city ? ` (${ev.city}${ev.country ? `, ${ev.country}` : ''})` : ''}`, ok: true })
    checks.push({ label: `Status "${status}" (need ${statuses.join(' / ')})`, ok: statuses.includes(status) })
    if (ev.cancelledAt) checks.push({ label: 'The party was cancelled', ok: false })
    checks.push(tgCheck)
    return review(`GPP ${ev.city ?? ev.name ?? link.slug}: ${status}${typeof ev.guestCount === 'number' ? `, ${ev.guestCount} guests` : ''}`, checks, evidence)
  },
}

export const SEMI_VERIFIERS = [socialPost, poapDrop, mediaProof, gppHost]
