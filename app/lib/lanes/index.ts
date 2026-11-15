/**
 * Lane reads and member writes (plans/lane-cards-mission-onboarding.md). Everything public is
 * gated by the `onboarding.laneCardsEnabled` toggle and fails closed (a read error means "off").
 */
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

/** slug -> guide href for every published lane; empty while the toggle is off or on any failure. */
export async function getPublicLaneLinks(): Promise<Record<string, string>> {
  try {
    if (!(await lanesEnabled())) return {}
    const rows = await prisma.lane.findMany({ where: { published: true }, select: { slug: true } })
    return Object.fromEntries(rows.map((r: { slug: string }) => [r.slug, `/lanes/${r.slug}?pick=1`]))
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
  await prisma.memberLane.upsert({
    where: { discordId_laneSlug: { discordId, laneSlug: slug } },
    create: { discordId, laneSlug: slug, source, pinnedAt: now },
    update: { pinnedAt: now },
  })
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
  const row = await prisma.memberLane.findUnique({ where: { discordId_laneSlug: { discordId, laneSlug: slug } } })
  const next = applyStepTick(row?.doneStepIds ?? [], stepId, done, stepIds)
  if (!row) {
    // Only record a row when something was ticked; an unknown step id on a fresh member writes nothing.
    if (next.length === 0) return []
    await prisma.memberLane.create({ data: { discordId, laneSlug: slug, source: 'guide', doneStepIds: next } })
    return next
  }
  await prisma.memberLane.update({ where: { discordId_laneSlug: { discordId, laneSlug: slug } }, data: { doneStepIds: next } })
  return next
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
