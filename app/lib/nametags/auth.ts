/** Bearer-key check for the name-tag service endpoint. Constant-time; no key configured = nothing authorized (fail closed). */
import { timingSafeEqual } from 'node:crypto'

export function nametagKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.NAMETAG_SERVICE_KEY?.trim()
}

export function nametagAuthorized(authorization: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const k = env.NAMETAG_SERVICE_KEY?.trim()
  if (!k || !authorization) return false
  const want = Buffer.from(`Bearer ${k}`)
  const got = Buffer.from(authorization.trim())
  return got.length === want.length && timingSafeEqual(got, want)
}
