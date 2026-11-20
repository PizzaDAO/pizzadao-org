// Member PFP composer API. Members only; the owner is always the session's own member.
//
// GET    -> { assets: [{...asset, unlocked, hint}], bases, current, level }  (display data)
// POST   { base: {kind, url?}, layers: [{assetId, x, y, scale, rotation}] } -> composes + saves.
//        The server re-checks every layer against the member's unlocks; the GET list is display only.
// DELETE -> reset to the original PFP (drops the composed image).
import { after } from 'next/server'
import { invalidateProfileSummary } from '@/app/lib/profile-summary-cache'
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
import { allowedBaseKinds, assertBaseKindAllowed, assertCanEdit, loadEditAccess } from '@/app/lib/pfp-assets/access'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { getSetting } from '@/app/lib/settings'
import { imageReviewAccess } from '@/app/lib/image-review/access'
import { loadRemainingMissions } from '@/app/lib/pfp-assets/remaining'
import { evaluateAllowance, loadRestyleSettings, loadUsage, usageByOutfit } from '@/app/lib/pfp-assets/restyle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseBase(v: unknown): { kind: import('@/app/lib/pfp-assets/compose').BaseKind; url?: string } | undefined {
  const o = v as { kind?: unknown; url?: unknown } | null | undefined
  if (!o || !isBaseKind(o.kind)) return undefined
  return { kind: o.kind, url: typeof o.url === 'string' ? o.url : undefined }
}

async function lockedExtras(discordId: string, completed: number, minLevel: number) {
  const [remaining, link, reviewAccess] = await Promise.all([
    loadRemainingMissions(discordId, completed, minLevel).catch(() => []),
    getSetting('pfp.lockedReviewLink').catch(() => ''),
    imageReviewAccess(discordId).catch(() => null),
  ])
  // The review has its own minimum level: the page says which one to reach.
  return { remaining, review: link ? { href: link, canVote: !!reviewAccess?.role, minLevel: reviewAccess?.minLevel ?? 2 } : null }
}

export const GET = memberPfpRoute(async (_req, { memberId, discordId }) => {
  const [access, baseKinds, who] = await Promise.all([
    loadEditAccess(discordId),
    allowedBaseKinds(),
    fetchMemberByDiscordId(discordId).catch(() => null),
  ])
  const [assets, ctx, bases, current, outfitOverlay, restyleSettings, used] = await Promise.all([
    listAssets({ activeOnly: true }),
    loadUnlockContext(discordId),
    availableBases(memberId, discordId),
    prisma.memberPfp.findUnique({ where: { memberId } }),
    toggleEnabled('pfp.outfitOverlayEnabled'),
    loadRestyleSettings(),
    usageByOutfit(memberId).catch(() => ({}) as Record<number, number>),
  ])
  const usage = await loadUsage(memberId, null).catch(() => null)
  // Daily and monthly gates only (null outfit): the per-outfit count is in `usedByOutfit`.
  const gate = usage ? evaluateAllowance(restyleSettings, { ...usage, forOutfit: 0 }) : null
  const unlocked = unlockedAssetIds(assets, ctx)
  // Locked page only: the member's own unfinished missions and the dough-ball review link.
  const lockedP = access.allowed ? null : lockedExtras(discordId, access.completed, access.minLevel)
  // Only the names the locked hints need (not the admin pickers' full lists).
  const [lookups, locked] = await Promise.all([hintLookups(assets.filter((a) => !unlocked.has(a.id))), lockedP])
  return {
    level: ctx.level,
    allowedBaseKinds: baseKinds,
    // The member's own mafia name, for drawing their portrait from the editor.
    memberName: who?.name ?? '',
    access: { allowed: access.allowed, minLevel: access.minLevel, completed: access.bypass ? ctx.level : access.completed },
    ...(locked ?? {}),
    outfitOverlay,
    restyle: {
      enabled: restyleSettings.enabled,
      perUnlock: restyleSettings.perUnlock,
      dailyRemaining: usage ? Math.max(0, restyleSettings.dailyLimit - usage.today) : 0,
      blocked: gate && !gate.ok ? gate.message : null,
      usedByOutfit: used,
    },
    bases,
    current: current
      ? {
          baseKind: current.baseKind,
          baseUrl: current.baseUrl,
          layers: current.layers,
          composedUrl: current.composedUrl,
          original: current.originalBaseKind ? { kind: current.originalBaseKind, url: current.originalBaseUrl } : null,
        }
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
  await assertCanEdit(discordId)
  await assertBaseKindAllowed(base.kind)
  await assertBaseKindAllowed((body.original as { kind?: unknown } | undefined)?.kind)
  const res = await composeMemberPfp({
    memberId,
    discordId,
    base: { kind: base.kind, url: typeof base.url === 'string' ? base.url : undefined },
    original: parseBase(body.original),
    layers: body.layers ?? [],
  })
  // Saved: DM the download link after the response (own setting, throttled; a failure is swallowed).
  const saved = () => import('@/app/lib/pfp-dm').then((m) => m.maybeSendPfpSavedDm(discordId, memberId)).catch(() => {})
  try { after(saved) } catch { void saved() }
  return { ok: true, composedUrl: res.composedUrl, layers: res.layers }
}, { rateLimit: 'pfp-compose' })

export const DELETE = memberPfpRoute(async (_req, { memberId }) => {
  const row = await prisma.memberPfp.findUnique({ where: { memberId }, select: { composedUrl: true } })
  await prisma.memberPfp.deleteMany({ where: { memberId } })
  invalidateProfileSummary(memberId)
  if (row?.composedUrl && isOwnBlobUrl(row.composedUrl)) await del(row.composedUrl).catch(() => undefined)
  return { ok: true }
})
