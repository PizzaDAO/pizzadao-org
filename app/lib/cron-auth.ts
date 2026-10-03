/**
 * Auth for Vercel Cron routes. Vercel calls each cron path with
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on the project.
 * With no CRON_SECRET configured nothing is authorized (fail closed).
 */
import { timingSafeEqual } from 'node:crypto'

export function isCronAuthorized(authorization: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET?.trim()
  if (!secret || !authorization) return false
  const want = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(authorization.trim())
  return got.length === want.length && timingSafeEqual(got, want)
}
