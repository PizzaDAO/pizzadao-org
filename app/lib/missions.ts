import { prisma } from './db'
import { Prisma } from '@prisma/client'
import { creditInTx, getOrCreateEconomy, lockWallet } from './economy'
import { createNotification } from './notifications'
import { getMembersWithRoles } from './discord'
import { MISSION_REVIEWER_ROLE_IDS } from '../ui/constants'
import { DPR_ONLY_MIN_LEVEL, missionReviewerRoleIds } from './mission-review-access'
import { ValidationError, NotFoundError, ConflictError } from './errors/api-errors'

// ===== QUERIES =====

/**
 * Get all active missions grouped by level
 */
export async function getMissionsByLevel() {
  const missions = await prisma.mission.findMany({
    where: { isActive: true },
    orderBy: [{ level: 'asc' }, { index: 'asc' }],
  })

  // Group by level
  const grouped: Record<number, typeof missions> = {}
  for (const m of missions) {
    if (!grouped[m.level]) grouped[m.level] = []
    grouped[m.level].push(m)
  }

  return grouped
}

/**
 * Get a user's mission completion progress
 */
export async function getUserMissionProgress(discordId: string) {
  return prisma.missionCompletion.findMany({
    where: { discordId },
    include: { mission: true },
  })
}

/**
 * Levels whose reward this user has already been paid, from the
 * MISSION_REWARD ledger rows (the exactly-once marker). New rows carry
 * metadata.level; older rows only have it in the description.
 */
export async function getPaidLevels(discordId: string): Promise<Set<number>> {
  const rows = await prisma.transaction.findMany({
    where: { userId: discordId, type: 'MISSION_REWARD' },
    select: { metadata: true, description: true },
  })
  const levels = new Set<number>()
  for (const row of rows ?? []) {
    const level = paidLevelOf(row)
    if (level !== null) levels.add(level)
  }
  return levels
}

/** The level a MISSION_REWARD ledger row paid, or null if it can't be read. */
export function paidLevelOf(row: { metadata?: unknown; description?: string | null }): number | null {
  const meta = row.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const level = (meta as Record<string, unknown>).level
    if (typeof level === 'number' && Number.isInteger(level)) return level
  }
  const m = /^Mission reward: Level (\d+)(?: - |$)/.exec(row.description ?? '')
  return m ? Number(m[1]) : null
}

/**
 * Pure level computation: the highest level completed, in order, plus one.
 *
 * Data-driven: the levels are whatever levels the active missions use (no
 * hard-coded 8). A level counts as completed when every active mission in it
 * is approved OR its reward was already paid, so adding a mission to a level
 * a member already finished never drops them back a level (and the ledger
 * marker means it is never paid twice). Returns maxLevel + 1 when everything
 * is done ("MAX").
 */
export function computeCurrentLevel(
  missions: ReadonlyArray<{ id: number; level: number }>,
  approvedMissionIds: ReadonlySet<number>,
  paidLevels: ReadonlySet<number> = new Set(),
): number {
  const byLevel = new Map<number, number[]>()
  for (const m of missions) {
    const ids = byLevel.get(m.level) ?? []
    ids.push(m.id)
    byLevel.set(m.level, ids)
  }

  let highestCompleted = 0
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const done = paidLevels.has(level) || byLevel.get(level)!.every(id => approvedMissionIds.has(id))
    if (!done) break
    highestCompleted = level
  }
  return highestCompleted + 1
}

/** The highest level used by `missions` (0 when there are none). */
export function maxMissionLevel(missions: ReadonlyArray<{ level: number }>): number {
  return missions.reduce((max, m) => Math.max(max, m.level), 0)
}

/**
 * Get the current level for a user (highest fully completed level + 1).
 * See computeCurrentLevel for the rules.
 */
export async function getCurrentLevel(discordId: string) {
  const [completions, missions, paidLevels] = await Promise.all([
    prisma.missionCompletion.findMany({
      where: { discordId, status: 'APPROVED' },
      select: { missionId: true },
    }),
    prisma.mission.findMany({
      where: { isActive: true },
      select: { id: true, level: true },
    }),
    getPaidLevels(discordId),
  ])

  return computeCurrentLevel(missions ?? [], new Set((completions ?? []).map(c => c.missionId)), paidLevels)
}

/**
 * Get level title for a given level number
 */
export async function getLevelTitle(level: number): Promise<string | null> {
  const mission = await prisma.mission.findFirst({
    where: { level, levelTitle: { not: null } },
    select: { levelTitle: true },
  })
  return mission?.levelTitle ?? null
}

// ===== MUTATIONS =====

/**
 * Submit a mission completion
 */
