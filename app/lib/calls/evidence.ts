/**
 * Evidence for a done action item: links (PRs, docs, ...) that show it was completed.
 * Stored as `evidence: [{ url }]` next to `done` on CallRecording.actionItems.
 */
export interface Evidence {
  url: string
}

export const MAX_EVIDENCE = 3
export const MAX_EVIDENCE_URL = 500
export const MAX_EVIDENCE_LABEL = 40

/** Only http(s) URLs (a real host; no spaces, angle brackets, parentheses or backslashes that could break masked links). */
export function safeEvidenceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > MAX_EVIDENCE_URL || /[\s<>()\\]/.test(s) || !/^https?:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null
    return u.toString()
  } catch {
    return null
  }
}

/** "PR #123" / "#123" for GitHub pull and issue URLs, otherwise the hostname. */
export function evidenceLabel(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'github.com') {
      const m = u.pathname.match(/^\/[^/]+\/[^/]+\/(pull|issues)\/(\d+)(?:\/|$)/)
      if (m) return m[1] === 'pull' ? `PR #${m[2]}` : `#${m[2]}`
    }
    return host.slice(0, MAX_EVIDENCE_LABEL)
  } catch {
    return url.slice(0, MAX_EVIDENCE_LABEL)
  }
}

/** Strict: calls `fail` (which throws) on anything invalid. Absent / null gives []. */
export function parseEvidenceStrict(raw: unknown, name: string, fail: (msg: string) => never): Evidence[] {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > MAX_EVIDENCE) return fail(`${name} must be an array of up to ${MAX_EVIDENCE}`)
  const out: Evidence[] = []
  raw.forEach((x, i) => {
    const url = safeEvidenceUrl(((x ?? {}) as { url?: unknown }).url)
    if (!url) return fail(`${name}[${i}].url must be an http(s) URL up to ${MAX_EVIDENCE_URL} characters`)
    if (!out.some((e) => e.url === url)) out.push({ url })
  })
  return out
}

/** Lenient read of stored data: valid entries only, at most MAX_EVIDENCE, each with its display label. */
export function readEvidence(raw: unknown): Array<{ url: string; label: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ url: string; label: string }> = []
  for (const x of raw) {
    const url = safeEvidenceUrl(((x ?? {}) as { url?: unknown }).url)
    if (!url || out.some((e) => e.url === url)) continue
    out.push({ url, label: evidenceLabel(url) })
    if (out.length >= MAX_EVIDENCE) break
  }
  return out
}

/** Space (and, for the input box, comma) separated URLs; invalid tokens are dropped. URLs may contain commas, so the textarea passes commas = false. */
export function parseEvidenceInput(raw: string, commas = true): Evidence[] {
  const out: Evidence[] = []
  for (const tok of raw.split(commas ? /[\s,]+/ : /\s+/)) {
    const url = safeEvidenceUrl(tok)
    if (url && !out.some((e) => e.url === url) && out.length < MAX_EVIDENCE) out.push({ url })
  }
  return out
}
