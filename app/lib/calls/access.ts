/**
 * Who may review call recordings.
 *
 * Today: Dread Pizza Roberts only (Snax, 2026-10-18), through isDreadPizzaRoberts, which is pinned to
 * the role id and does NOT follow the mission DPR-only level setting, so editing that setting never
 * changes who can publish calls. Fails closed on Discord lookup errors.
 *
 * Capo review (toggle calls.capoReviewEnabled, off by default): holders of the Pizza Capo role may also
 * act on DISCORD-source calls that are not held for the owner, but only for the actions in CAPO_ACTIONS.
 * Everything else stays owner-only. canReviewCalls and requireCallReviewer are unchanged and owner-only,
 * so every route that still uses them is exactly as before.
 */
import { NextResponse } from 'next/server'
import { holdsAny, isDreadPizzaRoberts, resolveRoles, type Reviewer } from '@/app/lib/mission-review-access'
import { requireSession, type GuardResult } from '@/app/lib/auth-guards'
import type { Session } from '@/app/lib/session'
import { CALL_CAPO_ROLE_IDS } from '@/app/ui/constants'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { prisma } from '@/app/lib/db'
import { loadPostFilter, type PostFilter } from '@/app/lib/calls/post-filters'
import { autoHoldReason, heldReason, type HoldView } from '@/app/lib/calls/hold-rules'

export function canReviewCalls(discordId: string): Promise<boolean> {
  return isDreadPizzaRoberts(discordId)
}

/** 401 without a session, 403 unless Dread Pizza Roberts. */
export async function requireCallReviewer(): Promise<GuardResult> {
  const auth = await requireSession()
  if (!auth.ok) return auth
  if (!(await canReviewCalls(auth.session.discordId))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// ---- Capo review ----

export type CallRole = 'owner' | 'capo'

/** What a reviewer can do on a call. */
export type CallAction =
  // capo-allowed
  | 'view'
  | 'publish'
  | 'unpublish'
  | 'editSummary'
  | 'regenerate'
  | 'hide'
  | 'hold'
  // owner-only
  | 'restore'
  | 'reject'
  | 'audio'
  | 'retryTranscription'
  | 'recapRepost'
  | 'followups'
  | 'bulk'
  | 'postFilters'
  | 'releaseHold'
  | 'admin'

export const CAPO_ACTIONS: ReadonlySet<CallAction> = new Set<CallAction>(['view', 'publish', 'unpublish', 'editSummary', 'regenerate', 'hide', 'hold'])

/**
 * The reviewer's role: 'owner' (Dread Pizza Roberts), 'capo' (Pizza Capo role while the toggle is on) or
 * null. Pass a Discord id (roles are looked up, failing closed) or the role ids from an interaction
 * payload. With the toggle off a capo is null, exactly as before.
 */
export async function callReviewRole(who: Reviewer): Promise<CallRole | null> {
  // Exactly the old check first; with the toggle off nothing else is looked up.
  if (await isDreadPizzaRoberts(who)) return 'owner'
  try {
    if (!(await toggleEnabled('calls.capoReviewEnabled'))) return null
    return (await holdsAny(await resolveRoles(who), CALL_CAPO_ROLE_IDS)) ? 'capo' : null
  } catch {
    return null // fail closed
  }
}

export type { HoldView, HeldReason } from '@/app/lib/calls/hold-rules'
export { autoHoldReason, heldReason }

/** Pure permission check. The owner may do anything; a capo only CAPO_ACTIONS on a DISCORD call that is not held. */
export function canActOnCall(role: CallRole | null, action: CallAction, rec: HoldView, filter: PostFilter | null): boolean {
  if (role === 'owner') return true
  if (role !== 'capo') return false
  if (!CAPO_ACTIONS.has(action)) return false
  if (rec.source !== 'DISCORD') return false
  // Only calls that are in review or published and already have a summary; never removed, recorded or processing ones.
  if (rec.status !== 'IN_REVIEW' && rec.status !== 'PUBLISHED') return false
  if (!rec.summary?.trim()) return false
  return heldReason(rec, filter) === null
}

/** The fields canActOnCall and the capo publish guard read. */
const ACCESS_SELECT = {
  id: true,
  source: true,
  status: true,
  reviewHoldAt: true,
  crewId: true,
  title: true,
  summary: true,
  actionItems: true,
  chapters: true,
  redactionsUpdatedAt: true,
  summaryGeneratedAt: true,
  summaryEditedAt: true,
  eventName: true,
  crewLabel: true,
  transcript: true,
  redactedSpeakerIds: true,
  redactedSegmentIds: true,
} as const

export type AccessRecording = {
  id: string
  source: string
  status: string
  reviewHoldAt: Date | null
  crewId: string | null
  title: string | null
  summary: string | null
  actionItems: unknown
  chapters: unknown
  redactionsUpdatedAt: Date | null
  summaryGeneratedAt: Date | null
  summaryEditedAt: Date | null
  eventName: string | null
  crewLabel: string | null
  transcript: unknown
  redactedSpeakerIds: string[]
  redactedSegmentIds: string[]
}

export type CallAccessResult =
  | { ok: true; session: Session; role: CallRole; rec: AccessRecording | null }
  | { ok: false; response: NextResponse }

/**
 * 401 without a session, 403 for anyone who is neither owner nor (with the toggle on) capo, 403 for a
 * capo on an owner-only action. For a capo the call is loaded and checked: a missing, imported or held
 * call is a 404, so its existence is not revealed. `rec` is only loaded for a capo (null for the owner,
 * whose routes do their own lookups exactly as before).
 */
export async function requireCallAccess(id: string, action: CallAction): Promise<CallAccessResult> {
  const auth = await requireSession()
  if (!auth.ok) return auth
  const forbidden = () => ({ ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
  const role = await callReviewRole(auth.session.discordId)
  if (!role) return forbidden()
  if (role === 'owner') return { ok: true, session: auth.session, role, rec: null }
  if (!CAPO_ACTIONS.has(action)) return forbidden()
  const rec = (await prisma.callRecording.findUnique({ where: { id }, select: ACCESS_SELECT })) as AccessRecording | null
  const filter = rec ? await loadPostFilter().catch(() => null) : null
  if (!rec || !canActOnCall(role, action, rec, filter)) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  return { ok: true, session: auth.session, role, rec }
}
