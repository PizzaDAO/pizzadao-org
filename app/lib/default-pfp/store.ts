// Real (Prisma, OpenAI, Blob) dependencies for the default-PFP job. See job.ts for the logic.
import { put } from '@vercel/blob'
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { loadImageModels, isModelMissing } from '@/app/lib/ai-image-models'
import { hasStaticPfp } from '@/app/lib/pfp'
import { invalidateProfileSummary } from '@/app/lib/profile-summary-cache'
import { BASE_DESCRIPTION } from '@/scripts/image-review/dough-ball-prompts'
import { GenerationBilled, GenerationRefused, runDefaultPfpJob, type JobDeps, type JobResult, type JobSettings } from './job'
import {
  DOUGH_BALL_SET_SLUG,
  generationAllowance,
  isApproved,
  isAssignable,
  type GenerateSettings,
  type GenerateUsage,
  type VoteRules,
} from './rules'

const DOUGH_BALL_TITLE = 'Dough ball profile picture'
const DOUGH_BALL_DESCRIPTION = 'Does this dough-ball recruit fit as the default PizzaDAO profile picture? Vote yes or no and say why.'
const startOfUtcMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
const tally = (votes: Array<{ vote: 'YES' | 'NO' }>) => ({
  yes: votes.filter((v) => v.vote === 'YES').length,
  no: votes.filter((v) => v.vote === 'NO').length,
})

export async function loadJobSettings(): Promise<JobSettings> {
  const [enabled, minYesVotes, votedDownMargin, recentActiveDays, assignPerRun, perRun, dailyMax, monthlyBudgetUsd, costCents] = await Promise.all([
    toggleEnabled('defaultPfp.assignEnabled'),
    getSetting('defaultPfp.minYesVotes'),
    getSetting('defaultPfp.votedDownMargin'),
    getSetting('defaultPfp.recentActiveDays'),
    getSetting('defaultPfp.assignPerRun'),
    getSetting('defaultPfp.generatePerRun'),
    getSetting('defaultPfp.generateDailyMax'),
    getSetting('defaultPfp.generateMonthlyBudgetUsd'),
    getSetting('defaultPfp.generateCostCents'),
  ])
  return {
    enabled,
    rules: { minYesVotes, votedDownMargin },
    recentActiveDays,
    assignPerRun,
    generate: { perRun, dailyMax, monthlyBudgetUsd, costCents },
  }
}

async function usageIn(db: Pick<typeof prisma, 'defaultPfpGeneration'>, now: Date): Promise<GenerateUsage> {
  const [last24h, month] = await Promise.all([
    db.defaultPfpGeneration.count({ where: { costCents: { gt: 0 }, createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) } } }),
    db.defaultPfpGeneration.aggregate({ _sum: { costCents: true }, where: { createdAt: { gte: startOfUtcMonth(now) } } }),
  ])
  return { last24h, monthSpentCents: month._sum.costCents ?? 0 }
}

async function ensureSet(): Promise<{ id: string }> {
  return prisma.imageReviewSet.upsert({
    where: { slug: DOUGH_BALL_SET_SLUG },
    create: { slug: DOUGH_BALL_SET_SLUG, title: DOUGH_BALL_TITLE, description: DOUGH_BALL_DESCRIPTION },
    update: {},
    select: { id: true },
  })
}