export async function submitMissionCompletion(
  discordId: string,
  missionId: number,
  evidence?: string,
  notes?: string,
  memberId?: string
) {
  // Verify mission exists and is active
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
  })

  if (!mission) {
    throw new NotFoundError('Mission')
  }

  if (!mission.isActive) {
    throw new ValidationError('This mission is not currently active')
  }

  // Check if already submitted
  const existing = await prisma.missionCompletion.findUnique({
    where: { missionId_discordId: { missionId, discordId } },
  })

  // A REJECTED row can be resubmitted (same row, same unique key); anything
  // else (PENDING / APPROVED) is a duplicate.
  if (existing && existing.status !== 'REJECTED') {
    throw new ConflictError('You have already submitted this mission')
  }
  if (existing && splitReviewHistory(existing.notes).history.length + 1 >= MAX_MISSION_ATTEMPTS) {
    throw new ValidationError(
      `This mission has been rejected ${MAX_MISSION_ATTEMPTS} times. Ask a reviewer in Discord before trying again.`,
    )
  }

  // Check that previous levels are completed
  const currentLevel = await getCurrentLevel(discordId)
  if (mission.level > currentLevel) {
    throw new ValidationError(`You must complete Level ${currentLevel} before starting Level ${mission.level}`)
  }

  // Phase 0 (plans/mission-verification.md): nothing is approved on submit.
  // `autoVerify` missions (L1.0 follow on X, L3.0 #show-and-tell) used to be
  // approved with no check at all; until the Phase 1 verifiers exist they go
  // to PENDING for a human like every other mission. Approvals made before
  // this change are kept (decision D6).
  let completion
  if (existing) {
    completion = await resubmitRejected(existing, evidence, notes, memberId)
  } else {
    try {
      completion = await prisma.missionCompletion.create({
        data: {
          missionId,
          discordId,
          memberId,
          status: 'PENDING',
          evidence: evidence || null,
          notes: sanitizeMemberNotes(notes),
        },
        include: { mission: true },
      })
    } catch (e: unknown) {
      // A concurrent duplicate submission lost the @@unique([missionId, discordId]) race.
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictError('You have already submitted this mission')
      }
      throw e
    }
  }

  // Notify reviewers that a mission needs manual review
  notifyReviewers(discordId, mission.title, mission.level).catch(() => {})

  return completion
}

/**
 * Move a REJECTED completion back to PENDING with the new evidence. The
 * rejection (reviewer, time, note, old evidence) is appended to the row's
 * review history, kept in `notes` below a fixed marker (no schema change), and
 * the reviewer fields are cleared. Conditional on status = REJECTED, so of two
 * concurrent resubmits exactly one wins.
 */
async function resubmitRejected(
  existing: {
    id: number
    notes: string | null
    evidence: string | null
    reviewedBy: string | null
    reviewNote: string | null
    reviewedAt: Date | null
    memberId: string | null
  },
  evidence: string | undefined,
  notes: string | undefined,
  memberId: string | undefined,
) {
  const { history } = splitReviewHistory(existing.notes)
  const entry = formatRejection(history.length + 1, existing)
  const updated = await prisma.missionCompletion.updateMany({
    where: { id: existing.id, status: 'REJECTED' },
    data: {
      status: 'PENDING',
      evidence: evidence || null,
      notes: joinReviewHistory(sanitizeMemberNotes(notes), [...history, entry]),
      memberId: memberId ?? existing.memberId,
      submittedAt: new Date(),
      reviewedBy: null,
      reviewNote: null,
      reviewedAt: null,
    },
  })
  if (updated.count !== 1) {
    throw new ConflictError('You have already submitted this mission')
  }
  return prisma.missionCompletion.findUniqueOrThrow({
    where: { id: existing.id },
    include: { mission: true },
  })
}

// ----- review history (rejections), kept in MissionCompletion.notes -----

/** Submissions per mission, counting the first one (plan §5.1: cap of 3). */
export const MAX_MISSION_ATTEMPTS = 3

const REVIEW_HISTORY_MARKER = '--- Review history ---'
const NOTES_MAX = 1000

/** Member-entered notes, trimmed, capped, and unable to forge the history marker. */
function sanitizeMemberNotes(notes: string | undefined | null): string | null {
  if (typeof notes !== 'string') return null
  const clean = notes.split(REVIEW_HISTORY_MARKER).join('').trim().slice(0, NOTES_MAX)
  return clean || null
}

/** Split a completion's `notes` into the member's notes and the rejection history lines. */
export function splitReviewHistory(notes: string | null | undefined): { memberNotes: string | null; history: string[] } {
  if (!notes) return { memberNotes: null, history: [] }
  const at = notes.indexOf(REVIEW_HISTORY_MARKER)
  if (at === -1) return { memberNotes: notes.trim() || null, history: [] }
  const memberNotes = notes.slice(0, at).trim() || null
  const history = notes
    .slice(at + REVIEW_HISTORY_MARKER.length)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  return { memberNotes, history }
}

