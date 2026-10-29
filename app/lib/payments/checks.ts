/**
 * Runs the automated checks for one request and stores the result: loads the context, computes
 * the rule flags (rules.ts), merges flags from other check kinds, scores, picks the lane and saves
 * everything on the request plus a PaymentCheck snapshot of what the reviewer was shown.
 *
 * Runs on ingest, on every new attachment and from the reviewer's "Re-check" button. It never
 * approves, rejects or clears a flag, and it only touches requests still waiting for a decision.
 */
import { prisma } from '@/app/lib/db'
import { disavowEnabled } from '@/app/lib/disavow/constants'
import { identifierOr, identifiersForMember, viewerIdentifiers } from '@/app/lib/disavow/match'
import { snowflakeCreatedAt } from '@/app/lib/mission-verify/policy'
import { getSetting } from '@/app/lib/settings'
import { countApprovals, linkedDiscordIds } from './decide'
import { chooseLane } from './lane'
import { loadPaymentPolicy, type PaymentPolicy } from './policy'
import { signalsFor, type TrackSignals } from './signals'
import { computeRuleFlags, RULES_VERSION, scoreFlags, type RuleContext } from './rules'
import type { PaymentFlag, PaymentKind, PaymentLane } from './types'

const DAY = 86_400_000

export interface EvalDeps {
  now?: Date
  policy?: PaymentPolicy
  /** Fast-track and party-platform signals. Defaults to none (no fast lane). */
  signals?: (req: LoadedRequest, policy: PaymentPolicy) => Promise<TrackSignals>
}

export type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadRequest>>>

async function loadRequest(id: string) {
  return prisma.paymentRequest.findUnique({ where: { id }, include: { attachments: { select: { kind: true, sha256: true, createdAt: true } } } })
}

async function restrictedMatchesOne(discordId: string | null, memberId: string | null): Promise<string[]> {
  const identifiers = discordId ? await viewerIdentifiers(discordId) : await identifiersForMember(memberId as string)
  const hits = await prisma.disavowIdentifier.findMany({
    where: { OR: identifierOr(identifiers), disavowal: { status: { in: ['LISTED', 'SUSPENDED'] } } } as never,
    select: { disavowalId: true },
  })
  return hits.map((h: { disavowalId: string }) => h.disavowalId)
}

/** Checks the requester AND every linked account against the restricted list. */
async function restrictedMatches(discordIds: string[], memberId: string | null): Promise<{ ids: string[]; failed: boolean; off: boolean }> {
  if (!disavowEnabled()) return { ids: [], failed: false, off: true }
  const subjects: Array<[string | null, string | null]> = discordIds.slice(0, 6).map((d) => [d, null])
  if (subjects.length === 0 && memberId) subjects.push([null, memberId])
  try {
    const all = await Promise.all(subjects.map(([d, m]) => restrictedMatchesOne(d, m)))
    return { ids: [...new Set(all.flat())], failed: false, off: false }
  } catch {
    return { ids: [], failed: true, off: false }
  }
}

/** Flags that come from checks other than the rules (rsv.pizza, AI): kept across a re-check. */
export function carriedFlags(checks: Array<{ kind: string; result: unknown }>): PaymentFlag[] {
  // The latest SUCCESSFUL run: a failed run (stored with an error and no flags) must not hide earlier flags.
  const latestAi = checks.find((c) => c.kind === 'AI_RECEIPT' && !(c.result as { error?: unknown } | null)?.error && !(c.result as { pending?: unknown } | null)?.pending)
  const flags = (latestAi?.result as { flags?: unknown } | undefined)?.flags
  return Array.isArray(flags) ? (flags as PaymentFlag[]).filter((f) => f.source === 'ai' && f.severity !== 'high') : []
}

export interface EvalResult {
  lane: PaymentLane
  riskScore: number
  flags: PaymentFlag[]
  approvalsNeeded: number
}

/** Lane plus the non-info flags (id and severity): what a reviewer's approval depended on. */
const signature = (lane: string, flags: readonly PaymentFlag[]) =>
  lane + '|' + flags.filter((f) => f.severity !== 'info').map((f) => `${f.id}:${f.severity}`).sort().join(',')

const asFlags = (v: unknown): PaymentFlag[] => (Array.isArray(v) ? (v as PaymentFlag[]) : [])

