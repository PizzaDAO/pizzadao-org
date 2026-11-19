// The default-PFP assignment job. Gives every member who would otherwise show the shared default
// picture their own dough ball: approved pool images first (random), then freshly generated ones.
// Also takes images away from members when the image was voted down, so they are given another.
//
// All I/O is behind `JobDeps` (see store.ts for the real one) so the logic is testable without a
// database, OpenAI or Blob. Uniqueness is enforced by `store.claim` (advisory lock plus the unique
// constraint on candidateId); a lost race just moves on to the next image.
import {
  generationAllowance,
  isAssignable,
  pickAutoTraits,
  buildAutoPrompt,
  type AutoTraits,
  type GenerateSettings,
  type GenerateUsage,
  type PoolCandidate,
  type VoteRules,
} from './rules'

export interface JobSettings {
  enabled: boolean
  rules: VoteRules
  recentActiveDays: number
  assignPerRun: number
  generate: GenerateSettings
}

export interface NeedyMember {
  memberId: string
  discordId: string | null
}

/** Thrown by `generateImage` when the image service declined the prompt (nothing was billed). */
export class GenerationRefused extends Error {}
/** Thrown by `generateImage` when the call may still have been billed (timeout, empty result). */
export class GenerationBilled extends Error {}

export interface JobDeps {
  settings: JobSettings
  now: () => Date
  rnd: () => number
  /** Do not start new generations after this time (epoch ms). */
  deadlineMs: number
  store: {
    /** Current assignments whose image is voted down by `rules`. */
    votedDownAssignments(rules: VoteRules): Promise<Array<{ memberId: string; candidateId: string }>>
    unassign(memberId: string, candidateId: string): Promise<boolean>
    /** Images in the dough-ball set with no assignment, with their vote tallies. */
    unassignedCandidates(): Promise<PoolCandidate[]>
    /** Non-merged members with no composed PFP and no assignment. Static art is filtered by the job. */
    needyMembers(): Promise<NeedyMember[]>
    /** Discord ids that logged in, joined a call or posted on Discord since `since`. */
    recentlyActive(since: Date): Promise<Set<string>>
    /** Assign atomically; false when the image or the member was taken meanwhile. */
    claim(memberId: string, candidateId: string, source: 'pool' | 'generated'): Promise<boolean>
    generationUsage(now: Date): Promise<GenerateUsage>
    /** Book one generation against the caps (under a lock). Null when a cap is reached. */
    reserveGeneration(s: GenerateSettings, now: Date): Promise<number | null>
    finishGeneration(id: number, status: 'ok' | 'error' | 'refused', patch: { costCents?: number; candidateId?: string }): Promise<void>
    approvedTraits(rules: VoteRules): Promise<Array<Record<string, unknown>>>
    createCandidate(args: { imageUrl: string; prompt: string; traits: AutoTraits }): Promise<{ id: string }>
  }
  hasStaticPfp: (memberId: string) => boolean
  generateImage: (prompt: string) => Promise<Buffer>
  uploadImage: (png: Buffer) => Promise<string>
  /** Called once per member whose assignment changed (cache invalidation). */
  invalidate: (memberId: string) => void
  /** Generations in flight at once. */
  concurrency?: number
}

export interface JobResult {
  skipped?: 'disabled'
  reassigned: number
  assignedFromPool: number
  generated: number
  assignedGenerated: number
  generateFailed: number
  stillNeedy: number
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const MAX_CONSECUTIVE_FAILURES = 3

export async function runDefaultPfpJob(deps: JobDeps, baseDescription: string): Promise<JobResult> {
  const { settings, store } = deps
  const result: JobResult = { reassigned: 0, assignedFromPool: 0, generated: 0, assignedGenerated: 0, generateFailed: 0, stillNeedy: 0 }
  if (!settings.enabled) return { ...result, skipped: 'disabled' }
  const now = deps.now()

  // 1. Members whose image was voted down lose it (and are handled like anyone else below).
  for (const a of await store.votedDownAssignments(settings.rules)) {
    if (await store.unassign(a.memberId, a.candidateId)) {
      result.reassigned++
      deps.invalidate(a.memberId)
    }
  }

  // 2. Who needs a picture: recently active first, then everyone else, random within each tier.
  const needyAll = (await store.needyMembers()).filter((m) => !deps.hasStaticPfp(m.memberId))
  const since = new Date(now.getTime() - settings.recentActiveDays * 24 * 3600 * 1000)
  const active = needyAll.length > 0 ? await store.recentlyActive(since) : new Set<string>()
  const isActive = (m: NeedyMember) => !!m.discordId && active.has(m.discordId)
  const queue = [
    ...shuffle(needyAll.filter(isActive), deps.rnd),
    ...shuffle(needyAll.filter((m) => !isActive(m)), deps.rnd),
  ].slice(0, settings.assignPerRun)

  // 3. Pool first.
  const pool = shuffle(
    (await store.unassignedCandidates()).filter((c) => isAssignable(c, settings.rules)),
    deps.rnd,
  )
  const waiting: NeedyMember[] = []
  for (const m of queue) {
    let done = false
    while (!done && pool.length > 0) {
      const c = pool.pop()!
      if (await store.claim(m.memberId, c.id, 'pool')) {
        result.assignedFromPool++
        deps.invalidate(m.memberId)
        done = true
      }
    }
    if (!done) waiting.push(m)
  }

  // 4. Pool exhausted: generate, within the per-run, daily and monthly caps.
  if (waiting.length > 0) {
    const usage = await store.generationUsage(now)
    let budget = generationAllowance(waiting.length, settings.generate, usage)
    const approved = budget > 0 ? await store.approvedTraits(settings.rules) : []
    let next = 0
    let consecutiveFailures = 0
    const workers = Array.from({ length: Math.max(1, Math.min(deps.concurrency ?? 3, budget || 1)) }, async () => {
      while (budget > 0 && next < waiting.length && consecutiveFailures < MAX_CONSECUTIVE_FAILURES && Date.now() < deps.deadlineMs) {
        budget--
        const member = waiting[next++]
        const id = await store.reserveGeneration(settings.generate, deps.now())
        if (id === null) {
          budget = 0 // a cap was reached since the check above (another run)
          return
        }
        try {
          const traits = pickAutoTraits(approved, deps.rnd)
          const prompt = buildAutoPrompt(baseDescription, traits)
          const png = await deps.generateImage(prompt)
          const imageUrl = await deps.uploadImage(png)
          const cand = await store.createCandidate({ imageUrl, prompt, traits })
          await store.finishGeneration(id, 'ok', { candidateId: cand.id })
          result.generated++
          consecutiveFailures = 0
          if (await store.claim(member.memberId, cand.id, 'generated')) {
            result.assignedGenerated++
            deps.invalidate(member.memberId)
          }
        } catch (e) {
          consecutiveFailures++
          result.generateFailed++
          if (e instanceof GenerationRefused) await store.finishGeneration(id, 'refused', { costCents: 0 }).catch(() => undefined)
          else if (e instanceof GenerationBilled) await store.finishGeneration(id, 'error', {}).catch(() => undefined)
          else await store.finishGeneration(id, 'error', { costCents: 0 }).catch(() => undefined)
        }
      }
    })
    await Promise.all(workers)
  }

  result.stillNeedy = Math.max(0, needyAll.length - result.assignedFromPool - result.assignedGenerated)
  return result
}
