import { requireAdmin } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { bulkPublishSchema } from '@/app/lib/features/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/features/publish  { published: boolean, appSlug?: string }
 * Admin only. Publishes or unpublishes every row (or one app and its features) in one go, after review.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const parsed = bulkPublishSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Invalid request' }, 400)
  const { published, appSlug } = parsed.data
  const by = auth.session.discordId
  try {
    const apps = await prisma.featureApp.updateMany({ where: appSlug ? { slug: appSlug } : {}, data: { published, updatedBy: by } })
    const entries = await prisma.featureEntry.updateMany({ where: appSlug ? { appSlug } : {}, data: { published, updatedBy: by } })
    return json({ apps: apps.count, entries: entries.count })
  } catch (e) {
    console.error('[features] publish failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not update' }, 500)
  }
}
