/**
 * Lane reads and member writes (plans/lane-cards-mission-onboarding.md). Everything public is
 * gated by the `onboarding.laneCardsEnabled` toggle and fails closed (a read error means "off").
 */
import { revalidateTag, unstable_cache } from 'next/cache'
import { prisma } from '@/app/lib/db'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { applyStepTick, computeProgress, pickPinned } from './progress'
import { isLaneSlug } from './links'

export type LaneSource = 'signup' | 'card' | 'dashboard' | 'guide'

export interface LaneStepView {
  id: string
  position: number
  title: string
  body: string
  linkHref: string | null
  linkLabel: string | null
  kind: string
}

export interface LaneView {
  slug: string
  tag: string
  title: string
  summary: string
  missionId: number | null
  stretchMissionIds: number[]
  crewId: string | null
  position: number
  steps: LaneStepView[]
}

export async function lanesEnabled(): Promise<boolean> {
  try {
    return await toggleEnabled('onboarding.laneCardsEnabled')
  } catch {
    return false
  }
}

const LANE_LINKS_TAG = 'lane-links'
const LANE_LINKS_TTL_SECONDS = 60

async function loadPublishedSlugs(): Promise<string[]> {
  const rows = await prisma.lane.findMany({ where: { published: true }, select: { slug: true } })
  return rows.map((r: { slug: string }) => r.slug)
}

/** Expire the cached public lane links at once; the admin lane writes call this. Never throws. */
export function invalidateLaneLinks(): void {
  try {
    revalidateTag(LANE_LINKS_TAG, { expire: 0 })
  } catch {
    // Outside a Next request (scripts, tests): nothing is cached.
  }
}

/**
 * slug -> guide href for every published lane; empty while the toggle is off or on any failure. The
 * toggle is read live; only the lane list is cached (short TTL, tag `lane-links`, expired by the
 * admin lane writes), so /community does not query lanes on every request.
 */
export async function getPublicLaneLinks(): Promise<Record<string, string>> {
  try {
    if (!(await lanesEnabled())) return {}
    let slugs: string[]
    try {
      slugs = await unstable_cache(loadPublishedSlugs, ['lane-links-v1'], { revalidate: LANE_LINKS_TTL_SECONDS, tags: [LANE_LINKS_TAG] })()
    } catch {
      // Outside a Next request (scripts, tests) there is no data cache; a real read error re-throws from here.
      slugs = await loadPublishedSlugs()
    }
    return Object.fromEntries(slugs.map((slug) => [slug, `/lanes/${slug}?pick=1`]))
  } catch {
    return {}
  }
}

/** A published lane with its steps in order, or null (unknown, unpublished or a bad slug). Does not check the toggle. */
export async function getPublishedLane(slug: string): Promise<LaneView | null> {
  if (!isLaneSlug(slug)) return null
  const lane = await prisma.lane.findFirst({
    where: { slug, published: true },
    include: { steps: { orderBy: { position: 'asc' } } },
  })
  if (!lane) return null
  return {
    slug: lane.slug,
    tag: lane.tag,
    title: lane.title,
    summary: lane.summary,
    missionId: lane.missionId ?? null,
    stretchMissionIds: lane.stretchMissionIds ?? [],
    crewId: lane.crewId ?? null,
    position: lane.position,
    steps: lane.steps.map((s) => ({
      id: s.id,
      position: s.position,
      title: s.title,
      body: s.body,
      linkHref: s.linkHref ?? null,
      linkLabel: s.linkLabel ?? null,
      kind: s.kind,
    })),
  }
}

/** Pin a published lane for a member (idempotent; the latest pin wins). Returns false when the lane is not published. */
export async function pinLane(discordId: string, slug: string, source: LaneSource): Promise<boolean> {
  if (!isLaneSlug(slug)) return false
  const lane = await prisma.lane.findFirst({ where: { slug, published: true }, select: { slug: true } })
  if (!lane) return false
  const now = new Date()
  // One INSERT ... ON CONFLICT so concurrent first writes (two tabs, a card plus a button) cannot collide on the primary key.
  await prisma.$executeRaw`
    INSERT INTO "MemberLane" ("discordId", "laneSlug", "source", "doneStepIds", "pinnedAt", "firstSeenAt", "updatedAt")
    VALUES (${discordId}, ${slug}, ${source}, ARRAY[]::TEXT[], ${now}, ${now}, ${now})
    ON CONFLICT ("discordId", "laneSlug") DO UPDATE SET "pinnedAt" = EXCLUDED."pinnedAt", "updatedAt" = EXCLUDED."updatedAt"`
  return true
}

