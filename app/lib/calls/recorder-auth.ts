/**
 * Bearer auth for the recorder worker's API calls: `Authorization: Bearer
 * $RECORDER_API_KEY`, constant-time compare. With no key configured nothing is
 * authorized (fail closed).
 */
import { timingSafeEqual } from 'node:crypto'

export function isRecorderAuthorized(authorization: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.RECORDER_API_KEY?.trim()
  if (!key || !authorization) return false
  const want = Buffer.from(`Bearer ${key}`)
  const got = Buffer.from(authorization.trim())
  return got.length === want.length && timingSafeEqual(got, want)
}
