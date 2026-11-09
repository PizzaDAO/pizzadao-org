// PATCH /api/admin/pfp-assets/[id]: edit fields and/or replace the rules.
// DELETE /api/admin/pfp-assets/[id]: remove the asset (rules and grants cascade; members'
// composed images are untouched, the asset just stops being offered).
import { pfpAdminRoute, jsonBody } from '@/app/lib/pfp-assets/admin-route'
import { deleteAsset, updateAsset } from '@/app/lib/pfp-assets/catalog'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function idOf(ctx: { params: Promise<Record<string, string>> }): Promise<number> {
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Bad asset id', 'id')
  return id
}

export const PATCH = pfpAdminRoute(async (req, session, ctx) => {
  const asset = await updateAsset(await idOf(ctx), await jsonBody(req), session.discordId)
  return { asset }
})

export const DELETE = pfpAdminRoute(async (_req, session, ctx) => {
  await deleteAsset(await idOf(ctx), session.discordId)
  return { ok: true }
})
