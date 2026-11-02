import { prisma } from './db'
import { creditInTx, getOrCreateEconomy } from './economy'
import { discordTextToPlainText } from './discord-markup'
import { resolveDiscordMentions } from './discord-mention-resolve'
import { loadSettings } from './settings'
import { effectiveInt, envNumber } from './settings/numbers'


/** PEP per completed daily job: setting economy.jobRewardAmount (env JOB_REWARD_AMOUNT is the legacy value, default 50). */
export async function getJobRewardAmount(): Promise<number> {
  return effectiveInt('economy.jobRewardAmount', await loadSettings(), envNumber(process.env.JOB_REWARD_AMOUNT))
}

/** Jobs offered per UTC day: setting economy.dailyJobsCount (default 3). */
export async function getDailyJobsCount(): Promise<number> {
  return effectiveInt('economy.dailyJobsCount', await loadSettings())
}

/**
 * Get the start of the current UTC day
 */
function getDayStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Get the start of the next UTC day (reset time)
 */
export function getNextResetTime(): Date {
  const dayStart = getDayStart()
  return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
}

/**
 * Check if user has completed a specific job today
 */
export async function hasCompletedJobToday(userId: string, jobId: number): Promise<boolean> {
  const dayStart = getDayStart()
  const assignment = await prisma.jobAssignment.findFirst({
    where: {
      userId,
      jobId,
      assignedAt: { gte: dayStart }
    }
  })
  return !!assignment
}

/**
 * Atomically record today's completion of a daily job and pay the reward.
 *
 * Idempotent per (user, job, UTC day) without a schema change: the existing
 * @@unique([jobId, userId]) row is either created (a concurrent duplicate
 * create hits the unique constraint) or conditionally moved forward from a
 * previous day (a concurrent duplicate update matches 0 rows). Only the
 * winner credits the wallet, inside the same transaction.
 *
 * Returns false if the job was already completed today.
 */
export async function recordDailyJobCompletion(
  userId: string,
  jobId: number,
  reward: number,
  description: string,
): Promise<boolean> {
  const dayStart = getDayStart()
  try {
    return await prisma.$transaction(async (tx) => {
      const moved = await tx.jobAssignment.updateMany({
        where: { jobId, userId, assignedAt: { lt: dayStart } },
        data: { assignedAt: new Date() },
      })
      if (moved.count !== 1) {
        const existing = await tx.jobAssignment.findUnique({
          where: { jobId_userId: { jobId, userId } },
        })
        if (existing) return false // already completed today
        await tx.jobAssignment.create({ data: { jobId, userId } })
      }

      await creditInTx(tx, userId, reward, 'JOB_REWARD', description, { jobId })
      return true
    })
  } catch (e: unknown) {
    // Concurrent first-ever completion lost the race on the unique constraint
    if ((e as { code?: string })?.code === 'P2002') return false
    throw e
  }
}

/**
 * Get all job IDs the user has completed today
 */
export async function getCompletedJobsToday(userId: string): Promise<number[]> {
  const dayStart = getDayStart()
  const assignments = await prisma.jobAssignment.findMany({
    where: {
      userId,
      assignedAt: { gte: dayStart }
    },
    select: { jobId: true }
  })
  return assignments.map((a: any) => a.jobId)
}

/**
 * Seeded random number generator for consistent daily selection
 */
function seededRandom(seed: number): () => number {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

/**
 * Shuffle array with seeded random
 */
function shuffleWithSeed<T>(array: T[], seed: number): T[] {
  const result = [...array]
  const random = seededRandom(seed)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Get daily random jobs (3 jobs, reset every 24 hours UTC)
 */
export async function getDailyJobs() {
  const allJobs = await getJobs()
  const dailyCount = await getDailyJobsCount()

  if (allJobs.length <= dailyCount) {
    return {
      jobs: allJobs,
      resetAt: getNextResetTime()
    }
  }

  // Use day timestamp as seed for consistent selection
  const dayStart = getDayStart()
  const seed = dayStart.getTime()

  // Shuffle and take first 3
  const shuffled = shuffleWithSeed(allJobs, seed)
  const dailyJobs = shuffled.slice(0, dailyCount)

  return {
    jobs: dailyJobs,
    resetAt: getNextResetTime()
  }
}

/**
 * Is this job one of today's daily jobs? Daily-job rewards are only for the
 * economy.dailyJobsCount jobs picked for the current UTC day, not every active job.
 */
export async function isTodaysDailyJob(jobId: number): Promise<boolean> {
  const { jobs } = await getDailyJobs()
  return jobs.some((j: { id: number }) => j.id === jobId)
}

/**
 * Get all jobs with their assignments
 */
export async function getJobs() {
  const jobs = await prisma.job.findMany({
    where: { isActive: true },
    include: {
      assignments: true
    },
    orderBy: { id: 'asc' }
  })

  return jobs.map((job: any) => ({
    id: job.id,
    description: job.description,
    type: job.type,
    assignees: job.assignments.map((a: any) => a.userId)
  }))
}

/**
 * Get a specific job by ID
 */
export async function getJob(jobId: number) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: { assignments: true }
  })
}

