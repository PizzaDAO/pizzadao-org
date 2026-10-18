import type { IngestPayload } from './types.js'

export type IngestResult = { ok: true; id: string; duplicate: boolean } | { ok: false; retryable: boolean; error: string }

/** POST the finished call to the app. 4xx (except 429) is permanent; the rest may be retried. */
export async function postIngest(appBaseUrl: string, apiKey: string, payload: IngestPayload): Promise<IngestResult> {
  try {
    const res = await fetch(`${appBaseUrl}/api/calls/recorder/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const body = (await res.json()) as { id: string; duplicate: boolean }
      return { ok: true, id: body.id, duplicate: body.duplicate }
    }
    const text = (await res.text()).slice(0, 300)
    const retryable = res.status >= 500 || res.status === 429
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
