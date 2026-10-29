/**
 * Review decisions for payment requests (plans/host-fast-track.md section 7, phase 2).
 *
 * `evaluateDecision` is a pure state machine: given the request, the decisions so far, the actor and
 * the policy it either rejects the action with a code, or says what the new status is. The database
 * part (`applyDecision`) runs it inside one transaction, appends a PaymentDecision row and moves
 * the status with an optimistic check on `updatedAt`, so two reviewers racing cannot both finalize.
 *
 * Rules pinned here (not settings):
 *  - nothing pays out: APPROVE only records "approved for payment"; MARK_PAID is a person's record;
 *  - a reviewer can never act on their own request (by Discord id or a linked account);
 *  - approvals are counted per distinct person since the last reset (info request, reject, reopen);
 *  - a risky request (HIGH_RISK, or a hard-block flag, or score at/above the high-risk score) is only
 *    APPROVED once enough distinct reviewers approved AND one of them is the top review role;
 *  - a restricted (disavow-list) flag can only be handled by the top review role;
 *  - decisions are append-only: this module has no update or delete of a decision row.
 */
import { prisma } from '@/app/lib/db'
import type { PaymentActor } from './access'
import { hashPayee } from './hash'
import { isHighRisk, requiredAyes } from './lane'
import type { PaymentPolicy } from './policy'
import { isSelf, type DecisionAction, type DecisionRow, type PaymentFlag, type PaymentLane, type PaymentStatus } from './types'

export interface RequestSnapshot {
  id: string
  status: PaymentStatus
  lane: PaymentLane
  riskScore: number
  flags: PaymentFlag[]
  approvalsNeeded: number
  /** The verified requester (null for a public-form row). */
  requesterDiscordId: string | null
  /** The id typed into a public form. Counts as "the requester" for the self-approval check. */
  claimedDiscordId?: string | null
  /** When the automated checks last ran, and when the newest file / the last approval arrived. */
  checkedAt?: Date | null
  /** What the last RULES check saw (attachments and approvals), and what is there now. */
  checkMarker?: CheckMarker | null
  currentMarker?: CheckMarker
  payeeHash?: string | null
  /** Reviewers who entered this request's dollar value: they cannot also approve it. */
  usdAmountSetBy?: string[]
  /** Other Discord accounts linked to the requester (shared wallet, etc.). */
  linkedDiscordIds: string[]
  proposalUrl: string | null
  amountUsdCents: number
  updatedAt: Date
}

export interface DecisionInput {
  action: DecisionAction
  note?: string
  /** Flag ids the reviewer ticked off (APPROVE). */
  ackFlagIds?: string[]
  /** VOTE_REQUIRED: the reviewer confirms the poll passed with this many ayes. */
  ayesConfirmed?: number
  checklist?: Record<string, boolean>
  proofRef?: string
  /** MARK_PAID: who the money was sent to. Only hashed and compared with the request; never stored. */
  paidTo?: string
  /** REJECT: the rejection is for fraud (counts against the requester's track record). */
  asFraud?: boolean
}

export type DecisionFailure = {
  ok: false
  status: 400 | 403 | 409
  code: string
  message: string
}

export interface DecisionSuccess {
  ok: true
  nextStatus: PaymentStatus
  rejectedAsFraud: boolean
  approvalsAfter: number
  /** When an APPROVE did not finalize: what is still missing. */
  awaiting?: 'more_approvals' | 'top_role'
  checklist: Record<string, unknown>
}

const fail = (status: DecisionFailure['status'], code: string, message: string): DecisionFailure => ({ ok: false, status, code, message })

const MAX_NOTE = 2000
const needsAck = (f: PaymentFlag) => f.severity !== 'info'

/** What a check looked at. A decision may only rely on a check that saw everything that is there now. */
export interface CheckMarker {
  /** `${count}:${newest createdAt ISO}` of the attachments. */
  attachments: string
  /** Total APPROVE decisions on the request. */
  approvals: number
}

