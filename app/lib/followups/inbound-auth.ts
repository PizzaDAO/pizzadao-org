/**
 * Which trusted service is calling the inbound endpoint. One key per caller, and the key decides the
 * source (the request body cannot pick it). Keys are compared in constant time; with no key configured
 * nothing is authorized (fail closed).
 */
import { timingSafeEqual } from 'node:crypto'

export type InboundSource = 'telegram' | 'discord'

function same(authorization: string, key: string | undefined): boolean {
  const k = key?.trim()
  if (!k) return false
  const want = Buffer.from(`Bearer ${k}`)
  const got = Buffer.from(authorization.trim())
  return got.length === want.length && timingSafeEqual(got, want)
}

export function inboundSource(authorization: string | null | undefined, env: NodeJS.ProcessEnv = process.env): InboundSource | null {
  if (!authorization) return null
  // Both comparisons always run so timing does not reveal which key was close.
  const tg = same(authorization, env.FOLLOWUP_INBOUND_TELEGRAM_KEY)
  const dc = same(authorization, env.RECORDER_API_KEY)
  if (tg && !dc) return 'telegram'
  if (dc && !tg) return 'discord'
  return null
}
