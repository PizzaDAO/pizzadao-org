/**
 * "Check links": for every public code path of a catalog row, ask GitHub whether it still exists on the
 * default branch, and store the result on the row (admin lists broken ones; nothing is edited
 * automatically). Rate-limit aware: when GitHub says stop, the remaining rows are left unchecked.
 * Saving a result keeps the row's updatedAt, so it never counts as an admin edit for the seed import.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import type { GithubClient, PathStatus } from './github'
import { parseCodeRefs, repoName } from './links'

export type LinkDb = Pick<PrismaClient, 'featureApp' | 'featureEntry'>

export interface LinkResult {
  repo: string
  path: string
  status: PathStatus | 'private' | 'unlisted'
}

export interface StoredLinkCheck {
  checkedAt: string
  results: LinkResult[]
  broken: number
}

export interface LinkCheckSummary {
  checked: number
  broken: number
  /** Rows not reached because GitHub rate-limited us or the time budget ran out. */
  skipped: number
  rateLimited: boolean
  githubUnavailable: boolean
}

export async function runLinkChecks(
  db: LinkDb,
  client: GithubClient,
  opts: { now?: () => Date; budgetMs?: number; concurrency?: number } = {},
): Promise<LinkCheckSummary> {
  const now = opts.now ?? (() => new Date())
  const started = Date.now()
  const budget = opts.budgetMs ?? 240_000
  const summary: LinkCheckSummary = { checked: 0, broken: 0, skipped: 0, rateLimited: false, githubUnavailable: false }

  const repos = await client.listRepos()
  if (!repos) {
    summary.githubUnavailable = true
    return summary
  }
  const apps = await db.featureApp.findMany({ select: { repo: true, repoPrivate: true, defaultBranch: true } })
  const appByRepo = new Map(apps.filter((a) => a.repo).map((a) => [repoName(a.repo as string), a]))
  const entries = await db.featureEntry.findMany({ select: { slug: true, code: true, status: true, updatedAt: true } })

  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const e = entries[next++]
      if (Date.now() - started > budget || client.isRateLimited()) {
        summary.skipped++
        continue
      }
      const results: LinkResult[] = []
      let limited = false
      for (const ref of parseCodeRefs(e.code)) {
        const name = repoName(ref.repo)
        const path = ref.path ?? ''
        const facts = repos.get(name)
        if (e.status === 'private' || ref.private || appByRepo.get(name)?.repoPrivate) {
          results.push({ repo: ref.repo, path, status: 'private' })
        } else if (!facts || facts.private) {
          // Not in the public list: renamed, deleted or made private. The page stops linking it.
          results.push({ repo: ref.repo, path, status: 'unlisted' })
        } else if (!path) {
          results.push({ repo: ref.repo, path, status: 'ok' })
        } else {
          const branch = facts.defaultBranch ?? appByRepo.get(name)?.defaultBranch ?? 'main'
          const st = await client.checkPath(name, branch, path)
          if (st === 'rate_limited') limited = true
          results.push({ repo: ref.repo, path, status: st })
        }
      }
      if (limited) {
        summary.skipped++
        summary.rateLimited = true
        continue
      }
      const broken = results.filter((r) => r.status === 'missing' || r.status === 'unlisted').length
      const stored: StoredLinkCheck = { checkedAt: now().toISOString(), results, broken }
      await db.featureEntry.update({
        where: { slug: e.slug },
        data: { linkCheck: stored as unknown as Prisma.InputJsonValue, linkCheckedAt: now(), updatedAt: e.updatedAt },
      })
      summary.checked++
      summary.broken += broken
    }
  }
  const n = Math.max(1, opts.concurrency ?? 4)
  await Promise.all(Array.from({ length: n }, worker))
  if (client.isRateLimited()) summary.rateLimited = true
  return summary
}