export function attachmentMarker(list: ReadonlyArray<{ createdAt: Date }>): string {
  const newest = list.reduce((t: Date | null, a) => (!t || a.createdAt > t ? a.createdAt : t), null as Date | null)
  return `${list.length}:${newest ? newest.toISOString() : ''}`
}

/** Distinct approvers since the last reset. */
export function countApprovals(decisions: readonly Pick<DecisionRow, 'action' | 'actorDiscordId' | 'actorIsDpr'>[]): { actors: Set<string>; hasDpr: boolean } {
  let actors = new Set<string>()
  let hasDpr = false
  for (const d of decisions) {
    if (d.action === 'REOPEN' || d.action === 'REQUEST_INFO' || d.action === 'REJECT' || d.action === 'SYSTEM_RESET') {
      actors = new Set()
      hasDpr = false
    } else if (d.action === 'APPROVE') {
      actors.add(d.actorDiscordId)
      if (d.actorIsDpr) hasDpr = true
    }
  }
  return { actors, hasDpr }
}

/** A payment reference, not an account number: a tx hash or transfer id, with no digits-only or IBAN-like values. */
export function validProofRef(v: string): boolean {
  const s = v.trim()
  if (s.length < 6 || s.length > 200) return false
  if (/^\d{8,20}$/.test(s.replace(/[\s-]/g, ''))) return false
  if (/^[a-z]{2}\d{2}[a-z0-9]{10,30}$/i.test(s.replace(/\s/g, ''))) return false
  return true
}

const REVIEWER_ACTIONS = new Set<DecisionAction>(['APPROVE', 'REJECT', 'REQUEST_INFO', 'MARK_PAID', 'REOPEN', 'NOTE'])
const SELF_BLOCKED = new Set<DecisionAction>(['APPROVE', 'REJECT', 'REQUEST_INFO', 'MARK_PAID', 'REOPEN', 'NOTE'])

