import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { requireAdmin } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { entryCreateSchema, entryPatchSchema } from '@/app/lib/features/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const patchBody = z.object({ slug: z.string().min(1).max(80), patch: entryPatchSchema })

/** POST /api/admin/features/entries: create a feature row (admin only; unpublished unless told otherwise). */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const parsed = entryCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Invalid feature', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400)
  const { markReviewed, code, slug, appSlug, title, summary, ...rest } = parsed.data
  try {
    const row = await prisma.featureEntry.create({
      data: {
        ...rest,
        slug,
        appSlug,
        title,
        summary,
        code: (code ?? []) as unknown as Prisma.InputJsonValue,
        reviewedAt: markReviewed ? new Date() : null,
        updatedBy: auth.session.discordId,
      },
    })
    return json(row, 201)
  } catch {
    return json({ error: 'Could not create the feature (check the slug and app)' }, 409)
  }
}

/** PATCH /api/admin/features/entries  { slug, patch }: edit a feature row (admin only). */
export async function PATCH(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const parsed = patchBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Invalid edit', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400)
  const { markReviewed, code, ...rest } = parsed.data.patch
  try {
    const row = await prisma.featureEntry.update({
      where: { slug: parsed.data.slug },
      data: {
        ...rest,
        ...(code !== undefined ? { code: code as unknown as Prisma.InputJsonValue } : {}),
        ...(markReviewed ? { reviewedAt: new Date() } : {}),
        // Publishing, the coming-soon choice and marking reviewed are not content edits.
        ...(Object.keys(parsed.data.patch).some((k) => !['published', 'showWhenOff', 'markReviewed'].includes(k)) ? { editedAt: new Date() } : {}),
        updatedBy: auth.session.discordId,
      },
    })
    return json(row)
  } catch {
    return json({ error: 'Feature not found' }, 404)
  }
}