function joinReviewHistory(memberNotes: string | null, history: string[]): string | null {
  if (history.length === 0) return memberNotes
  return `${memberNotes ?? ''}\n\n${REVIEW_HISTORY_MARKER}\n${history.join('\n')}`.trimStart()
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 3) + '...' : flat
}

function formatRejection(
  attempt: number,
  row: { reviewedBy: string | null; reviewNote: string | null; reviewedAt: Date | null; evidence: string | null },
): string {
  const when = row.reviewedAt ? row.reviewedAt.toISOString() : 'unknown time'
  const parts = [`Attempt ${attempt} rejected ${when} by ${row.reviewedBy ?? 'unknown'}`]
  if (row.reviewNote) parts.push(`note: ${oneLine(row.reviewNote, 200)}`)
  if (row.evidence) parts.push(`evidence: ${oneLine(row.evidence, 300)}`)
  return parts.join(' | ')
}

/**
 * Admin: approve a mission completion
 */
export async function approveMission(
  adminDiscordId: string,
  completionId: number,
  reviewNote?: string
) {
  const completion = await prisma.missionCompletion.findUnique({
    where: { id: completionId },
    include: { mission: true },
  })

  if (!completion) {
    throw new NotFoundError('Mission completion')
  }

  if (completion.status !== 'PENDING') {
    throw new ConflictError('This submission has already been reviewed')
  }

  // Conditional PENDING -> APPROVED transition: of concurrent reviews of the
  // same submission exactly one wins.
  const reviewed = await prisma.missionCompletion.updateMany({
    where: { id: completionId, status: 'PENDING' },
    data: {
      status: 'APPROVED',
      reviewedBy: adminDiscordId,
      reviewNote: reviewNote || null,
      reviewedAt: new Date(),
    },
  })
  if (reviewed.count !== 1) {
    throw new ConflictError('This submission has already been reviewed')
  }
  const updated = await prisma.missionCompletion.findUniqueOrThrow({
    where: { id: completionId },
    include: { mission: true },
  })

  // Notify the user
  createNotification({
    type: 'MISSION_APPROVED',
    recipientId: completion.discordId,
    actorId: adminDiscordId,
    title: 'Mission Approved!',
    message: `Your mission "${truncate(completion.mission.title, 50)}" has been approved!`,
    metadata: { missionId: completion.missionId, completionId },
    linkUrl: '/missions',
  }).catch(() => {})

  // Check if the full level is now complete
  await checkAndAwardLevelReward(completion.discordId, completion.mission.level)

  return updated
}

/**
 * Admin: reject a mission completion
 */
