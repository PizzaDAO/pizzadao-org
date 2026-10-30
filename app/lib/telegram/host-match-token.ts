/**
 * The signed link the shared bot DMs to a suggested Telegram match (plans/telegram-shared-bot.md,
 * part 4, side (b) of the two-sided confirmation). Token = base64url(JSON{d,h,e,v}) . base64url(HMAC)
 * keyed with FOLLOWUP_LINK_SECRET, with a `tc:` prefix mixed into the MAC input so a follow-up action
 * link can never be replayed as a confirmation (or the other way round).
 *
 * The body carries the member's Discord id, a short fingerprint of the matched Telegram id (so a link
 * for an older match stops working if the match changes) and the expiry. No names, no Telegram id.
 * Holding the link only proves the Telegram side: the page it opens still requires the member's own
 * Discord session and an explicit click.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { appUrl } from '@/app/lib/followups/config'
import { linkSecret } from '@/app/lib/followups/links'

export const CONFIRM_TTL_HOURS = 48
const PREFIX = 'tc:'

type Env = Record<string, string | undefined>

export interface ConfirmClaims {
  /** The member's Discord id. */
  d: string
  /** Fingerprint of the matched Telegram id. */
  h: string
  e: number
  v: 1
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(`${PREFIX}${body}`).digest()

export const telegramFingerprint = (telegramId: string): string => createHash('sha256').update(`tc-fp:${telegramId}`).digest('base64url').slice(0, 16)

export function signConfirmToken(discordId: string, telegramId: string, now = new Date(), env: Env = process.env): string | null {
  const secret = linkSecret(env)
  if (!secret) return null
  const claims: ConfirmClaims = { d: discordId, h: telegramFingerprint(telegramId), e: Math.floor(now.getTime() / 1000) + CONFIRM_TTL_HOURS * 3600, v: 1 }
  const body = b64(JSON.stringify(claims))
  return `${body}.${b64(mac(body, secret))}`
}

export type VerifyConfirm = { ok: true; claims: ConfirmClaims } | { ok: false; reason: 'invalid' | 'expired' }

export function verifyConfirmToken(token: string, now = new Date(), env: Env = process.env): VerifyConfirm {
  const secret = linkSecret(env)
  if (!secret || typeof token !== 'string' || token.length > 400) return { ok: false, reason: 'invalid' }
  const [body, tag, extra] = token.split('.')
  if (!body || !tag || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(tag)) return { ok: false, reason: 'invalid' }
  const want = mac(body, secret)
  const got = Buffer.from(tag, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'invalid' }
  let c: Partial<ConfirmClaims>
  try {
    c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (c.v !== 1 || typeof c.d !== 'string' || typeof c.h !== 'string' || typeof c.e !== 'number') return { ok: false, reason: 'invalid' }
  if (c.e * 1000 < now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, claims: c as ConfirmClaims }
}

export const confirmUrl = (token: string, env: Env = process.env) => `${appUrl(env)}/telegram/confirm/${token}`
