import { requireAdmin } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { loadSwitches } from '@/app/lib/features/service'
import { sharedGithubClient } from '@/app/lib/features/github'
import { runLinkChecks } from '@/app/lib/features/link-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/features/check-links
 * Admin only. Asks GitHub whether each public code path still exists and stores the result on the row.
 * Cached per the "GitHub facts cache" setting and stops cleanly when GitHub rate-limits.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  try {
    const { githubCacheMinutes } = await loadSwitches()
    return json(await runLinkChecks(prisma, sharedGithubClient(githubCacheMinutes), { budgetMs: 240_000, force: true }))
  } catch (e) {
    console.error('[features] link check failed', e instanceof Error ? e.message : e)
    return json({ error: 'Link check failed' }, 500)
  }
}
