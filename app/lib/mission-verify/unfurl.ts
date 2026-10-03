/**
 * Proof previews for reviewers (Phase 4, plans/mission-verification.md §5.3):
 * fetch a submitted proof URL server-side and keep what a link unfurl shows
 * (title, description, image, site name), or note that it is an image.
 *
 * The URL is member-supplied, so this is a server-side request to an
 * arbitrary host. Guards:
 *   - https only, default port only, no credentials in the URL;
 *   - the host must not be (or resolve to) a private, loopback, link-local or
 *     otherwise internal address (checked again on every redirect hop, which
 *     is followed by hand, at most 3);
 *   - 4 s timeout, 256 KB read cap (./net.ts), HTML / image content only.
 * Never throws: anything unexpected is "no preview".
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fetchCapped } from './net'
import { parseHttpsUrl } from './proof-links'

export interface ProofPreview {
  url: string
  kind: 'image' | 'page'
  title?: string
  description?: string
  image?: string
  siteName?: string
}

export type Lookup = (hostname: string) => Promise<string[]>

export interface UnfurlDeps {
  fetchImpl?: typeof fetch
  lookup?: Lookup
  timeoutMs?: number
  maxBytes?: number
}

const defaultLookup: Lookup = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address)

/** Whether an IP literal is internal (private, loopback, link-local, CGNAT, multicast, reserved). */
export function isInternalIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    if (s === '::' || s === '::1') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s)
    if (mapped) return isInternalIp(mapped[1])
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8')
  }
  return true // not an IP at all: treat as unsafe
}

/** Whether a URL may be fetched server-side. */
export async function isSafePublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<boolean> {
  const u = parseHttpsUrl(raw)
  if (!u || (u.port && u.port !== '443')) return false
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) {
    if (!isIP(h)) return false
  }
  if (isIP(h)) return !isInternalIp(h)
  try {
    const addrs = await lookup(h)
    return addrs.length > 0 && addrs.every((a) => !isInternalIp(a))
  } catch {
    return false
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
    const b = a ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i').exec(html)
    if (b?.[1]?.trim()) return decodeEntities(b[1]).slice(0, 300)
  }
  return undefined
}

/** Pure: unfurl fields from an HTML document. */
export function parseUnfurl(html: string, pageUrl: string): Omit<ProofPreview, 'url' | 'kind'> {
  const title = metaContent(html, ['og:title', 'twitter:title']) ?? (/<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1] ? decodeEntities(/<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)![1]) : undefined)
  const description = metaContent(html, ['og:description', 'twitter:description', 'description'])
  const siteName = metaContent(html, ['og:site_name'])
  let image = metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image'])
  if (image) {
    try {
      const abs = new URL(image, pageUrl)
      image = abs.protocol === 'https:' ? abs.toString() : undefined
    } catch {
      image = undefined
    }
  }
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(siteName ? { siteName } : {}),
  }
}

/** Fetch a preview for a proof URL. null when there is nothing safe or useful to show. */
export async function unfurlProof(raw: string | null | undefined, deps: UnfurlDeps = {}): Promise<ProofPreview | null> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const lookup = deps.lookup ?? defaultLookup
  let url = parseHttpsUrl(raw)?.toString()
  if (!url) return null
  try {
    for (let hop = 0; hop <= 3; hop++) {
      if (!(await isSafePublicUrl(url, lookup))) return null
      const res = await fetchCapped(
        fetchImpl,
        url,
        { redirect: 'manual', headers: { 'User-Agent': 'PizzaDAO-ProofPreview/1.0 (+https://app.pizzadao.org)', Accept: 'text/html,image/*;q=0.9,*/*;q=0.1' } },
        { timeoutMs: deps.timeoutMs, maxBytes: deps.maxBytes },
      )
      if (!res) return null
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return null
        url = new URL(loc, url).toString()
        continue
      }
      if (!res.ok) return null
      const type = (res.headers.get('content-type') ?? '').toLowerCase()
      if (type.startsWith('image/')) return { url, kind: 'image' }
      if (!type.includes('html')) return null
      const fields = parseUnfurl(res.text, url)
      return Object.keys(fields).length ? { url, kind: 'page', ...fields } : null
    }
    return null
  } catch {
    return null
  }
}
