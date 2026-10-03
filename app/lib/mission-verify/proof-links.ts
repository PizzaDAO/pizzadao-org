/**
 * Proof-link parsing for the semi-automatic verifiers (Phase 4). Pure: no
 * network, no DB, safe to import from client components.
 *
 *   social_post  X (x.com / twitter.com) posts and Farcaster casts (D15)
 *   poap_drop    POAP drop pages, a bare drop id, or a mint / claim link
 *   media_proof  YouTube, X, Google Drive, Loom (D16: links only)
 *   gpp_host     rsv.pizza event pages (D14)
 */

export const MAX_PROOF_URL_LENGTH = 500

/** The submit form's placeholder per verifier (proofKind URL). */
export const PROOF_HINTS: Record<string, string> = {
  social_post: 'Link to your post on X or Farcaster',
  poap_drop: 'POAP drop link (poap.gallery/drops/…) or the drop ID',
  media_proof: 'Link to your video (YouTube, X, Google Drive or Loom)',
  gpp_host: 'rsv.pizza link of the party (e.g. https://rsv.pizza/yourcity)',
}

/** An https URL of reasonable length, or null. */
export function parseHttpsUrl(raw: string | null | undefined): URL | null {
  const s = (raw ?? '').trim()
  if (!s || s.length > MAX_PROOF_URL_LENGTH) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null
    return u
  } catch {
    return null
  }
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^(www\.|mobile\.|m\.)/, '')
const segments = (u: URL) => u.pathname.split('/').filter(Boolean)

// ------------------------------------------------------------------- X ---

export interface XPostLink {
  /** The handle in the URL path (null for /i/web/status/<id>). Spoofable: X serves any handle. */
  handle: string | null
  statusId: string
  /** Canonical https://x.com/<handle|i>/status/<id>. */
  url: string
}

const X_HOSTS = new Set(['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'])

export function parseXPost(raw: string | URL | null | undefined): XPostLink | null {
  const u = typeof raw === 'string' || raw == null ? parseHttpsUrl(raw) : raw
  if (!u || !X_HOSTS.has(host(u))) return null
  const s = segments(u)
  // /<handle>/status/<id>[/photo/1]  or  /i/web/status/<id>  or  /i/status/<id>
  if (s[0] === 'i') {
    const i = s.indexOf('status')
    const id = i >= 0 ? s[i + 1] : undefined
    return id && /^\d{5,25}$/.test(id) ? { handle: null, statusId: id, url: `https://x.com/i/status/${id}` } : null
  }
  if (s.length >= 3 && /^[A-Za-z0-9_]{1,15}$/.test(s[0]) && (s[1] === 'status' || s[1] === 'statuses') && /^\d{5,25}$/.test(s[2])) {
    return { handle: s[0], statusId: s[2], url: `https://x.com/${s[0]}/status/${s[2]}` }
  }
  return null
}

// ------------------------------------------------------------- Farcaster ---

export interface FarcasterCastLink {
  /** The author username in the path (null for conversation links). */
  username: string | null
  /** The cast hash prefix as it appears in the URL (0x…). */
  hash: string
  url: string
}

const FC_HOSTS = new Set(['warpcast.com', 'farcaster.xyz'])

export function parseFarcasterCast(raw: string | URL | null | undefined): FarcasterCastLink | null {
  const u = typeof raw === 'string' || raw == null ? parseHttpsUrl(raw) : raw
  if (!u || !FC_HOSTS.has(host(u))) return null
  const s = segments(u)
  if (s[0] === '~' && s[1] === 'conversations' && /^0x[0-9a-f]{6,64}$/i.test(s[2] ?? '')) {
    return { username: null, hash: s[2].toLowerCase(), url: u.toString() }
  }
  if (s.length >= 2 && /^[a-z0-9][a-z0-9_.-]{0,40}$/i.test(s[0]) && /^0x[0-9a-f]{6,64}$/i.test(s[1])) {
    return { username: s[0].toLowerCase(), hash: s[1].toLowerCase(), url: `https://${host(u)}/${s[0]}/${s[1]}` }
  }
  return null
}

// ------------------------------------------------------------------ POAP ---

export type PoapProof =
  | { kind: 'drop'; dropId: number; url: string | null }
  /** A claim / mint link: the drop can't be resolved without the (private) POAP API. */
  | { kind: 'mint_link'; code: string; url: string }

const POAP_HOSTS = new Set(['poap.gallery', 'collectors.poap.xyz', 'poap.xyz', 'app.poap.xyz', 'poap.website', 'compass.poap.tech'])