export function evaluateDecision(
  req: RequestSnapshot,
  decisions: readonly Pick<DecisionRow, 'action' | 'actorDiscordId' | 'actorIsDpr'>[],
  actor: PaymentActor,
  input: DecisionInput,
  policy: PaymentPolicy,
  env: NodeJS.ProcessEnv = process.env,
): DecisionSuccess | DecisionFailure {
  const { action } = input
  const note = (input.note ?? '').trim()
  if (note.length > MAX_NOTE) return fail(400, 'note_too_long', 'Note is too long')
  const checklist: Record<string, unknown> = { ...(input.checklist ?? {}) }

  // ---- who ----
  const requester = actor.discordId !== '' && actor.discordId === req.requesterDiscordId
  if (action === 'WITHDRAW' || action === 'REPLY') {
    if (!requester) return fail(403, 'not_requester', 'Only the requester can do that')
  } else if (!REVIEWER_ACTIONS.has(action)) {
    return fail(400, 'unknown_action', 'Unknown action')
  } else {
    if (!actor.canReview) return fail(403, 'forbidden', 'Not allowed')
    if (SELF_BLOCKED.has(action) && isSelf(actor.discordId, [req.requesterDiscordId, req.claimedDiscordId, ...req.linkedDiscordIds])) {
      return fail(403, 'self_review', 'You cannot act on your own request')
    }
    if (action === 'MARK_PAID' && !actor.canMarkPaid) return fail(403, 'forbidden', 'Only the top review role can mark a request paid')
    if (action === 'REOPEN' && !actor.isDpr) return fail(403, 'forbidden', 'Only the top review role can reopen a request')
  }

  const risky = isHighRisk(req.riskScore, req.flags, policy)
  const restricted = req.flags.some((f) => f.restricted)
  // Money only moves on a check that saw every file now on the request (and, to pay, every approval).
  // Compared by what the check recorded, not by wall-clock time, so clock differences cannot matter. A
  // new file also clears checkedAt in the same transaction that stores it.
  const checkCurrent = (forPay: boolean) =>
    !!req.checkedAt &&
    !!req.checkMarker &&
    !!req.currentMarker &&
    req.checkMarker.attachments === req.currentMarker.attachments &&
    (!forPay || req.checkMarker.approvals === req.currentMarker.approvals)

  switch (action) {
    case 'APPROVE': {
      if (req.status !== 'RECEIVED') return fail(409, 'bad_state', 'This request is not waiting for review')
      if (req.amountUsdCents <= 0) return fail(400, 'no_amount', 'The request has no amount')
      if (restricted && !actor.isDpr) return fail(403, 'restricted', 'Restricted: ask the top review role')
      if (req.usdAmountSetBy?.includes(actor.discordId)) return fail(403, 'self_review', 'You entered the dollar value, so someone else has to approve this request')
      if (!checkCurrent(false)) return fail(409, 'not_checked', 'The automated checks have not run on the latest version of this request. Re-check first.')
      if (req.flags.some((f) => f.id === 'restricted_check_failed')) return fail(409, 'check_failed', 'The restricted-list check could not run. Re-check before approving.')

      const open = req.flags.filter(needsAck)
      const acked = new Set(input.ackFlagIds ?? [])
      const missing = open.filter((f) => !acked.has(f.id))
      if (missing.length > 0) return fail(400, 'flags_not_acknowledged', `Tick off every flag first (${missing.map((f) => f.id).join(', ')})`)

      const heavyFlag = open.some((f) => f.severity === 'high' || f.severity === 'medium')
      const overCap = req.amountUsdCents / 100 > policy.onApprovalCapUsd
      if ((risky || overCap || heavyFlag || req.lane === 'HIGH_RISK' || req.lane === 'VOTE_REQUIRED') && note.length < 3) {
        return fail(400, 'note_required', 'A note is required for this request')
      }
      if (overCap) {
        if (!req.proposalUrl) return fail(400, 'proposal_missing', 'This amount needs a community proposal link')
        const need = requiredAyes(req.amountUsdCents / 100, policy)
        if (!input.checklist?.proposalPassed || !Number.isFinite(input.ayesConfirmed) || (input.ayesConfirmed as number) < need) {
          return fail(400, 'proposal_unconfirmed', `Confirm the poll passed with at least ${need} ayes`)
        }
        checklist.ayesConfirmed = input.ayesConfirmed
      }

      const prior = countApprovals(decisions)
      if (prior.actors.has(actor.discordId)) return fail(409, 'already_approved', 'You already approved this request')
      const actors = new Set(prior.actors).add(actor.discordId)
      const hasDpr = prior.hasDpr || actor.isDpr
      const needed = risky ? Math.max(req.approvalsNeeded, policy.highRiskApprovals) : req.approvalsNeeded
      checklist.ackFlagIds = [...acked]
      const enough = actors.size >= needed
      if (enough && (!risky || hasDpr)) {
        return { ok: true, nextStatus: 'APPROVED', rejectedAsFraud: false, approvalsAfter: actors.size, checklist }
      }
      return {
        ok: true,
        nextStatus: 'RECEIVED',
        rejectedAsFraud: false,
        approvalsAfter: actors.size,
        awaiting: enough ? 'top_role' : 'more_approvals',
        checklist,
      }
    }
    case 'REJECT': {
      if (req.status !== 'RECEIVED' && req.status !== 'NEEDS_INFO') return fail(409, 'bad_state', 'This request cannot be rejected now')
      if (restricted && !actor.isDpr) return fail(403, 'restricted', 'Restricted: ask the top review role')
      if (note.length < 3) return fail(400, 'note_required', 'A reason is required')
      return { ok: true, nextStatus: 'REJECTED', rejectedAsFraud: !!input.asFraud, approvalsAfter: 0, checklist }
    }
    case 'REQUEST_INFO': {
      if (req.status !== 'RECEIVED') return fail(409, 'bad_state', 'This request is not waiting for review')
      if (note.length < 3) return fail(400, 'note_required', 'Say what is needed')
      return { ok: true, nextStatus: 'NEEDS_INFO', rejectedAsFraud: false, approvalsAfter: 0, checklist }
    }
    case 'REPLY': {
      if (req.status !== 'NEEDS_INFO') return fail(409, 'bad_state', 'No information was requested')
      if (note.length < 1) return fail(400, 'note_required', 'Write a reply')
      return { ok: true, nextStatus: 'RECEIVED', rejectedAsFraud: false, approvalsAfter: 0, checklist }
    }
    case 'MARK_PAID': {
      if (req.status !== 'APPROVED') return fail(409, 'bad_state', 'Only an approved request can be marked paid')
      if (!checkCurrent(true)) {
        return fail(409, 'recheck_required', 'Re-check this request first: the checks must run after the approval, so you see today\'s flags.')
      }
      // Anything the checks found since approval must be looked at again before money is sent.
      const stillOpen = req.flags.filter(needsAck)
      const seen = new Set(input.ackFlagIds ?? [])
      const unseen = stillOpen.filter((f) => !seen.has(f.id))
      if (unseen.length > 0) return fail(400, 'flags_not_acknowledged', `Tick off every flag first (${unseen.map((f) => f.id).join(', ')})`)
      if (stillOpen.some((f) => f.severity === 'high' || f.severity === 'medium') && note.length < 3) return fail(400, 'note_required', 'A note is required while flags are open')
      if (restricted && !actor.isDpr) return fail(403, 'restricted', 'Restricted: ask the top review role')
      if (req.flags.some((f) => f.id === 'restricted_check_failed')) return fail(409, 'check_failed', 'The restricted-list check could not run. Re-check before paying.')
      checklist.ackFlagIds = [...seen]
      if (req.payeeHash) {
        if (!input.paidTo?.trim()) return fail(400, 'paid_to_required', 'Enter the wallet or account you paid, so it can be compared with the request (it is not stored)')
        const given = hashPayee(input.paidTo, env)
        if (!given) return fail(409, 'payee_unverifiable', 'The payee cannot be compared right now (hash secret not set)')
        if (given !== req.payeeHash) return fail(409, 'payee_mismatch', 'What you paid does not match the payee on the request')
        checklist.payeeChecked = 'match'
      } else {
        checklist.payeeChecked = 'not_stored'
      }
      if (!input.proofRef || !validProofRef(input.proofRef)) {
        return fail(400, 'proof_required', 'Add a payment reference (transaction hash or transfer id, never an account number)')
      }
      return { ok: true, nextStatus: 'PAID', rejectedAsFraud: false, approvalsAfter: 0, checklist }
    }
    case 'REOPEN': {
      if (req.status === 'PAID' || req.status === 'RECEIVED') return fail(409, 'bad_state', 'This request cannot be reopened')
      if (note.length < 3) return fail(400, 'note_required', 'A reason is required')
      return { ok: true, nextStatus: 'RECEIVED', rejectedAsFraud: false, approvalsAfter: 0, checklist }
    }
    case 'WITHDRAW': {
      if (req.status !== 'RECEIVED' && req.status !== 'NEEDS_INFO') return fail(409, 'bad_state', 'This request can no longer be withdrawn')
      return { ok: true, nextStatus: 'WITHDRAWN', rejectedAsFraud: false, approvalsAfter: 0, checklist }
    }
    case 'SYSTEM_RESET':
      return fail(400, 'unknown_action', 'Unknown action')
    case 'NOTE': {
      if (note.length < 1) return fail(400, 'note_required', 'Write a note')
      return { ok: true, nextStatus: req.status, rejectedAsFraud: false, approvalsAfter: countApprovals(decisions).actors.size, checklist }
    }
  }
}

