import type { IngestPayload } from './types.js'

export type IngestResult = { ok: true; id: string; duplicate: boolean; keys: string[] } | { ok: false; retryable: boolean; error: string }

/**
 * 5xx, 429, 408 and the auth/route errors 401/403/404 (a deploy or key problem
 * that will be fixed) are retried later; other 4xx mean the payload itself is bad.
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || [408, 429, 401, 403, 404].includes(status)
}

/** POST the finished call to the app. */
export async function postIngest(appBaseUrl: string, apiKey: string, payload: IngestPayload): Promise<IngestResult> {
  try {
    const res = await fetch(`${appBaseUrl}/api/calls/recorder/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const body = (await res.json()) as { id: string; duplicate: boolean; keys?: unknown }
      // The R2 keys the stored row references (for a duplicate: the EXISTING row's).
      const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : []
      return { ok: true, id: body.id, duplicate: body.duplicate, keys }
    }
    const text = (await res.text()).slice(0, 300)
    const retryable = isRetryableStatus(res.status)
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      // Almost always a misconfiguration (wrong RECORDER_API_KEY, route not deployed): shout, and keep the recording.
      console.error(`[ingest] app answered ${res.status}: check RECORDER_API_KEY and that the app is deployed with the ingest route`)
    }
    return { ok: false, retryable, error: `app answered ${res.status}: ${text}` }
  } catch (err) {
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function postIngestWithRetry(
  appBaseUrl: string,
  apiKey: string,
  payload: IngestPayload,
  attempts = 5,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<IngestResult> {
  let last: IngestResult = { ok: false, retryable: true, error: 'not attempted' }
  for (let i = 0; i < attempts; i++) {
    last = await postIngest(appBaseUrl, apiKey, payload)
    if (last.ok || !last.retryable) return last
    await sleep(Math.min(2000 * 2 ** i, 60_000))
  }
  return last
}
