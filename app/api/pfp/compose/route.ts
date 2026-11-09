// Member PFP composer API. Members only; the owner is always the session's own member.
//
// GET    -> { assets: [{...asset, unlocked, hint}], bases, current, level }  (display data)
// POST   { base: {kind, url?}, layers: [{assetId, x, y, scale, rotation}] } -> composes + saves.
//        The server re-checks every layer against the member's unlocks; the GET list is display only.
// DELETE -> reset to the original PFP (drops the composed image).
import { del } from '@vercel/blob'
import { prisma } from '@/app/lib/db'
import { isOwnBlobUrl } from '@/app/lib/blob-url'
import { memberPfpRoute } from '@/app/lib/pfp-assets/member-route'
import { jsonBody } from '@/app/lib/pfp-assets/admin-route'
import { listAssets, hintLookups } from '@/app/lib/pfp-assets/catalog'
import { loadUnlockContext } from '@/app/lib/pfp-assets/context'
import { unlockedAssetIds } from '@/app/lib/pfp-assets/unlocks'
import { lockHint } from '@/app/lib/pfp-assets/types'
import { availableBases, composeMemberPfp, isBaseKind } from '@/app/lib/pfp-assets/compose'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = memberPfpRoute(async (_req, { memberId, discordId }) => {
  const [assets, ctx, bases, current] = await Promise.all([
    listAssets({ activeOnly: true }),
    loadUnlockContext(discordId),
    availableBases(memberId, discordId),
    prisma.memberPfp.findUnique({ where: { memberId } }),
  ])
  const unlocked = unlockedAssetIds(assets, ctx)
  // Only the names the locked hints need (not the admin pickers' full lists).
  const lookups = await hintLookups(assets.filter((a) => !unlocked.has(a.id)))
  return {
    level: ctx.level,
    bases,
    current: current
      ? { baseKind: current.baseKind, baseUrl: current.baseUrl, layers: current.layers, composedUrl: current.composedUrl }
      : null,
    assets: assets.map((a) => {
      const isUnlocked = unlocked.has(a.id)
      // Rules and role ids stay server-side: the member only needs the hint.
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        imageUrl: a.imageUrl,
        thumbUrl: a.thumbUrl,
        defaultTransform: a.defaultTransform,
        sortOrder: a.sortOrder,
        unlocked: isUnlocked,
        hint: isUnlocked ? null : lockHint(a, lookups),
      }
    }),
  }
})

export const POST = memberPfpRoute(async (req, { memberId, discordId }) => {
  const body = await jsonBody(req)
  const base = body.base as { kind?: unknown; url?: unknown } | undefined
  if (!base || !isBaseKind(base.kind)) throw new ValidationError('Choose a base picture', 'base')
  const res = await composeMemberPfp({
    memberId,
    discordId,
    base: { kind: base.kind, url: typeof base.url === 'string' ? base.url : undefined },
    layers: body.layers ?? [],
  })
  return { ok: true, composedUrl: res.composedUrl, layers: res.layers }
}, { rateLimit: 'pfp-compose' })

export const DELETE = memberPfpRoute(async (_req, { memberId }) => {
  const row = await prisma.memberPfp.findUnique({ where: { memberId }, select: { composedUrl: true } })
  await prisma.memberPfp.deleteMany({ where: { memberId } })
  if (row?.composedUrl && isOwnBlobUrl(row.composedUrl)) await del(row.composedUrl).catch(() => undefined)
  return { ok: true }
})
