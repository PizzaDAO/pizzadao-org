/**
 * Bounded HTTP for the semi-automatic verifiers and proof previews: every
 * request has a timeout and a response-size cap, and never throws (a network
 * error or a timeout is `null`, which the verifiers report as "unchecked").
 * The fetch implementation is injected so tests never reach the network.
 */

export const DEFAULT_TIMEOUT_MS = 4000
export const DEFAULT_MAX_BYTES = 256 * 1024

export interface CappedResponse {
  ok: boolean
  status: number
  headers: Headers
  /** The body, cut at maxBytes. */
  text: string
  truncated: boolean
  /** The final URL (after fetch-followed redirects). */
  url: string
}

export interface CapOptions {
  timeoutMs?: number
  maxBytes?: number
}

/** Read at most `maxBytes` of a body, then cancel the stream. */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const body = res.body
  if (!body) {
    const t = await res.text().catch(() => '')
    return { text: t.slice(0, maxBytes), truncated: t.length > maxBytes }
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (size + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - size))
        size = maxBytes
        truncated = true
        break
      }
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => {})
    else reader.releaseLock?.()
  }
  const buf = new Uint8Array(size)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.byteLength
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(buf), truncated }
}

export async function fetchCapped(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  opts: CapOptions = {},
): Promise<CappedResponse | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { cache: 'no-store', ...init, signal: ctrl.signal })
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes * 8) {
      // Far too big to be a page or an API answer we want: don't read it.
      await res.body?.cancel().catch(() => {})
      return { ok: res.ok, status: res.status, headers: res.headers, text: '', truncated: true, url: res.url || url }
    }
    const { text, truncated } = await readCapped(res, maxBytes)
    return { ok: res.ok, status: res.status, headers: res.headers, text, truncated, url: res.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** GET JSON. `null` on a network error, a timeout, or a body that isn't JSON. */
export async function fetchJsonCapped<T = unknown>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  opts: CapOptions = {},
): Promise<{ status: number; ok: boolean; json: T | null } | null> {
  const r = await fetchCapped(fetchImpl, url, { ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) } }, opts)
  if (!r) return null
  if (r.truncated) return { status: r.status, ok: false, json: null }
  try {
    return { status: r.status, ok: r.ok, json: JSON.parse(r.text) as T }
  } catch {
    return { status: r.status, ok: r.ok, json: null }
  }
}