/** Resets approvals when a REJECT sets the flag; keeps the previous fraud mark otherwise. */
export interface ApplyResult {
  result: DecisionSuccess | DecisionFailure
  status?: PaymentStatus
}

/**
 * Load, evaluate and record one decision atomically. `expectedUpdatedAt` (ISO) is the version the
 * reviewer's screen showed; a mismatch is a 409 so nobody approves flags they did not see.
 */
export async function applyDecision(
  requestId: string,
  actor: PaymentActor,
  input: DecisionInput,
  policy: PaymentPolicy,
  opts: { expectedUpdatedAt?: string | null; env?: NodeJS.ProcessEnv } = {},
): Promise<DecisionSuccess | DecisionFailure | { ok: false; status: 404; code: 'not_found'; message: string }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.paymentRequest.findUnique({
      where: { id: requestId },
      include: {
        decisions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        attachments: { select: { createdAt: true } },
        checks: { where: { kind: 'RULES' }, orderBy: { id: 'desc' }, take: 1, select: { result: true } },
      },
    })
    if (!row) return { ok: false as const, status: 404 as const, code: 'not_found' as const, message: 'Not found' }
    if (opts.expectedUpdatedAt && opts.expectedUpdatedAt !== row.updatedAt.toISOString()) {
      return fail(409, 'conflict', 'This request changed since you opened it. Reload and try again.')
    }
    const flags = (Array.isArray(row.flags) ? row.flags : []) as unknown as PaymentFlag[]
    const linked = row.requesterDiscordId ? await linkedDiscordIds(tx, row.requesterDiscordId) : []
    const decisions = row.decisions as unknown as DecisionRow[]
    const seen = (row.checks?.[0]?.result as { marker?: CheckMarker } | undefined)?.marker
    const snap: RequestSnapshot = {
      checkedAt: row.checkedAt,
      checkMarker: seen && typeof seen.attachments === 'string' && typeof seen.approvals === 'number' ? seen : null,
      currentMarker: { attachments: attachmentMarker(row.attachments ?? []), approvals: decisions.filter((d) => d.action === 'APPROVE').length },
      payeeHash: row.payeeHash,
      usdAmountSetBy: (row.decisions as Array<{ checklist: unknown; actorDiscordId: string }>)
        .filter((d) => (d.checklist as { usdAmountSet?: unknown } | null)?.usdAmountSet !== undefined)
        .map((d) => d.actorDiscordId),
      claimedDiscordId: row.claimedDiscordId,
      id: row.id,
      status: row.status as PaymentStatus,
      lane: row.lane as PaymentLane,
      riskScore: row.riskScore,
      flags,
      approvalsNeeded: row.approvalsNeeded,
      requesterDiscordId: row.requesterDiscordId,
      linkedDiscordIds: linked,
      proposalUrl: row.proposalUrl,
      amountUsdCents: row.amountUsdCents,
      updatedAt: row.updatedAt,
    }
    const out = evaluateDecision(snap, decisions, actor, input, policy, opts.env ?? process.env)
    if (!out.ok) return out

    await tx.paymentDecision.create({
      data: {
        requestId: row.id,
        action: input.action,
        actorDiscordId: actor.discordId,
        actorIsDpr: actor.isDpr,
        lane: row.lane,
        riskScoreAtAction: row.riskScore,
        flagsAtAction: flags as never,
        checklist: out.checklist as never,
        note: input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null,
        proofRef: input.action === 'MARK_PAID' ? input.proofRef!.trim() : null,
        deployEnv: (opts.env ?? process.env).VERCEL_ENV ?? 'local',
      },
    })
    // Optimistic check: the update only lands if nobody changed the row since we read it.
    const moved = await tx.paymentRequest.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: {
        status: out.nextStatus,
        ...(input.action === 'REJECT' ? { rejectedAsFraud: out.rejectedAsFraud } : {}),
      },
    })
    if (moved.count !== 1) throw new ConflictError()
    return out
  }).catch((e) => {
    if (e instanceof ConflictError) return fail(409, 'conflict', 'Someone else just changed this request. Reload and try again.')
    throw e
  })
}

