/**
 * Pure validation for lane slugs, step kinds and step links (plans/lane-cards-mission-onboarding.md).
 * Client-safe. The host allowlist is a security boundary, so it stays a code constant.
 */
export const LANE_SLUG_PATTERN = /^[a-z0-9-]{1,32}$/
export const STEP_KINDS = ['read', 'do', 'submit'] as const
export type StepKind = (typeof STEP_KINDS)[number]

export const STEP_LINK_MAX = 300
export const STEP_LABEL_MAX = 60
export const STEP_TITLE_MAX = 120
export const STEP_BODY_MAX = 4000

/** External hosts a step may link to (exact host or a subdomain). */
export const LINK_HOST_ALLOWLIST = ['rsv.pizza', 'discord.com', 'discord.gg', 'docs.google.com', 'github.com', 'poap.xyz'] as const

export const isLaneSlug = (v: unknown): v is string => typeof v === 'string' && LANE_SLUG_PATTERN.test(v)
export const isStepKind = (v: unknown): v is StepKind => typeof v === 'string' && (STEP_KINDS as readonly string[]).includes(v)

/** Trim; empty becomes null; an invalid value returns the error text. */
export function parseStepLink(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'linkHref must be text' }
  const v = raw.trim()
  if (v === '') return { ok: true, value: null }
  if (v.length > STEP_LINK_MAX) return { ok: false, error: `linkHref must be at most ${STEP_LINK_MAX} characters` }
  if (/[\\\s\u0000-\u001f\u007f]/.test(v)) return { ok: false, error: 'linkHref must not contain spaces or control characters' }

  if (v.startsWith('/')) {
    if (v.startsWith('//')) return { ok: false, error: 'linkHref must be a path on this site or an https link on an allowed host' }
    let path: string
    try {
      path = decodeURIComponent(new URL(v, 'https://pizzadao.org').pathname)
    } catch {
      return { ok: false, error: 'linkHref is not a valid path' }
    }
    if (path.startsWith('//') || path.includes('\\')) return { ok: false, error: 'linkHref is not a valid path' }
    if (/^\/(api|login|join|admin)(\/|$)/i.test(path)) return { ok: false, error: 'linkHref cannot point at /api, /login, /join or /admin' }
    return { ok: true, value: v }
  }

  let url: URL
  try {
    url = new URL(v)
  } catch {
    return { ok: false, error: 'linkHref must be a path on this site or an https link on an allowed host' }
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return { ok: false, error: 'External links must be https without credentials' }
  }
  const host = url.hostname.toLowerCase()
  if (!LINK_HOST_ALLOWLIST.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, error: `External links are limited to: ${LINK_HOST_ALLOWLIST.join(', ')}` }
  }
  return { ok: true, value: v }
}
