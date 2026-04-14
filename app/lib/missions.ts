import { prisma } from './db'
import { updateBalance } from './economy'
import { logTransaction } from './transactions'
import { createNotification } from './notifications'
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from './errors/api-errors'

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
 * Get the current level for a user (highest fully completed level + 1)
 */
export async function getCurrentLevel(discordId: string) {
  const completions = await prisma.missionCompletion.findMany({
    where: { discordId, status: 'APPROVED' },
    include: { mission: true },
  })

  const missions = await prisma.mission.findMany({
    where: { isActive: true },
    orderBy: [{ level: 'asc' }, { index: 'asc' }],
  })

  // Group missions by level
  const missionsByLevel: Record<number, number[]> = {}
  for (const m of missions) {
    if (!missionsByLevel[m.level]) missionsByLevel[m.level] = []
    missionsByLevel[m.level].push(m.id)
  }

  // Find highest completed level
  const completedMissionIds = new Set(completions.map(c => c.missionId))
  let highestCompleted = 0

  for (let level = 1; level <= 8; level++) {
    const levelMissions = missionsByLevel[level]
    if (!levelMissions || levelMissions.length === 0) continue

    const allComplete = levelMissions.every(id => completedMissionIds.has(id))
    if (allComplete) {
      highestCompleted = level
    } else {
      break
    }
  }

  return highestCompleted + 1
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

  if (existing) {
    throw new ConflictError('You have already submitted this mission')
  }

  // Check that previous levels are completed
  const currentLevel = await getCurrentLevel(discordId)
  if (mission.level > currentLevel) {
    throw new ValidationError(`You must complete Level ${currentLevel} before starting Level ${mission.level}`)
  }

  // Create the completion
  const status = mission.autoVerify ? 'APPROVED' : 'PENDING'
  const completion = await prisma.missionCompletion.create({
    data: {
      missionId,
      discordId,
      memberId,
      status,
      evidence: evidence || null,
      notes: notes || null,
      reviewedAt: mission.autoVerify ? new Date() : null,
      reviewedBy: mission.autoVerify ? 'auto' : null,
    },
    include: { mission: true },
  })

  // If auto-verified, check if the full level is now complete
  if (mission.autoVerify) {
    await checkAndAwardLevelReward(discordId, mission.level)
  }

  return completion
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

  const updated = await prisma.missionCompletion.update({
    where: { id: completionId },
    data: {
      status: 'APPROVED',
      reviewedBy: adminDiscordId,
      reviewNote: reviewNote || null,
      reviewedAt: new Date(),
    },
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

  const updated = await prisma.missionCompletion.update({
    where: { id: completionId },
    data: {
      status: 'REJECTED',
      reviewedBy: adminDiscordId,
      reviewNote: reviewNote || null,
      reviewedAt: new Date(),
    },
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
 * Check if all missions in a level are approved, and if so award the PEP reward
 */
export async function checkAndAwardLevelReward(discordId: string, level: number) {
  // Get all missions for this level
  const levelMissions = await prisma.mission.findMany({
    where: { level, isActive: true },
  })

  if (levelMissions.length === 0) return false

  // Get the user's approved completions for this level
  const approvedCompletions = await prisma.missionCompletion.findMany({
    where: {
      discordId,
      status: 'APPROVED',
      missionId: { in: levelMissions.map(m => m.id) },
    },
  })

  // Check if all missions in the level are completed
  if (approvedCompletions.length < levelMissions.length) return false

  // Get the reward amount (all missions in a level share the same reward)
  const reward = levelMissions[0].reward
  if (reward <= 0) return false

  // Check if reward was already given (prevent double-awarding)
  // We check for existing MISSION_REWARD transactions for this level
  const existingReward = await prisma.transaction.findFirst({
    where: {
      userId: discordId,
      type: 'MISSION_REWARD',
      description: { contains: `Level ${level}` },
    },
  })

  if (existingReward) return false

  // Award the PEP reward
  await updateBalance(discordId, reward)

  // Log the transaction
  const levelTitle = levelMissions[0].levelTitle
  const desc = levelTitle
    ? `Mission reward: Level ${level} - ${levelTitle}`
    : `Mission reward: Level ${level}`

  logTransaction(prisma, discordId, 'MISSION_REWARD', reward, desc, { level }).catch(() => {})

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
    levelTitle,
    totalMissions,
    approvedCount,
    currentLevelMissions: currentLevelMissions.length,
    currentLevelApproved,
  }
}

// ===== HELPERS =====

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}
