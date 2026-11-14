/**
 * GitHub facts for the features catalog: repo visibility, default branch, license, the default-branch
 * HEAD commit, and whether a path still exists. Every call fails soft. A rate limit stops further calls
 * for the rest of the run (the caller then renders without the extra facts). Results are cached in
 * memory for the configured number of minutes, per server instance.
 */
import { GITHUB_ORG, encodePath, repoName } from './links'
import type { RepoFacts, RepoFactsMap } from './types'

const API = 'https://api.github.com'
const RATE_LIMIT_PAUSE_MS = 10 * 60_000
const FAILURE_RETRY_MS = 2 * 60_000

export class RateLimitedError extends Error {
  constructor() {
    super('GitHub rate limit reached')
    this.name = 'RateLimitedError'
  }
}

export type PathStatus = 'ok' | 'missing' | 'error' | 'rate_limited'

export interface GithubClientOptions {
  fetchImpl?: typeof fetch
  token?: string | null
  cacheMs?: number
  now?: () => number
}

interface ListedRepo {
  name: string
  private: boolean
  default_branch: string | null
  license: { spdx_id: string | null } | null
  pushed_at: string | null
  archived: boolean
}

function headers(token: string | null | undefined, accept = 'application/vnd.github+json'): HeadersInit {
  const h: Record<string, string> = { Accept: accept, 'User-Agent': 'PizzaDAO-Features-Catalog', 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function isRateLimit(res: Response): boolean {
  if (res.status === 429) return true
  return res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
}

export function createGithubClient(opts: GithubClientOptions = {}) {
  const f = opts.fetchImpl ?? fetch
  const token = opts.token === undefined ? (process.env.GITHUB_TOKEN ?? null) : opts.token
  const ttl = opts.cacheMs ?? 60 * 60_000
  const now = opts.now ?? Date.now
  const cache = new Map<string, { until: number; value: unknown }>()
  // After a rate limit, stop calling GitHub for a while instead of hammering it on every request.
  let limitedUntil = 0
  const markLimited = () => {
    limitedUntil = now() + RATE_LIMIT_PAUSE_MS
  }
  const isLimited = () => now() < limitedUntil

  const cached = async <T>(key: string, load: () => Promise<T>, force = false): Promise<T> => {
    const hit = cache.get(key)
    if (!force && hit && now() < hit.until) return hit.value as T
    const value = await load()
    cache.set(key, { until: now() + ttl, value })
    return value
  }

  /** Every repo in the org the token (or anonymous access) can see. Null when GitHub did not answer. */
  async function listRepos(opts: { force?: boolean } = {}): Promise<RepoFactsMap | null> {
    if (isLimited()) return (cache.get('repos')?.value as RepoFactsMap | null | undefined) ?? null
    try {
      return await cached('repos', async () => {
        const map: RepoFactsMap = new Map()
        for (let page = 1; page <= 6; page++) {
          const res = await f(`${API}/orgs/${GITHUB_ORG}/repos?per_page=100&type=all&page=${page}`, { headers: headers(token), cache: 'no-store' })
          if (isRateLimit(res)) {
            markLimited()
            throw new RateLimitedError()
          }
          if (!res.ok) throw new Error(`GitHub repo list answered ${res.status}`)
          const rows = (await res.json()) as ListedRepo[]
          for (const r of rows) {
            const facts: RepoFacts = {
              private: !!r.private,
              defaultBranch: r.default_branch ?? null,
              license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : null,
              pushedAt: r.pushed_at ?? null,
              archived: !!r.archived,
            }
            map.set(r.name, facts)
          }
          if (rows.length < 100) break
        }
        return map
      }, opts.force)
    } catch {
      cache.set('repos', { until: now() + Math.min(ttl, FAILURE_RETRY_MS), value: null })
      return null
    }
  }

  /** SHA of the head of `branch`, or null. */
  async function headCommit(repo: string, branch: string): Promise<string | null> {
    if (isLimited()) return null
    try {
      return await cached(`sha:${repo}:${branch}`, async () => {
        const res = await f(`${API}/repos/${GITHUB_ORG}/${repoName(repo)}/commits/${encodeURIComponent(branch)}`, {
          headers: headers(token, 'application/vnd.github.sha'),
          cache: 'no-store',
        })
        if (isRateLimit(res)) {
          markLimited()
          throw new RateLimitedError()
        }
        if (!res.ok) return null
        const sha = (await res.text()).trim()
        return /^[0-9a-f]{40}$/.test(sha) ? sha : null
      })
    } catch {
      return null
    }
  }

  /** Whether `path` still exists on `branch`. */
  async function checkPath(repo: string, branch: string, path: string, opts: { force?: boolean } = {}): Promise<PathStatus> {
    if (isLimited()) return 'rate_limited'
    try {
      return await cached(`path:${repo}:${branch}:${path}`, async () => {
        const res = await f(`${API}/repos/${GITHUB_ORG}/${repoName(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, {
          headers: headers(token),
          cache: 'no-store',
        })
        if (isRateLimit(res)) {
          markLimited()
          throw new RateLimitedError()
        }
        if (res.status === 404) return 'missing' as PathStatus
        return (res.ok ? 'ok' : 'error') as PathStatus
      }, opts.force)
    } catch (e) {
      return e instanceof RateLimitedError ? 'rate_limited' : 'error'
    }
  }

  return { listRepos, headCommit, checkPath, isRateLimited: isLimited }
}

export type GithubClient = ReturnType<typeof createGithubClient>

let shared: { client: GithubClient; ms: number } | null = null

/** One client per server instance (so its cache is shared); rebuilt when the cache window changes. */
export function sharedGithubClient(cacheMinutes: number): GithubClient {
  const ms = Math.max(1, cacheMinutes) * 60_000
  if (!shared || shared.ms !== ms) shared = { client: createGithubClient({ cacheMs: ms }), ms }
  return shared.client
}
