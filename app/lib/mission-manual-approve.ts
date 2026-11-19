/**
 * Manual mission approval: a reviewer marks a member's mission complete from the member's profile,
 * without a submission. It goes through the SAME approveMission path as a normal review (conditional
 * PENDING -> APPROVED, audit event, level settlement with the exactly-once MISSION_REWARD ledger
 * marker), so rewards are paid once. The audit event carries via = "manual".
 *
 * No undo: the MISSION_REWARD ledger row is also the "level paid" marker that level computation
 * reads, and there is no ledger reversal for it, so a revert would leave the level paid with the
 * mission unapproved. Not built on purpose.
 */
import { prisma } from './db'
import { approveMission, recordReviewEvent, REQUIRED_MISSION_WHERE } from './missions'
import { canReviewMission, missionReviewScope } from './mission-review-access'
import { fetchMemberById, fetchMemberIdByDiscordId } from './sheets/member-repository'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors/api-errors'

export const MANUAL_VIA = 'manual'
export const MIN_NOTE = 3
export const MAX_NOTE = 500

export type PanelStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'NOT_SUBMITTED'

export interface PanelMission {
  missionId: number
  level: number
  title: string
  status: PanelStatus
  /** Approved by a reviewer through this panel (not by a submission). */
  manual: boolean
}

/** Resolve a member id (sheet/DB lookup only; never a client-supplied Discord id) to the member's Discord id (null when unknown). */
export async function resolveTargetDiscordId(ref: { memberId?: unknown }): Promise<string | null> {
  if (typeof ref.memberId === 'string' && ref.memberId.trim()) {
    const row = await fetchMemberById(ref.memberId.trim()).catch(() => null)
    const id = row?.discordId ? String(row.discordId) : ''
    return id || null
  }
  return null
}

async function memberIdForDiscord(discordId: string): Promise<string | null> {
  return fetchMemberIdByDiscordId(discordId).catch(() => null)
}

/** Nobody acts on their own missions; otherwise the level's normal reviewer rule. */
export async function assertCanManualApprove(reviewerId: string, targetDiscordId: string, level: number): Promise<void> {
  if (reviewerId === targetDiscordId) throw new ForbiddenError("You can't approve your own missions")
  if (!(await canReviewMission(reviewerId, level))) {
    throw new ForbiddenError(`You can't review Level ${level} missions`)
  }
}

/** The member's required missions the reviewer may act on, with status. Empty when none / own profile. */
export async function listPanelMissions(reviewerId: string, targetDiscordId: string): Promise<PanelMission[]> {
  if (reviewerId === targetDiscordId) return []
  const scope = await missionReviewScope(reviewerId)
  if (!scope) return []
  const [missions, completions] = await Promise.all([
    prisma.mission.findMany({
      where: REQUIRED_MISSION_WHERE,
      orderBy: [{ level: 'asc' }, { index: 'asc' }],
      select: { id: true, level: true, title: true },
    }),
    prisma.missionCompletion.findMany({
      where: { discordId: targetDiscordId },
      select: {
        id: true,
        missionId: true,
        status: true,
        events: { where: { via: MANUAL_VIA, action: { in: ['APPROVED', 'RELEASED'] } }, select: { id: true }, take: 1 },
      },
    }),
  ])
  const byMission = new Map((completions ?? []).map((c) => [c.missionId, c]))
  return (missions ?? [])
    .filter((m) => scope(m.level))
    .map((m) => {
      const c = byMission.get(m.id)
      return {
        missionId: m.id,
        level: m.level,
        title: m.title,
        status: (c ? c.status : 'NOT_SUBMITTED') as PanelStatus,
        manual: !!c && c.status === 'APPROVED' && (c.events?.length ?? 0) > 0,
      }
    })
}

export interface ManualApproveResult {
  alreadyApproved: boolean
  completionId: number
  discordId: string
  levelsPaid: number[]
}

/**
 * Approve `missionId` for `targetDiscordId`. Permission is re-checked here. Idempotent: an already
 * approved mission is a no-op (nothing written, nothing paid). A missing row is created PENDING and
 * a REJECTED one reopened (both audited), then approveMission does the approval.
 */