export function prismaStore(): JobDeps['store'] {
  return {
    async votedDownAssignments(rules: VoteRules) {
      const rows = await prisma.defaultPfpAssignment.findMany({
        where: { candidate: { set: { slug: DOUGH_BALL_SET_SLUG } } },
        select: { memberId: true, candidateId: true, candidate: { select: { votes: { select: { vote: true } } } } },
      })
      const margin = Math.max(1, rules.votedDownMargin)
      return rows
        .filter((r) => {
          const t = tally(r.candidate.votes)
          return t.no - t.yes >= margin
        })
        .map((r) => ({ memberId: r.memberId, candidateId: r.candidateId }))
    },

    async unassign(memberId, candidateId) {
      const res = await prisma.defaultPfpAssignment.deleteMany({ where: { memberId, candidateId } })
      return res.count > 0
    },

    async unassignedCandidates() {
      const rows = await prisma.imageReviewCandidate.findMany({
        where: { set: { slug: DOUGH_BALL_SET_SLUG }, defaultPfpAssignment: null },
        select: { id: true, traits: true, votes: { select: { vote: true } } },
      })
      return rows.map((r) => ({ id: r.id, traits: r.traits, ...tally(r.votes) }))
    },

    async needyMembers() {
      const rows = await prisma.$queryRaw<Array<{ id: string; discordId: string | null }>>(Prisma.sql`
        SELECT m."id", m."discordId" FROM "Member" m
        WHERE m."mergedInto" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "MemberPfp" p WHERE p."memberId" = m."id" AND p."composedUrl" <> '')
          AND NOT EXISTS (SELECT 1 FROM "DefaultPfpAssignment" a WHERE a."memberId" = m."id")`)
      return rows.map((r) => ({ memberId: r.id, discordId: r.discordId }))
    },

    async recentlyActive(since) {
      const [calls, logins, discord] = await Promise.all([
        prisma.callAttendance.findMany({ where: { callDate: { gte: since } }, distinct: ['discordId'], select: { discordId: true } }),
        prisma.magicLoginToken.findMany({ where: { usedAt: { gte: since } }, distinct: ['discordId'], select: { discordId: true } }),
        prisma.discordActivity.findMany({ where: { lastSeen: { gte: since } }, select: { discordId: true } }),
      ])
      return new Set([...calls, ...logins, ...discord].map((r) => r.discordId))
    },

    async claim(memberId, candidateId, source) {
      try {
        return await prisma.$transaction(async (tx) => {
          // One global lock: assignments are cheap, and this makes the check-then-insert below atomic.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('default-pfp:assign'))`
          const [imageTaken, memberHas] = await Promise.all([
            tx.defaultPfpAssignment.findUnique({ where: { candidateId }, select: { memberId: true } }),
            tx.defaultPfpAssignment.findUnique({ where: { memberId }, select: { candidateId: true } }),
          ])
          if (imageTaken || memberHas) return false
          await tx.defaultPfpAssignment.create({ data: { memberId, candidateId, source } })
          return true
        })
      } catch (e) {
        // The unique constraint is the backstop (P2002), and a deleted candidate fails the FK (P2003).
        if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2002' || e.code === 'P2003')) return false
        throw e
      }
    },

    generationUsage: (now) => usageIn(prisma, now),

    async reserveGeneration(s: GenerateSettings, now: Date) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('default-pfp:budget'))`
        if (generationAllowance(1, s, await usageIn(tx, now)) < 1) return null
        const row = await tx.defaultPfpGeneration.create({ data: { status: 'pending', costCents: s.costCents } })
        return row.id
      })
    },

    async finishGeneration(id, status, patch) {
      await prisma.defaultPfpGeneration.update({ where: { id }, data: { status, ...patch } })
    },

    async approvedTraits(rules) {
      const rows = await prisma.imageReviewCandidate.findMany({
        where: { set: { slug: DOUGH_BALL_SET_SLUG } },
        select: { traits: true, votes: { select: { vote: true } } },
      })
      return rows
        .filter((r) => isApproved(tally(r.votes), rules))
        .map((r) => (r.traits && typeof r.traits === 'object' ? (r.traits as Record<string, unknown>) : {}))
    },

    async createCandidate({ imageUrl, prompt, traits }) {
      const set = await ensureSet()
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('default-pfp:position'))`
        const last = await tx.imageReviewCandidate.aggregate({ _max: { position: true }, where: { setId: set.id } })
        return tx.imageReviewCandidate.create({
          data: { setId: set.id, imageUrl, prompt, traits: { ...traits }, position: (last._max.position ?? -1) + 1 },
          select: { id: true },
        })
      })
    },
  }
}