export function parsePoapProof(raw: string | null | undefined): PoapProof | null {
  const s = (raw ?? '').trim().replace(/^#/, '')
  if (/^\d{1,9}$/.test(s)) return { kind: 'drop', dropId: Number(s), url: null }
  const u = parseHttpsUrl(s)
  if (!u || !POAP_HOSTS.has(host(u))) return null
  const p = segments(u)
  for (let i = 0; i < p.length - 1; i++) {
    if (['drop', 'drops', 'event', 'events'].includes(p[i].toLowerCase()) && /^\d{1,9}$/.test(p[i + 1])) {
      return { kind: 'drop', dropId: Number(p[i + 1]), url: u.toString() }
    }
  }
  const mi = p.findIndex((x) => ['claim', 'mint', 'claim-v2'].includes(x.toLowerCase()))
  if (mi >= 0 && p[mi + 1] && /^[A-Za-z0-9_-]{4,64}$/.test(p[mi + 1])) return { kind: 'mint_link', code: p[mi + 1], url: u.toString() }
  return null
}

// ----------------------------------------------------------------- media ---

export type MediaKind = 'youtube' | 'x' | 'drive' | 'loom'

export interface MediaLink {
  kind: MediaKind
  id: string
  url: string
  /** An iframe-embeddable URL (YouTube / Drive / Loom), for the review panel. */
  embedUrl: string | null
  /** A thumbnail URL when it is known without a fetch (YouTube). */
  thumbnail: string | null
  /** oEmbed endpoint for a reachability check, when the platform has one. */
  oembed: string | null
}

export function parseMediaLink(raw: string | null | undefined): MediaLink | null {
  const u = parseHttpsUrl(raw)
  if (!u) return null
  const h = host(u)
  const p = segments(u)

  if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') {
    let id: string | null = null
    if (h === 'youtu.be') id = p[0] ?? null
    else if (p[0] === 'watch') id = u.searchParams.get('v')
    else if (['shorts', 'live', 'embed', 'v'].includes(p[0] ?? '')) id = p[1] ?? null
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null
    const url = `https://www.youtube.com/watch?v=${id}`
    return {
      kind: 'youtube',
      id,
      url,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      oembed: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    }
  }

  const x = parseXPost(u)
  if (x) {
    return {
      kind: 'x',
      id: x.statusId,
      url: x.url,
      embedUrl: null,
      thumbnail: null,
      oembed: `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(x.url)}`,
    }
  }

  if (h === 'drive.google.com' || h === 'docs.google.com') {
    let id: string | null = null
    const fi = p.indexOf('d')
    if (p[0] === 'file' && fi === 1) id = p[2] ?? null
    else if (p[0] === 'open' || p[0] === 'uc') id = u.searchParams.get('id')
    if (!id || !/^[A-Za-z0-9_-]{10,80}$/.test(id)) return null
    return {
      kind: 'drive',
      id,
      url: `https://drive.google.com/file/d/${id}/view`,
      embedUrl: `https://drive.google.com/file/d/${id}/preview`,
      thumbnail: null,
      oembed: null,
    }
  }

  if (h === 'loom.com') {
    const id = (p[0] === 'share' || p[0] === 'embed') && p[1] ? p[1] : null
    if (!id || !/^[A-Za-z0-9]{16,64}$/.test(id)) return null
    const url = `https://www.loom.com/share/${id}`
    return {
      kind: 'loom',
      id,
      url,
      embedUrl: `https://www.loom.com/embed/${id}`,
      thumbnail: null,
      oembed: `https://www.loom.com/v1/oembed?url=${encodeURIComponent(url)}`,
    }
  }
  return null
}

// ------------------------------------------------------------- rsv.pizza ---

export interface RsvPizzaLink {
  /** customUrl or inviteCode, lowercased. */
  slug: string
  url: string
}

/** First path segments that are app pages, not events. */
const RSV_RESERVED = new Set(['', 'login', 'logout', 'auth', 'api', 'gpp', 'gpp27', 'create', 'new', 'events', 'dashboard', 'admin', 'about', 'privacy', 'terms', 'partners', 'map'])

export function parseRsvPizzaUrl(raw: string | null | undefined): RsvPizzaLink | null {
  const u = parseHttpsUrl(raw)
  if (!u || host(u) !== 'rsv.pizza') return null
  const p = segments(u)
  // /:slug, /rsvp/:code, /host/:code[/tab], /run/:code, /dj/:code, /checkin/:code/:guest
  let slug = p[0]
  if (['rsvp', 'host', 'run', 'dj', 'checkin'].includes((p[0] ?? '').toLowerCase())) slug = p[1]
  if (!slug || RSV_RESERVED.has(slug.toLowerCase()) || !/^[A-Za-z0-9_-]{2,80}$/.test(slug)) return null
  return { slug: slug.toLowerCase(), url: `https://rsv.pizza/${slug}` }
}