export async function rejectMission(
  adminDiscordId: string,
  completionId: number,
  reviewNote?: string
) {
  const completion = await prisma.missionCompletion.findUnique({
    where: { id: completionId },
    include: { mission: true },
  })

  if (!completion) {
    throw new NotFoundError('Mission completion')
  }

  if (completion.status !== 'PENDING') {
    throw new ConflictError('This submission has already been reviewed')
  }

  // Conditional PENDING -> REJECTED transition: of concurrent reviews of the
  // same submission exactly one wins.
  const reviewed = await prisma.missionCompletion.updateMany({
    where: { id: completionId, status: 'PENDING' },
    data: {
      status: 'REJECTED',
      reviewedBy: adminDiscordId,
      reviewNote: reviewNote || null,
      reviewedAt: new Date(),
    },
  })
  if (reviewed.count !== 1) {
    throw new ConflictError('This submission has already been reviewed')
  }
  const updated = await prisma.missionCompletion.findUniqueOrThrow({
    where: { id: completionId },
    include: { mission: true },
  })

  // Notify the user
  createNotification({
    type: 'MISSION_REJECTED',
    recipientId: completion.discordId,
    actorId: adminDiscordId,
    title: 'Mission Rejected',
    message: `Your mission "${truncate(completion.mission.title, 50)}" was not approved.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
    metadata: { missionId: completion.missionId, completionId },
    linkUrl: '/missions',
  }).catch(() => {})

  return updated
}

/**
 * Ledger filter for "this user's level reward was already paid". New rows carry
 * metadata.level; older rows only have it in the description
 * ("Mission reward: Level 3" or "Mission reward: Level 3 - Title").
 */
function levelRewardWhere(discordId: string, level: number): Prisma.TransactionWhereInput {
  return {
    userId: discordId,
    type: 'MISSION_REWARD',
    OR: [
      { metadata: { path: ['level'], equals: level } },
      { description: `Mission reward: Level ${level}` },
      { description: { startsWith: `Mission reward: Level ${level} - ` } },
    ],
  }
}

/**
 * Check if all missions in a level are approved, and if so award the PEP reward.
 *
 * Runs in one DB transaction holding a row lock on the user's wallet, so the
 * "already paid?" check, the credit and the MISSION_REWARD ledger row (which
 * is the paid marker) are atomic per user: concurrent approvals / auto-verified
 * submissions can't pay the same level twice.
 */
export async function checkAndAwardLevelReward(discordId: string, level: number) {
  // Get all missions for this level
  const levelMissions = await prisma.mission.findMany({
    where: { level, isActive: true },
  })

  if (levelMissions.length === 0) return false

  // Get the reward amount (all missions in a level share the same reward)
  const reward = levelMissions[0].reward
  if (!Number.isInteger(reward) || reward <= 0) return false

  const levelTitle = levelMissions[0].levelTitle
  const desc = levelTitle
    ? `Mission reward: Level ${level} - ${levelTitle}`
    : `Mission reward: Level ${level}`

  await getOrCreateEconomy(discordId)

  const awarded = await prisma.$transaction(async (tx) => {
    await lockWallet(tx, discordId)

    // Check (under the lock) that every mission in the level is approved
    const approvedCount = await tx.missionCompletion.count({
      where: {
        discordId,
        status: 'APPROVED',
        missionId: { in: levelMissions.map(m => m.id) },
      },
    })
    if (approvedCount < levelMissions.length) return false

    // Check if reward was already given (prevent double-awarding)
    const existingReward = await tx.transaction.findFirst({ where: levelRewardWhere(discordId, level) })
    if (existingReward) return false

    await creditInTx(tx, discordId, reward, 'MISSION_REWARD', desc, { level })
    return true
  })

  if (!awarded) return false

  // Send level completion notification
  createNotification({
    type: 'LEVEL_COMPLETED',
    recipientId: discordId,
    title: 'Level Complete!',
    message: `You completed Level ${level}${levelTitle ? ` - ${levelTitle}` : ''} and earned ${reward.toLocaleString()} $PEP!`,
    metadata: { level, reward },
    linkUrl: '/missions',
  }).catch(() => {})

  return true
}

/** What a reviewer check needs about a completion: whose it is and its level. */
export async function getCompletionForReview(completionId: number) {
  const row = await prisma.missionCompletion.findUnique({
    where: { id: completionId },
    select: { discordId: true, status: true, mission: { select: { level: true } } },
  })
  return row ? { discordId: row.discordId, status: row.status, level: row.mission.level } : null
}

/**
 * Get pending mission submissions (for admin review)
 */
export async function getPendingSubmissions() {
  return prisma.missionCompletion.findMany({
    where: { status: 'PENDING' },
    include: { mission: true },
    orderBy: { submittedAt: 'asc' },
  })
}

/**
 * Get a user's mission progress summary for profiles
 */
export async function getUserProgressSummary(discordId: string) {
  const [completions, missions] = await Promise.all([
    prisma.missionCompletion.findMany({
      where: { discordId },
      include: { mission: true },
    }),
    prisma.mission.findMany({
      where: { isActive: true },
      orderBy: [{ level: 'asc' }, { index: 'asc' }],
    }),
  ])

  const currentLevel = await getCurrentLevel(discordId)
  const levelTitle = await getLevelTitle(currentLevel)

  // Calculate total missions and approved count
  const totalMissions = missions.length
  const approvedCount = completions.filter(c => c.status === 'APPROVED').length

  // Current level progress
  const currentLevelMissions = missions.filter(m => m.level === currentLevel)
  const currentLevelApproved = completions.filter(
    c => c.status === 'APPROVED' && c.mission.level === currentLevel
  ).length

  return {
    currentLevel,
    /** Highest level with an active mission; currentLevel > maxLevel means "MAX". */
    maxLevel: maxMissionLevel(missions),
    levelTitle,
    totalMissions,
    approvedCount,
    currentLevelMissions: currentLevelMissions.length,
    currentLevelApproved,
  }
}

// ===== HELPERS =====

/**
 * Notify the members who can review it that a mission needs review: the
 * MISSION_REVIEWER_ROLE_IDS holders, or only Dread Pizza Roberts for the
 * DPR-only levels (L8).
 */
async function notifyReviewers(submitterDiscordId: string, missionTitle: string, level: number) {
  const roleIds = level >= DPR_ONLY_MIN_LEVEL ? missionReviewerRoleIds(level) : MISSION_REVIEWER_ROLE_IDS
  const reviewerIds = await getMembersWithRoles(roleIds)

  await Promise.allSettled(
    reviewerIds
      .filter(id => id !== submitterDiscordId)
      .map(recipientId =>
        createNotification({
          type: 'MISSION_SUBMITTED',
          recipientId,
          actorId: submitterDiscordId,
          title: 'Mission Needs Review',
          message: `New submission for "${truncate(missionTitle, 50)}" needs approval.`,
          linkUrl: '/missions',
        })
      )
  )
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}