/** One OpenAI image generation, trying each model in turn when an account does not have the first. */
export async function openAiGenerate(prompt: string, models: string[], opts: { fetchImpl?: typeof fetch; apiKey?: string; timeoutMs?: number } = {}): Promise<Buffer> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
  const f = opts.fetchImpl ?? fetch
  let lastErr: Error | null = null
  for (const model of models) {
    let res: Response
    try {
      res = await f('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size: '1024x1024', output_format: 'png', quality: 'medium', n: 1 }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      })
    } catch {
      throw new GenerationBilled('image request timed out') // it may still be billed
    }
    const body = (await res.json().catch(() => null)) as { data?: Array<{ b64_json?: string }>; error?: { code?: string | null; message?: string } } | null
    if (res.ok) {
      const b64 = body?.data?.[0]?.b64_json
      if (!b64) throw new GenerationBilled('empty image result')
      return Buffer.from(b64, 'base64')
    }
    const msg = body?.error?.message ?? 'image request failed'
    if ((res.status === 400 || res.status === 422) && (/moderation|content_policy|safety/i.test(body?.error?.code ?? '') || /safety system|moderation|content policy/i.test(msg))) {
      throw new GenerationRefused(msg)
    }
    lastErr = new Error(`HTTP ${res.status}: ${msg}`)
    if (!isModelMissing(msg)) throw lastErr
  }
  throw lastErr ?? new Error('no image models configured')
}

/** Run the job for real. */
export async function runDefaultPfpAssignment(opts: { budgetMs?: number } = {}): Promise<JobResult> {
  const settings = await loadJobSettings()
  if (!settings.enabled) return { skipped: 'disabled', reassigned: 0, assignedFromPool: 0, generated: 0, assignedGenerated: 0, generateFailed: 0, stillNeedy: 0 }
  const models = await loadImageModels()
  const deps: JobDeps = {
    settings,
    now: () => new Date(),
    rnd: Math.random,
    deadlineMs: Date.now() + (opts.budgetMs ?? 200_000),
    store: prismaStore(),
    hasStaticPfp,
    generateImage: (prompt) => openAiGenerate(prompt, models),
    uploadImage: async (png) => {
      const blob = await put(`image-review/${DOUGH_BALL_SET_SLUG}/auto.png`, png, { access: 'public', addRandomSuffix: true, contentType: 'image/png' })
      return blob.url
    },
    invalidate: (memberId) => invalidateProfileSummary(memberId),
  }
  return runDefaultPfpJob(deps, BASE_DESCRIPTION)
}

export interface DefaultPfpSummary {
  assigned: number
  assignedFromPool: number
  assignedGenerated: number
  poolRemaining: number
  generatedThisMonth: number
  spendCentsThisMonth: number
  budgetUsd: number
}

/** Owner-facing counts. */
export async function loadDefaultPfpSummary(now = new Date()): Promise<DefaultPfpSummary> {
  const settings = await loadJobSettings()
  const store = prismaStore()
  const [assigned, bySource, pool, usage, generated] = await Promise.all([
    prisma.defaultPfpAssignment.count(),
    prisma.defaultPfpAssignment.groupBy({ by: ['source'], _count: { _all: true } }),
    store.unassignedCandidates(),
    store.generationUsage(now),
    prisma.defaultPfpGeneration.count({ where: { status: 'ok', createdAt: { gte: startOfUtcMonth(now) } } }),
  ])
  const src = (s: string) => bySource.find((b) => b.source === s)?._count._all ?? 0
  return {
    assigned,
    assignedFromPool: src('pool'),
    assignedGenerated: src('generated'),
    poolRemaining: pool.filter((c) => isAssignable(c, settings.rules)).length,
    generatedThisMonth: generated,
    spendCentsThisMonth: usage.monthSpentCents,
    budgetUsd: settings.generate.monthlyBudgetUsd,
  }
}