export async function evaluateRequest(id: string, deps: EvalDeps = {}): Promise<EvalResult | null> {
  const req = await loadRequest(id)
  if (!req) return null
  // APPROVED requests get their flags refreshed (shown again at "mark paid"); the lane and the approval
  // count are never touched after approval. Anything else that is decided is left alone.
  const approved = req.status === 'APPROVED'
  if (!approved && req.status !== 'RECEIVED' && req.status !== 'NEEDS_INFO') return null
  const now = deps.now ?? new Date()
  const policy = deps.policy ?? (await loadPaymentPolicy())

  // Risk lookups use the verified requester, or for a form row the id claimed on it (a claim can only
  // ADD flags to this request; it never grants anything).
  const identity = req.requesterDiscordId ?? req.claimedDiscordId
  const hashes = req.attachments.map((a: { sha256: string }) => a.sha256)
  const linked = identity ? await linkedDiscordIds(prisma as never, identity) : []
  const requesters = [identity, ...linked].filter((x): x is string => !!x)
  const byRequester = { OR: [{ requesterDiscordId: { in: requesters } }, { claimedDiscordId: { in: requesters } }] }

  const [reused, shared, fraud, restricted, newAccountDays, siblings, signals, aiChecks] = await Promise.all([
    hashes.length ? prisma.paymentAttachment.findFirst({ where: { sha256: { in: hashes }, requestId: { not: id } }, select: { id: true } }) : null,
    req.payeeHash
      ? prisma.paymentRequest.findFirst({
          where: { payeeHash: req.payeeHash, id: { not: id }, ...(identity ? { NOT: { OR: [{ requesterDiscordId: identity }, { claimedDiscordId: identity }] } } : {}) },
          select: { id: true },
        })
      : null,
    requesters.length ? prisma.paymentRequest.findFirst({ where: { rejectedAsFraud: true, ...byRequester }, select: { id: true } }) : null,
    restrictedMatches(requesters, req.requesterMemberId),
    getSetting('missions.newAccountDays'),
    identity
      ? prisma.paymentRequest.findMany({
          where: { ...byRequester, id: { not: id }, status: { notIn: ['REJECTED', 'WITHDRAWN'] }, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } },
          select: { amountUsdCents: true, createdAt: true },
        })
      : [],
    approved ? ({ rsvFlagged: false, fastEligible: false } as TrackSignals) : (deps.signals ?? signalsFor)(req, policy).catch((): TrackSignals => ({ rsvFlagged: false, fastEligible: false })),
    prisma.paymentCheck.findMany({ where: { requestId: id, kind: 'AI_RECEIPT' }, orderBy: { createdAt: 'desc' }, take: 5, select: { kind: true, result: true } }),
  ])

  const created = identity ? snowflakeCreatedAt(identity) : null
  const ctx: RuleContext = {
    now,
    policy,
    newAccountDays,
    req: {
      source: req.source as 'FORM' | 'APP' | 'REVIEWER',
      kind: req.kind as PaymentKind,
      amountUsdCents: req.amountUsdCents,
      currency: req.currency,
      eventDate: req.eventDate,
      createdAt: req.createdAt,
      rsvEventSlug: req.rsvEventSlug,
      title: req.title,
      proposalUrl: req.proposalUrl,
      requesterDiscordId: identity,
      requesterMemberId: req.requesterMemberId,
    },
    attachments: req.attachments,
    reusedAttachment: !!reused,
    sharedPayee: !!shared,
    priorFraud: !!fraud,
    restrictedMatches: restricted.ids,
    restrictedCheckFailed: restricted.failed,
    restrictedCheckOff: restricted.off,
    hashConfigured: !!process.env.PAYMENTS_HASH_SECRET?.trim(),
    rsvFlagged: signals.rsvFlagged,
    newAccount: created ? now.getTime() - created.getTime() < newAccountDays * DAY : null,
    siblings,
  }
  const ruleFlags = computeRuleFlags(ctx)
  const flags = [...ruleFlags, ...carriedFlags(aiChecks)]
  // AI flags are shown but never counted: they cannot push a request into HIGH_RISK.
  const riskScore = scoreFlags(ruleFlags)
  // A form row has no verified requester, so it can never be fast-tracked.
  const fastEligible = signals.fastEligible && req.source !== 'FORM' && !!req.requesterDiscordId
  const chosen = chooseLane({ amountUsd: req.amountUsdCents / 100, riskScore, flags, fastEligible }, policy)
  const lane = approved ? (req.lane as PaymentLane) : chosen.lane
  const approvalsNeeded = approved ? req.approvalsNeeded : chosen.approvalsNeeded

  const env = process.env.VERCEL_ENV ?? 'local'
  await prisma.$transaction(async (tx) => {
    if (!approved && signature(req.lane, asFlags(req.flags)) !== signature(lane, flags)) {
      // What the approvers saw is no longer true: their approvals no longer count.
      const prior = await tx.paymentDecision.findMany({
        where: { requestId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, actorDiscordId: true, actorIsDpr: true },
      })
      if (countApprovals(prior).actors.size > 0) {
        await tx.paymentDecision.create({
          data: {
            requestId: id, action: 'SYSTEM_RESET', actorDiscordId: 'system', actorIsDpr: false, lane, riskScoreAtAction: riskScore,
            flagsAtAction: flags as never, note: 'Flags or lane changed after approval: earlier approvals were reset.', deployEnv: env,
          },
        })
      }
    }
    await tx.paymentRequest.update({ where: { id }, data: { flags: flags as never, riskScore, lane, approvalsNeeded, checkedAt: now } })
    await tx.paymentCheck.create({ data: { requestId: id, kind: 'RULES', version: RULES_VERSION, result: { flags, riskScore, lane } as never } })
    for (const c of signals.checks ?? []) {
      await tx.paymentCheck.create({ data: { requestId: id, kind: c.kind, version: c.version, result: c.result as never } })
    }
  })
  return { lane, riskScore, flags, approvalsNeeded }
}
