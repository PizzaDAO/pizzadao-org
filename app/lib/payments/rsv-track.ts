/**
 * Host track record from the party platform (plans/host-fast-track.md phase 5).
 *
 * Calls `POST {RSV_PIZZA_API_URL}/api/service/host-track-record` with the shared secret in the
 * `x-service-key` header. Both env vars must be set; if either is missing, or the call fails, times
 * out, returns a non-200 or an unexpected body, the answer is null, which the rest of the code treats
 * as "no Fast Pass" (the member falls back to the paid-requests rule). Nothing here can make a
 * request faster or slower except by being a positive answer.
 *
 * The endpoint contract is documented in plans/host-fast-track.md. The other repo is not modified.
 */
import { z } from 'zod'

export const RSV_TRACK_TIMEOUT_MS = 4_000

export const rsvTrackSchema = z.object({
  tier: z.string().max(40),
  eligibleForFastPass: z.boolean(),
  verifiedParties: z.number().int().min(0).max(10_000),
})

export interface RsvTrack {
  tier: 'fast_pass' | 'flagged' | 'other'
  /** The raw tier string from the other side (for the stored snapshot). */
  rawTier: string
  eligibleForFastPass: boolean
  verifiedParties: number
}

export interface RsvIdentifiers {
  wallets?: string[]
  telegrams?: string[]
  emails?: string[]
}

export interface RsvConfig {
  baseUrl: string
  serviceKey: string
}

export function rsvConfig(env: NodeJS.ProcessEnv = process.env): RsvConfig | null {
  const baseUrl = env.RSV_PIZZA_API_URL?.trim().replace(/\/+$/, '')
  const serviceKey = env.RSV_PIZZA_SERVICE_KEY?.trim()
  if (!baseUrl || !serviceKey || !/^https:\/\//i.test(baseUrl)) return null
  return { baseUrl, serviceKey }
}

export async function fetchRsvTrack(
  ids: RsvIdentifiers,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<RsvTrack | null> {
  const cfg = rsvConfig(opts.env)
  if (!cfg) return null
  const body: RsvIdentifiers = {}
  if (ids.wallets?.length) body.wallets = ids.wallets.slice(0, 10)
  if (ids.telegrams?.length) body.telegrams = ids.telegrams.slice(0, 5)
  if (ids.emails?.length) body.emails = ids.emails.slice(0, 5)
  if (!body.wallets && !body.telegrams && !body.emails) return null

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? RSV_TRACK_TIMEOUT_MS)
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${cfg.baseUrl}/api/service/host-track-record`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-key': cfg.serviceKey },
      body: JSON.stringify(body),
      signal: ctl.signal,
      cache: 'no-store',
      // The shared secret must never follow a redirect to another host.
      redirect: 'error',
    })
    if (res.status !== 200) return null
    const parsed = rsvTrackSchema.safeParse(await res.json())
    if (!parsed.success) return null
    const tier = parsed.data.tier === 'fast_pass' ? 'fast_pass' : parsed.data.tier === 'flagged' ? 'flagged' : 'other'
    return {
      tier,
      rawTier: parsed.data.tier,
      // "fast_pass" must agree with the boolean; a mismatch is treated as no Fast Pass.
      eligibleForFastPass: tier === 'fast_pass' && parsed.data.eligibleForFastPass,
      verifiedParties: parsed.data.verifiedParties,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
