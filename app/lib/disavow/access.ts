/**
 * Who may see or use the disavow list (plans/disavow-list.md, Snax 2026-10-26):
 * level 5+ or Dread Pizza Roberts. Anyone named on the list (nominated, listed
 * or suspended) is locked out, whatever their level. Everyone who is not
 * allowed gets a 404 with no body that hints the feature exists, and the same
 * 404 when DISAVOW_ENABLED is off. Every check runs per request (no cached
 * grant), and every lookup failure fails closed.
 */
import { NextResponse } from 'next/server'
import { notFound } from 'next/navigation'
import { prisma } from '@/app/lib/db'
import { getSession, type Session } from '@/app/lib/session'
import { getCurrentLevel } from '@/app/lib/missions'
import { canReviewMission, DPR_ONLY_MIN_LEVEL } from '@/app/lib/mission-review-access'
import { findMemberByDiscordId } from '@/app/lib/member-utils'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { DISAVOW_MIN_LEVEL, disavowEnabled } from './constants'

/** Statuses in which a person is "on the list" for access purposes. */
const SUBJECT_STATUSES = ['NOMINATED', 'LISTED', 'SUSPENDED'] as const

export function isDisavowDPR(discordId: string): Promise<boolean> {
  return canReviewMission(discordId, DPR_ONLY_MIN_LEVEL).catch(() => false)
}

async function subjectWhere(discordId: string, statuses: readonly string[]) {
  const member = await findMemberByDiscordId(discordId).catch(() => null)
  const or: Array<{ kind: 'DISCORD_ID' | 'MEMBER_ID'; value: string }> = [{ kind: 'DISCORD_ID', value: discordId }]
  if (member?.memberId) or.push({ kind: 'MEMBER_ID', value: String(member.memberId) })
  return { OR: or, disavowal: { status: { in: [...statuses] } } }
}

/** Whether this person is named on a nomination or listing. Throws on DB errors. */
export async function isDisavowSubject(discordId: string): Promise<boolean> {
  const hit = await prisma.disavowIdentifier.findFirst({
    where: (await subjectWhere(discordId, SUBJECT_STATUSES)) as never,
    select: { id: true },
  })
  return !!hit
}

/** The viewer's own LISTED/SUSPENDED entry (the only thing a subject can reach). */
export async function findSubjectDisavowal(discordId: string) {
  if (!disavowEnabled()) return null
  try {
    const hit = await prisma.disavowIdentifier.findFirst({
      where: (await subjectWhere(discordId, ['LISTED', 'SUSPENDED'])) as never,
      select: { disavowalId: true },
    })
    if (!hit) return null
    return await prisma.disavowal.findUnique({
      where: { id: hit.disavowalId },
      select: {
        id: true, status: true, displayName: true, reason: true, statement: true, evidenceUrls: true,
        subjectResponse: true, respondedAt: true, listedAt: true, reviewDueAt: true, lastAppealAt: true,
        rounds: { where: { state: 'OPEN' }, select: { id: true } },
      },
    })
  } catch {
    return null
  }
}

export interface DisavowViewer {
  allowed: boolean
  isDPR: boolean
}
const DENIED: DisavowViewer = { allowed: false, isDPR: false }

/** Single source of truth for "may this person see/nominate". Fails closed. */
export async function disavowViewer(discordId: string): Promise<DisavowViewer> {
  if (!disavowEnabled() || !discordId) return DENIED
  try {
    const [subject, dpr, level] = await Promise.all([
      isDisavowSubject(discordId),
      isDisavowDPR(discordId),
      getCurrentLevel(discordId).catch(() => 0),
    ])
    if (subject) return DENIED
    return { allowed: dpr || level >= DISAVOW_MIN_LEVEL, isDPR: dpr }
  } catch {
    return DENIED
  }
}

export async function canViewDisavowList(discordId: string): Promise<boolean> {
  return (await disavowViewer(discordId)).allowed
}

/** The one response for every denial: indistinguishable from a missing route. */
export function disavowNotFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
}

export type DisavowGuard =
  | { ok: true; session: Session; isDPR: boolean }
  | { ok: false; response: NextResponse }

/** API guard: 404 (never 401/403) unless the caller may use the list. */
export async function requireDisavowViewer(): Promise<DisavowGuard> {
  if (!disavowEnabled()) return { ok: false, response: disavowNotFound() }
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return { ok: false, response: disavowNotFound() }
  const v = await disavowViewer(session.discordId)
  if (!v.allowed) return { ok: false, response: disavowNotFound() }
  return { ok: true, session, isDPR: v.isDPR }
}

/** API guard for DPR-only actions; also 404 for everyone else. */
export async function requireDisavowDPR(): Promise<DisavowGuard> {
  const g = await requireDisavowViewer()
  if (!g.ok) return g
  return g.isDPR ? g : { ok: false, response: disavowNotFound() }
}

/** Server-component guard: `notFound()` unless the caller may use the list. */
export async function requireDisavowViewerPage(): Promise<{ session: Session; isDPR: boolean }> {
  const g = await requireDisavowViewer()
  if (!g.ok) notFound()
  return { session: g.session, isDPR: g.isDPR }
}
