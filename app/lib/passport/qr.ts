/**
 * Partner table-QR codes. A code is HMAC(PASSPORT_QR_SECRET, pizzeriaId:qrVersion), so a printed QR
 * stays valid until the pizzeria's qrVersion is bumped (reprint). The code alone never grants a
 * stamp: the check-in also needs the member to be at the venue.
 *
 * URL form: /passport/q/<slug>.<code>   (slugs are [a-z0-9-], so the last "." splits them)
 */
import { createHmac, timingSafeEqual } from 'crypto'

const CODE_LENGTH = 16

export function qrCodeFor(pizzeriaId: string, qrVersion: number, secret = process.env.PASSPORT_QR_SECRET): string {
  if (!secret) throw new Error('PASSPORT_QR_SECRET is not set')
  return createHmac('sha256', secret).update(`${pizzeriaId}:${qrVersion}`).digest('base64url').slice(0, CODE_LENGTH)
}

/** False for a wrong code, and also when no secret is configured (fails closed). */
export function verifyQrCode(
  pizzeriaId: string,
  qrVersion: number,
  code: unknown,
  secret = process.env.PASSPORT_QR_SECRET,
): boolean {
  if (!secret || typeof code !== 'string' || code.length !== CODE_LENGTH) return false
  const expected = Buffer.from(qrCodeFor(pizzeriaId, qrVersion, secret))
  const given = Buffer.from(code)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export function qrPath(slug: string, code: string): string {
  return `/passport/q/${slug}.${code}`
}

export function parseQrPath(param: string): { slug: string; code: string } | null {
  const i = param.lastIndexOf('.')
  if (i < 1 || i === param.length - 1) return null
  const slug = param.slice(0, i)
  const code = param.slice(i + 1)
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !/^[A-Za-z0-9_-]{16}$/.test(code)) return null
  return { slug, code }
}

export function slugify(name: string, city?: string | null): string {
  const base = [name, city ?? '']
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '')
  return base || 'pizzeria'
}