export async function manualApproveMission(input: {
  reviewerId: string
  targetDiscordId: string
  missionId: number
  note: string
}): Promise<ManualApproveResult> {
  const { reviewerId, targetDiscordId, missionId } = input
  const note = (input.note ?? '').trim()
  if (note.length < MIN_NOTE) throw new ValidationError('A note is required: say why this is being marked complete')
  if (note.length > MAX_NOTE) throw new ValidationError(`Note must be ${MAX_NOTE} characters or fewer`)

  const mission = await prisma.mission.findFirst({
    where: { id: missionId, ...REQUIRED_MISSION_WHERE },
    select: { id: true, level: true },
  })
  if (!mission) throw new NotFoundError('Mission')
  await assertCanManualApprove(reviewerId, targetDiscordId, mission.level)

  const done = (completionId: number): ManualApproveResult => ({
    alreadyApproved: true,
    completionId,
    discordId: targetDiscordId,
    levelsPaid: [],
  })
  const find = () =>
    prisma.missionCompletion.findUnique({
      where: { missionId_discordId: { missionId, discordId: targetDiscordId } },
      select: { id: true, status: true },
    })

  let completion = await find()
  let created = false
  if (completion?.status === 'APPROVED') return done(completion.id)

  if (!completion) {
    const memberId = (await memberIdForDiscord(targetDiscordId)) ?? undefined
    try {
      completion = await prisma.$transaction(async (tx) => {
        const created = await tx.missionCompletion.create({
          data: { missionId, discordId: targetDiscordId, memberId, status: 'PENDING', source: 'MANUAL', reviewQueuedAt: new Date() },
          select: { id: true, status: true },
        })
        await recordReviewEvent(tx, {
          completionId: created.id,
          actorId: reviewerId,
          action: 'NOTE',
          via: MANUAL_VIA,
          note,
          metadata: { manualApproval: true, createdWithoutSubmission: true },
        })
        return created
      })
      created = true
    } catch (e) {
      // A concurrent manual approval created the row first: continue with it.
      if ((e as { code?: string })?.code !== 'P2002') throw e
      completion = await find()
      if (!completion) throw e
      if (completion.status === 'APPROVED') return done(completion.id)
    }
  } else if (completion.status === 'REJECTED') {
    const id = completion.id
    await prisma.$transaction(async (tx) => {
      const r = await tx.missionCompletion.updateMany({
        where: { id, status: 'REJECTED' },
        data: { status: 'PENDING', reviewQueuedAt: new Date() },
      })
      if (r.count === 1) {
        await recordReviewEvent(tx, {
          completionId: id,
          actorId: reviewerId,
          action: 'REOPENED',
          via: MANUAL_VIA,
          note,
          metadata: { manualApproval: true },
        })
      }
    })
  }

  try {
    const approved = await approveMission(reviewerId, completion.id, `Manual approval: ${note}`, MANUAL_VIA)
    return { alreadyApproved: false, completionId: completion.id, discordId: targetDiscordId, levelsPaid: approved.levelsPaid ?? [] }
  } catch (e) {
    // Approved by someone else between our read and the conditional update: same outcome, no second payout.
    if (e instanceof ConflictError) {
      const now = await prisma.missionCompletion.findUnique({ where: { id: completion.id }, select: { status: true } })
      if (now?.status === 'APPROVED') return done(completion.id)
    }
    // Don't leave an empty manual submission in the review queue if the approval itself failed.
    if (created) await discardEmptyManualRow(completion.id).catch(() => undefined)
    throw e
  }
}

/** Remove a row this request created (and its events) if it is still PENDING. */
async function discardEmptyManualRow(id: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if ((await tx.missionCompletion.count({ where: { id, status: 'PENDING' } })) !== 1) return
    await tx.missionReviewEvent.deleteMany({ where: { completionId: id } })
    await tx.missionCompletion.deleteMany({ where: { id, status: 'PENDING' } })
  })
}
