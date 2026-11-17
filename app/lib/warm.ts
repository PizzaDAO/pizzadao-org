/**
 * The site prewarm (cron /api/cron/warm): GET-only requests over the public URL so the page and API
 * function instances, the shared caches and the database connection stay warm. Reads only; it must
 * never write. What to warm comes from settings (members.warmProfileIds / members.warmPaths).
 */
export const WARM_MAX_IDS = 10
export const WARM_MAX_PATHS = 20
export const WARM_TIMEOUT_MS = 10_000

/** Member ids, one per line, digits only, deduped, capped. */
export function parseWarmIds(raw: string): string[] {
  const ids = raw.split('\n').map((l) => l.trim()).filter((l) => /^\d{1,10}$/.test(l))
  return [...new Set(ids)].slice(0, WARM_MAX_IDS)
}

/** Site paths, one per line, must start with a single "/" (never a full URL), deduped, capped. */
export function parseWarmPaths(raw: string): string[] {
  const paths = raw.split('\n').map((l) => l.trim()).filter((l) => /^\/(?!\/)\S*$/.test(l))
  return [...new Set(paths)].slice(0, WARM_MAX_PATHS)
}

/** Every path to request: the configured pages, then each profile page and its summary API. */
export function warmTargets(idsRaw: string, pathsRaw: string): string[] {
  const ids = parseWarmIds(idsRaw)
  return [
    ...parseWarmPaths(pathsRaw),
    ...ids.flatMap((id) => [`/profile/${encodeURIComponent(id)}`, `/api/profile-summary/${encodeURIComponent(id)}`]),
  ]
}

export interface WarmResult {
  path: string
  status: number | null
  ms: number
}

/** Request every target in parallel (parallel requests also start several function instances). Never throws. */
export async function runWarm(baseUrl: string, targets: string[], fetchImpl: typeof fetch = fetch): Promise<WarmResult[]> {
  const base = baseUrl.replace(/\/$/, '')
  return Promise.all(
    targets.map(async (path): Promise<WarmResult> => {
      const started = Date.now()
      try {
        const res = await fetchImpl(`${base}${path}`, {
          method: 'GET',
          headers: { 'user-agent': 'pizzadao-warm/1', 'x-warm': '1' },
          signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
          cache: 'no-store',
          redirect: 'manual',
        })
        await res.arrayBuffer().catch(() => undefined) // drain, so the page finishes rendering
        return { path, status: res.status, ms: Date.now() - started }
      } catch {
        return { path, status: null, ms: Date.now() - started }
      }
    }),
  )
}
