/**
 * Signed action links for follow-up messages sent on Telegram (and the "Open in app" button on
 * Discord). Token = base64url(JSON{f,a,e,v}).base64url(HMAC-SHA256(FOLLOWUP_LINK_SECRET)).
 * One token per follow-up and action; valid for followups.linkTtlDays; verified in constant time.
 * The body carries no names and no message text. Possession of the link is the authority, like an
 * email unsubscribe link, so the page it opens never mutates on GET.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { appUrl } from './config'

export const LINK_ACTIONS = ['done', 'wip', 'help', 'reply', 'stop', 'snooze'] as const
export type LinkAction = (typeof LINK_ACTIONS)[number]

export interface LinkClaims {
  f: string
  a: LinkAction
  e: number
  v: 1
}

type Env = Record<string, string | undefined>

export const linkSecret = (env: Env = process.env): string | null => env.FOLLOWUP_LINK_SECRET?.trim() || null

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest()

export function signLink(followUpId: string, action: LinkAction, ttlDays: number, now = new Date(), env: Env = process.env): string | null {
  const secret = linkSecret(env)
  if (!secret) return null
  const claims: LinkClaims = { f: followUpId, a: action, e: Math.floor(now.getTime() / 1000) + Math.round(ttlDays * 86400), v: 1 }
  const body = b64(JSON.stringify(claims))
  return `${body}.${b64(sign(body, secret))}`
}

export type VerifyResult = { ok: true; claims: LinkClaims } | { ok: false; reason: 'invalid' | 'expired' }

export function verifyLink(token: string, now = new Date(), env: Env = process.env): VerifyResult {
  const secret = linkSecret(env)
  if (!secret || typeof token !== 'string' || token.length > 400) return { ok: false, reason: 'invalid' }
  const [body, mac, extra] = token.split('.')
  // One valid spelling per token (a 32-byte MAC is exactly 43 base64url chars): spellings cannot dodge the per-token rate limit.
  if (!body || !mac || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return { ok: false, reason: 'invalid' }
  const want = sign(body, secret)
  const got = Buffer.from(mac, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'invalid' }
  let c: Partial<LinkClaims>
  try {
    c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (c.v !== 1 || typeof c.f !== 'string' || typeof c.e !== 'number' || !LINK_ACTIONS.includes(c.a as LinkAction)) return { ok: false, reason: 'invalid' }
  if (c.e * 1000 < now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, claims: c as LinkClaims }
}

export function linkUrl(token: string, env: Env = process.env): string {
  return `${appUrl(env)}/fu/${token}`
}