class ConflictError extends Error {}

/** Other Discord accounts known to share a signal (wallet, X, Telegram...) with this one. */
export async function linkedDiscordIds(
  db: { accountSignal: { findMany: (args: never) => Promise<Array<{ discordIds: string[] }>> } },
  discordId: string,
): Promise<string[]> {
  try {
    const rows = await db.accountSignal.findMany({ where: { discordIds: { has: discordId } }, select: { discordIds: true } } as never)
    return [...new Set(rows.flatMap((r) => r.discordIds).filter((id) => id !== discordId))]
  } catch {
    return []
  }
}

export type UsdAmountResult = { ok: true } | { ok: false; status: 400 | 403 | 404 | 409; code: string; message: string }

/**
 * A reviewer enters the dollar value of a request that arrived in another currency (stored with a
 * USD amount of 0, which blocks approval). Recorded as an append-only NOTE with the amounts and the
 * reviewer's reason; allowed only while the request is waiting for review and has no USD value yet.
 */
export async function setUsdAmount(
  requestId: string,
  actor: PaymentActor,
  input: { amountUsd: unknown; note?: string; expectedUpdatedAt?: string | null },
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<UsdAmountResult> {
  if (!actor.canReview) return { ok: false, status: 403, code: 'forbidden', message: 'Not allowed' }
  const n = typeof input.amountUsd === 'number' ? input.amountUsd : typeof input.amountUsd === 'string' ? Number(input.amountUsd.replace(/[$,\s]/g, '')) : NaN
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return { ok: false, status: 400, code: 'bad_amount', message: 'Enter a dollar amount' }
  const note = (input.note ?? '').trim().slice(0, MAX_NOTE)
  if (note.length < 3) return { ok: false, status: 400, code: 'note_required', message: 'Say where the dollar value comes from' }
  const cents = Math.round(n * 100)
  return prisma.$transaction(async (tx) => {
    const row = await tx.paymentRequest.findUnique({ where: { id: requestId } })
    if (!row) return { ok: false as const, status: 404 as const, code: 'not_found', message: 'Not found' }
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== row.updatedAt.toISOString()) return { ok: false as const, status: 409 as const, code: 'conflict', message: 'This request changed. Reload and try again.' }
    if (row.status !== 'RECEIVED' && row.status !== 'NEEDS_INFO') return { ok: false as const, status: 409 as const, code: 'bad_state', message: 'This request is not waiting for review' }
    if (row.amountUsdCents !== 0) return { ok: false as const, status: 409 as const, code: 'has_amount', message: 'This request already has a dollar value' }
    const linked = row.requesterDiscordId ? await linkedDiscordIds(tx, row.requesterDiscordId) : []
    if (isSelf(actor.discordId, [row.requesterDiscordId, row.claimedDiscordId, ...linked])) return { ok: false as const, status: 403 as const, code: 'self_review', message: 'You cannot act on your own request' }
    const flags = (Array.isArray(row.flags) ? row.flags : []) as unknown as PaymentFlag[]
    await tx.paymentDecision.create({
      data: {
        requestId: row.id, action: 'NOTE', actorDiscordId: actor.discordId, actorIsDpr: actor.isDpr, lane: row.lane, riskScoreAtAction: row.riskScore,
        flagsAtAction: flags as never, checklist: { usdAmountSet: cents / 100, originalCurrency: row.currency, original: row.amountOriginal === null ? null : Number(row.amountOriginal) } as never,
        note, deployEnv: (opts.env ?? process.env).VERCEL_ENV ?? 'local',
      },
    })
    const moved = await tx.paymentRequest.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { amountUsdCents: cents, checkedAt: null } })
    if (moved.count !== 1) throw new ConflictError()
    return { ok: true as const }
  }).catch((e) => {
    if (e instanceof ConflictError) return { ok: false as const, status: 409 as const, code: 'conflict', message: 'Someone else just changed this request. Reload and try again.' }
    throw e
  })
}
