/** Code-link building for the features catalog. Pure: no network, no database. */
import type { CodeRef } from './types'

export const GITHUB_ORG = 'PizzaDAO'

/** "PizzaDAO/name" or "name" -> "name". */
export function repoName(repo: string): string {
  return repo.replace(/^PizzaDAO\//i, '').trim()
}

export function fullRepo(repo: string): string {
  return `${GITHUB_ORG}/${repoName(repo)}`
}

/** URL-encode each path segment (keeps the slashes). */
export function encodePath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/')
}

/** A last segment with an extension is treated as a file (blob), anything else as a folder (tree). */
export function isFilePath(path: string): boolean {
  const last = path.split('/').filter(Boolean).pop() ?? ''
  return /\.[A-Za-z0-9]+$/.test(last)
}

/** Link to the path on a branch or commit ref. An empty path links the repo root at that ref. */
export function codeUrl(repo: string, ref: string, path: string | undefined): string {
  const base = `https://github.com/${fullRepo(repo)}`
  const clean = (path ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!clean) return `${base}/tree/${encodeURIComponent(ref)}`
  return `${base}/${isFilePath(clean) ? 'blob' : 'tree'}/${encodeURIComponent(ref)}/${encodePath(clean)}`
}

/** Parse the stored `code` JSON defensively: bad rows are dropped, never thrown on. */
export function parseCodeRefs(raw: unknown): CodeRef[] {
  if (!Array.isArray(raw)) return []
  const out: CodeRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.repo !== 'string' || !o.repo.trim()) continue
    const ref: CodeRef = { repo: fullRepo(o.repo) }
    if (typeof o.path === 'string' && o.path.trim()) ref.path = o.path.trim().replace(/^\/+/, '')
    if (typeof o.description === 'string' && o.description.trim()) ref.description = o.description.trim()
    if (o.private === true) ref.private = true
    out.push(ref)
  }
  return out
}

/** Only http(s) URLs are ever rendered as links. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** A live URL may be a path on the app's own site ("/start") or an absolute http(s) URL. */
export function resolveLiveUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null
  if (raw.startsWith('/')) {
    const b = safeHttpUrl(base)
    if (!b) return null
    return `${b.replace(/\/$/, '')}${raw === '/' ? '' : raw}`
  }
  return safeHttpUrl(raw)
}
