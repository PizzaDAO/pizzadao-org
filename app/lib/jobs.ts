import { prisma } from './db'
import { updateWallet } from './economy'

const JOB_REWARD_AMOUNT = parseInt(process.env.JOB_REWARD_AMOUNT || '50', 10)
const JOBS_SHEET_ID = process.env.JOBS_SHEET_ID
const DAILY_JOBS_COUNT = 3

export { JOB_REWARD_AMOUNT }

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
  return assignments.map(a => a.jobId)
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

  if (allJobs.length <= DAILY_JOBS_COUNT) {
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
  const dailyJobs = shuffled.slice(0, DAILY_JOBS_COUNT)

  return {
    jobs: dailyJobs,
    resetAt: getNextResetTime()
  }
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

  return jobs.map(job => ({
    id: job.id,
    description: job.description,
    type: job.type,
    assignees: job.assignments.map(a => a.userId)
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
export async function completeJob(userId: string, reward: number) {
  const assignment = await prisma.jobAssignment.findFirst({
    where: { userId },
    include: { job: true }
  })

  if (!assignment) {
    throw new Error('User does not have an active job')
  }

  // Remove the assignment
  await prisma.jobAssignment.delete({
    where: { id: assignment.id }
  })

  // Award the reward if > 0
  if (reward > 0) {
    await updateWallet(userId, reward)
  }

  return {
    success: true,
    job: assignment.job,
    reward
  }
}

// ===== Google Sheets Sync =====

interface SheetJob {
  type: string
  description: string
  rowIndex: number
}

/**
 * Fetch jobs from Google Sheets
 */
export async function fetchJobsFromSheet(): Promise<SheetJob[]> {
  if (!JOBS_SHEET_ID) {
    throw new Error('JOBS_SHEET_ID not configured')
  }

  // Use Google Sheets API via public CSV export
  const url = `https://docs.google.com/spreadsheets/d/${JOBS_SHEET_ID}/export?format=csv`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch jobs from Google Sheets')
  }

  const csv = await response.text()
  const lines = csv.split('\n').filter(line => line.trim())

  // Skip header row, parse Type and Prompt columns
  const jobs: SheetJob[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length >= 2 && cols[1]) {
      // Replace {amount} placeholder with configured reward
      const description = cols[1].replace(/{amount}/gi, JOB_REWARD_AMOUNT.toString())
      jobs.push({
        type: cols[0] || 'General',
        description,
        rowIndex: i + 1
      })
    }
  }

  return jobs
}

/**
 * Simple CSV line parser
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())

  return result
}

/**
 * Sync jobs from data array (from Google Apps Script webhook)
 */
export async function syncJobsFromData(jobs: Array<{ type: string; description: string; sheetRow?: number }>) {
  if (jobs.length === 0) {
    return { synced: 0, added: 0, updated: 0 }
  }

  // Get current jobs
  const currentJobs = await prisma.job.findMany()
  const currentByDescription = new Map(currentJobs.map(j => [j.description, j]))

  let added = 0
  let updated = 0
  const seenDescriptions = new Set<string>()

  // Add or update jobs
  for (const job of jobs) {
    const description = job.description.replace(/{amount}/gi, JOB_REWARD_AMOUNT.toString())
    seenDescriptions.add(description)

    const existing = currentByDescription.get(description)
    if (existing) {
      // Update if type changed or was inactive
      if (existing.type !== job.type || !existing.isActive) {
        await prisma.job.update({
          where: { id: existing.id },
          data: { type: job.type, sheetRow: job.sheetRow, isActive: true }
        })
        updated++
      }
    } else {
      // Add new job
      await prisma.job.create({
        data: {
          description,
          type: job.type || 'General',
          sheetRow: job.sheetRow,
          isActive: true
        }
      })
      added++
    }
  }

  // Deactivate jobs no longer in sheet (only if no assignments)
  let deactivated = 0
  for (const job of currentJobs) {
    if (job.isActive && !seenDescriptions.has(job.description)) {
      const hasAssignments = await prisma.jobAssignment.count({ where: { jobId: job.id } })
      if (hasAssignments === 0) {
        await prisma.job.update({
          where: { id: job.id },
          data: { isActive: false }
        })
        deactivated++
      }
    }
  }

  return { synced: jobs.length, added, updated, deactivated }
}

/**
 * Sync jobs from Google Sheets to database
 */
export async function syncJobsFromSheet() {
  const sheetJobs = await fetchJobsFromSheet()

  if (sheetJobs.length === 0) {
    return { synced: 0, added: 0 }
  }

  // Get current jobs
  const currentJobs = await prisma.job.findMany({
    where: { isActive: true }
  })

  const currentDescriptions = new Set(currentJobs.map(j => j.description))
  let added = 0

  // Add new jobs
  for (const job of sheetJobs) {
    if (!currentDescriptions.has(job.description)) {
      await prisma.job.create({
        data: {
          description: job.description,
          type: job.type,
          sheetRow: job.rowIndex,
          isActive: true
        }
      })
      added++
    }
  }

  return { synced: sheetJobs.length, added }
}

/**
 * Full refresh - deactivate jobs not in sheet, add new ones
 */
export async function fullRefreshJobs() {
  const sheetJobs = await fetchJobsFromSheet()
  const sheetDescriptions = new Set(sheetJobs.map(j => j.description))

  // Get all current jobs
  const currentJobs = await prisma.job.findMany({
    where: { isActive: true },
    include: { assignments: true }
  })

  let removed = 0

  // Deactivate jobs not in sheet (only if no active assignments)
  for (const job of currentJobs) {
    if (!sheetDescriptions.has(job.description) && job.assignments.length === 0) {
      await prisma.job.update({
        where: { id: job.id },
        data: { isActive: false }
      })
      removed++
    }
  }

  // Sync new jobs
  const { added } = await syncJobsFromSheet()

  return { synced: sheetJobs.length, added, removed }
}

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
