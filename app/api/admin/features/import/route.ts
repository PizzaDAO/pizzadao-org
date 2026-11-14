import { requireAdmin } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import seedJson from '@/data/features-seed.json'
import { importSeed } from '@/app/lib/features/seed-import'
import type { Seed } from '@/app/lib/features/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/features/import
 * Admin only. Loads data/features-seed.json idempotently: new rows come in unpublished, rows an admin edited
 * are never overwritten.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  try {
    const summary = await importSeed(prisma, seedJson as unknown as Seed)
    return json(summary)
  } catch (e) {
    console.error('[features] import failed', e instanceof Error ? e.message : e)
    return json({ error: 'Import failed' }, 500)
  }
}