/**
 * Get user's current active job assignment
 */
export async function getUserJob(userId: string) {
  const assignment = await prisma.jobAssignment.findFirst({
    where: { userId },
    include: { job: true }
  })
  return assignment?.job || null
}

/**
 * Assign a specific job to a user
 */
export async function assignJob(userId: string, jobId: number) {
  // Check if user already has a job
  const existing = await getUserJob(userId)
  if (existing) {
    throw new Error('You already have an active job')
  }

  // Check if job exists and is active
  const job = await prisma.job.findUnique({
    where: { id: jobId }
  })

  if (!job || !job.isActive) {
    throw new Error('Job not found or inactive')
  }

  await prisma.jobAssignment.create({
    data: { jobId, userId }
  })

  return job
}

/**
 * Assign a random job using round-robin
 */
export async function assignRandomJob(userId: string) {
  // Check if user already has a job
  const existing = await getUserJob(userId)
  if (existing) {
    throw new Error('You already have an active job')
  }

  // Get all active jobs
  const jobs = await prisma.job.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' }
  })

  if (jobs.length === 0) {
    throw new Error('No jobs available')
  }

  // Get or create cycle tracker
  let cycle = await prisma.jobCycle.findUnique({
    where: { id: 1 }
  })

  if (!cycle) {
    cycle = await prisma.jobCycle.create({
      data: { id: 1, currentIndex: 0 }
    })
  }

  // Get next job in round-robin
  const jobIndex = cycle.currentIndex % jobs.length
  const job = jobs[jobIndex]

  // Update cycle index
  await prisma.jobCycle.update({
    where: { id: 1 },
    data: { currentIndex: (cycle.currentIndex + 1) % jobs.length }
  })

  // Assign the job
  await prisma.jobAssignment.create({
    data: { jobId: job.id, userId }
  })

  return job
}

/**
 * Quit current job (no reward)
 */
export async function quitJob(userId: string) {
  const assignment = await prisma.jobAssignment.findFirst({
    where: { userId }
  })

  if (!assignment) {
    throw new Error('You do not have an active job')
  }

  await prisma.jobAssignment.delete({
    where: { id: assignment.id }
  })

  return { success: true }
}

/**
 * Complete a job and award reward (admin function)
 */
export async function completeJob(userId: string, reward: number, grantedBy?: string) {
  const assignment = await prisma.jobAssignment.findFirst({
    where: { userId },
    include: { job: true }
  })

  if (!assignment) {
    throw new Error('User does not have an active job')
  }

  if (reward > 0) await getOrCreateEconomy(userId)

  // Resolve any <#channelId> / <@&roleId> Discord mentions in the job
  // description so the ledger memo stores plain text, not raw markup
  // (resolveDiscordMentions never throws — a failed Discord lookup just
  // means the memo falls back to "#channel"/"@role" instead of a name).
  // keepTimestamps: true — a <t:...> tag shouldn't be frozen to today's
  // formatted date/relative string at write time; keep it raw so
  // display-time rendering (DiscordText) formats it fresh.
  const { channels, roles } = await resolveDiscordMentions([assignment.job.description])
  const plainDescription = discordTextToPlainText(assignment.job.description, { channels, roles }, { keepTimestamps: true })

  // Remove the assignment and pay the reward (with its ledger row) in one DB
  // transaction. The delete is conditional, so concurrent completions of the
  // same assignment pay at most once.
  await prisma.$transaction(async (tx) => {
    const removed = await tx.jobAssignment.deleteMany({
      where: { id: assignment.id }
    })
    if (removed.count !== 1) {
      throw new Error('User does not have an active job')
    }
    if (reward > 0) {
      await creditInTx(tx, userId, reward, 'JOB_REWARD', `Job reward: ${plainDescription}`, { jobId: assignment.job.id, ...(grantedBy ? { grantedBy } : {}) })
    }
  })

  return {
    success: true,
    job: assignment.job,
    reward
  }
}

// The Jobs Google Sheet sync was removed in the Sheets cutover (plans/sheets-cutover.md): the sheet
// was unused, and the Job table is the only list of jobs.

// ===== Admin Functions =====

/**
 * Manually add a job (admin only)
 */
export async function addJob(description: string, type?: string) {
  return prisma.job.create({
    data: {
      description,
      type,
      isActive: true
    }
  })
}

/**
 * Remove a job (admin only)
 */
export async function removeJob(jobId: number) {
  return prisma.job.update({
    where: { id: jobId },
    data: { isActive: false }
  })
}
