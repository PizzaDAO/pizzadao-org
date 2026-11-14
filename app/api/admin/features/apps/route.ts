import { z } from 'zod'
import { requireAdmin } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { appCreateSchema, appPatchSchema } from '@/app/lib/features/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const patchBody = z.object({ slug: z.string().min(1).max(80), patch: appPatchSchema })

/** POST /api/admin/features/apps: create an app (admin only; created unpublished unless told otherwise). */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const parsed = appCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Invalid app', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400)
  try {
    const row = await prisma.featureApp.create({ data: { ...parsed.data, slug: parsed.data.slug, name: parsed.data.name, updatedBy: auth.session.discordId } })
    return json(row, 201)
  } catch {
    return json({ error: 'Could not create the app (does the slug already exist?)' }, 409)
  }
}

/** PATCH /api/admin/features/apps  { slug, patch }: edit an app (admin only). */
export async function PATCH(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const parsed = patchBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Invalid edit', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400)
  try {
    const row = await prisma.featureApp.update({ where: { slug: parsed.data.slug }, data: { ...parsed.data.patch, updatedBy: auth.session.discordId } })
    return json(row)
  } catch {
    return json({ error: 'App not found' }, 404)
  }
}
