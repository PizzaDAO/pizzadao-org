import { timingSafeEqual } from 'node:crypto'

/** Constant-time check of Telegram's X-Telegram-Bot-Api-Secret-Token header. Unset secret or header means no. */
export function secretMatches(header: string | null | undefined, secret: string | undefined): boolean {
  const want = secret?.trim()
  if (!want || !header) return false
  const a = Buffer.from(header.trim())
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}