/** Tick or untick a step on a published lane. Unknown step ids are ignored. Returns the member's done ids, or null if the lane is not published. */
export async function setStepDone(discordId: string, slug: string, stepId: string, done: boolean): Promise<string[] | null> {
  if (!isLaneSlug(slug)) return null
  const lane = await prisma.lane.findFirst({
    where: { slug, published: true },
    select: { slug: true, steps: { select: { id: true, kind: true } } },
  })
  if (!lane) return null
  const stepIds = lane.steps.filter((s) => s.kind !== 'submit').map((s) => s.id)
  if (!stepIds.includes(stepId)) {
    // Unknown step or a submit step: nothing to write, just report the member's current ticks.
    const row = await prisma.memberLane.findUnique({ where: { discordId_laneSlug: { discordId, laneSlug: slug } } })
    return applyStepTick(row?.doneStepIds ?? [], stepId, done, stepIds)
  }
  // Each write is one atomic statement (array_append / array_remove, INSERT ... ON CONFLICT), so concurrent
  // ticks never lose each other and two first visits never collide on the primary key.
  const now = new Date()
  let rows: Array<{ doneStepIds: string[] | null }>
  if (done) {
    rows = await prisma.$queryRaw`
      INSERT INTO "MemberLane" ("discordId", "laneSlug", "source", "doneStepIds", "firstSeenAt", "updatedAt")
      VALUES (${discordId}, ${slug}, 'guide', ARRAY[${stepId}]::TEXT[], ${now}, ${now})
      ON CONFLICT ("discordId", "laneSlug") DO UPDATE SET
        "doneStepIds" = CASE
          WHEN ${stepId}::TEXT = ANY(COALESCE("MemberLane"."doneStepIds", ARRAY[]::TEXT[])) THEN COALESCE("MemberLane"."doneStepIds", ARRAY[]::TEXT[])
          ELSE array_append(COALESCE("MemberLane"."doneStepIds", ARRAY[]::TEXT[]), ${stepId}::TEXT)
        END,
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "doneStepIds"`
  } else {
    rows = await prisma.$queryRaw`
      UPDATE "MemberLane"
      SET "doneStepIds" = array_remove(COALESCE("doneStepIds", ARRAY[]::TEXT[]), ${stepId}::TEXT), "updatedAt" = ${now}
      WHERE "discordId" = ${discordId} AND "laneSlug" = ${slug}
      RETURNING "doneStepIds"`
  }
  // Report current steps only (ids of deleted steps drop out).
  const valid = new Set(stepIds)
  return (rows[0]?.doneStepIds ?? []).filter((id) => valid.has(id))
}

export async function getMemberLane(discordId: string, slug: string) {
  return prisma.memberLane.findUnique({ where: { discordId_laneSlug: { discordId, laneSlug: slug } } })
}

export interface PinnedLaneSummary {
  slug: string
  tag: string
  title: string
  missionId: number | null
  done: number
  total: number
  href: string
}

/** The member's pinned, still-published lane with its progress (for the dashboard). Null on any failure. */
export async function getPinnedLaneSummary(discordId: string): Promise<PinnedLaneSummary | null> {
  try {
    const rows = await prisma.memberLane.findMany({ where: { discordId, pinnedAt: { not: null } }, orderBy: { pinnedAt: 'desc' }, take: 5 })
    // Latest pin first (pickPinned keeps the rule in one place); fall through to an older pin when the latest lane was unpublished since.
    const first = pickPinned(rows)
    const ordered = first ? [first, ...rows.filter((r) => r !== first)] : []
    for (const row of ordered) {
      const lane = await prisma.lane.findFirst({
        where: { slug: row.laneSlug, published: true },
        include: { steps: { orderBy: { position: 'asc' }, select: { id: true, kind: true } } },
      })
      if (!lane) continue
      let submitDone = false
      if (lane.missionId != null) {
        const c = await prisma.missionCompletion.findUnique({
          where: { missionId_discordId: { missionId: lane.missionId, discordId } },
          select: { status: true },
        })
        submitDone = c?.status === 'PENDING' || c?.status === 'APPROVED'
      }
      const { done, total } = computeProgress(lane.steps, row.doneStepIds ?? [], submitDone)
      return { slug: lane.slug, tag: lane.tag, title: lane.title, missionId: lane.missionId ?? null, done, total, href: `/lanes/${lane.slug}` }
    }
    return null
  } catch {
    return null
  }
}
