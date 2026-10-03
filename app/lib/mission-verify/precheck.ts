/**
 * Submit-time pre-checks for the semi-automatic missions (Phase 4).
 *
 *   precheckProof()   runs the mission's semi verifier on the submitted proof
 *                     (and fetches a link preview for reviewers, in parallel):
 *                       fail          -> `reject`: the submit route answers 400
 *                                        with the hint and writes NO row
 *                       needs_review  -> `checkResult` for the PENDING row
 *                       unknown/error -> `checkResult` saying it couldn't check
 *   storeCheckResult() writes it onto the PENDING completion (source SEMI),
 *                     conditional on the row still being PENDING.
 *
 * The result is what the review card ("Verifier saw") and the web panel show:
 *   { verifier, summary, confidence, checks: [{label, ok}], data, preview?, checkedAt }
 * Missions without a verifier (manual) only get the link preview.
 * Never approves anything.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { defaultSources } from './sources'
import { unfurlProof, type ProofPreview, type UnfurlDeps } from './unfurl'
import { getVerifier } from './verifiers'
import type { Confidence, SemiCheck, VerifierSources, VerifyCtx } from './types'

export interface SemiCheckResult {
  verifier: string | null
  summary: string
  confidence: Confidence | null
  checks: SemiCheck[]
  data: Record<string, unknown>
  preview?: ProofPreview
  checkedAt: string
}

export interface PrecheckOutcome {
  /** The proof is not the right kind of link: tell the member, write nothing. */
  reject?: { reason: string; hint?: string }
  /** For the PENDING row. */
  checkResult?: SemiCheckResult
}

export interface PrecheckInput {
  discordId: string
  memberId: string | null
  mission: { verifierKey: string | null; verifierParams: Prisma.JsonValue | null }
  evidence: string | null | undefined
  sources?: VerifierSources
  unfurl?: (url: string) => Promise<ProofPreview | null>
  unfurlDeps?: UnfurlDeps
  now?: Date
}

/** Whether a mission's proof is pre-checked on submit (semi) or only previewed (no verifier). */
export function isPrecheckedMission(verifierKey: string | null | undefined): boolean {
  return !verifierKey || getVerifier(verifierKey)?.mode === 'semi'
}

export async function precheckProof(input: PrecheckInput): Promise<PrecheckOutcome> {
  const now = input.now ?? new Date()
  const evidence = input.evidence?.trim() || null
  const v = getVerifier(input.mission.verifierKey)
  if (input.mission.verifierKey && v?.mode !== 'semi') return {}

  const unfurl = input.unfurl ?? ((url: string) => unfurlProof(url, input.unfurlDeps))
  const previewP = evidence && /^https:\/\//i.test(evidence) ? unfurl(evidence).catch(() => null) : Promise.resolve(null)

  // No verifier (a manual mission with a link): only the preview.
  if (!v) {
    const preview = await previewP
    if (!preview) return {}
    return { checkResult: { verifier: null, summary: 'Link preview', confidence: null, checks: [], data: {}, preview, checkedAt: now.toISOString() } }
  }

  let params: unknown
  try {
    params = v.parse(input.mission.verifierParams)
  } catch (e) {
    console.error(`[missions] bad verifierParams for ${v.key}:`, e)
    return {}
  }
  const ctx: VerifyCtx = {
    discordId: input.discordId,
    memberId: input.memberId,
    trigger: 'submit',
    now,
    evidence,
    sources: input.sources ?? defaultSources,
    memo: new Map(),
  }
  const [r, preview] = await Promise.all([
    v.check(ctx, params).catch((e: unknown) => ({ status: 'unknown' as const, reason: e instanceof Error ? e.message : String(e) })),
    previewP,
  ])

  if (r.status === 'fail') return { reject: { reason: r.reason, ...(r.hint ? { hint: r.hint } : {}) } }
  const base = { verifier: v.key, checkedAt: now.toISOString(), ...(preview ? { preview } : {}) }
  if (r.status === 'needs_review') {
    return { checkResult: { ...base, summary: r.summary, confidence: r.confidence, checks: r.checks, data: r.evidence } }
  }
  if (r.status === 'pass') {
    // Semi verifiers don't pass; treat a pass like an all-green review.
    return { checkResult: { ...base, summary: 'Checks passed', confidence: 'high', checks: [], data: r.evidence } }
  }
  return {
    checkResult: { ...base, summary: "Couldn't pre-check the proof", confidence: 'medium', checks: [{ label: `Pre-check unavailable (${r.reason})`, ok: null }], data: {} },
  }
}

/** Put the pre-check on the PENDING completion (source SEMI). Best effort; returns whether it was written. */
export async function storeCheckResult(completionId: number, checkResult: SemiCheckResult, verifierBacked: boolean): Promise<boolean> {
  try {
    const r = await prisma.missionCompletion.updateMany({
      where: { id: completionId, status: 'PENDING' },
      data: {
        checkResult: JSON.parse(JSON.stringify(checkResult)) as Prisma.InputJsonValue,
        ...(verifierBacked ? { source: 'SEMI' as const } : {}),
      },
    })
    return r.count === 1
  } catch (e) {
    console.error(`[missions] storing the pre-check of completion ${completionId} failed:`, e)
    return false
  }
}

/** "high" confidence pre-checks (every check green): eligible for bulk approve in the web panel. */
export function isAllGreen(checkResult: unknown): boolean {
  if (!checkResult || typeof checkResult !== 'object' || Array.isArray(checkResult)) return false
  const c = checkResult as { confidence?: unknown; checks?: unknown }
  return c.confidence === 'high' && Array.isArray(c.checks) && c.checks.length > 0
}
