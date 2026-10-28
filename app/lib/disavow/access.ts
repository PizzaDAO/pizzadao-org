/**
 * Who may see or use the disavow list (plans/disavow-list.md, Snax 2026-10-26):
 * level 5+ or Dread Pizza Roberts. Anyone LISTED or SUSPENDED is locked out
 * completely, whatever their level. Someone who is merely NOMINATED keeps
 * normal access (so they can't infer it from losing the nav link) but gets a
 * 404 for their own entry everywhere (see detail.ts) and can't vote on it.
 * Everyone who is not allowed gets a 404 with no body that hints the feature
 * exists, and the same 404 when DISAVOW_ENABLED is off. Every check runs per
 * request (no cached grant), and every lookup failure fails closed.
 */
import { NextResponse } from 'next/server'
import { notFound } from 'next/navigation'
import { prisma } from '@/app/lib/db'
import { getSession, type Session } from '@/app/lib/session'
import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { getSetting } from '@/app/lib/settings'
import { disavowEnabled } from './constants'
import { identifierOr, viewerIdentifiers } from './match'

const LOCKOUT_STATUSES = ['LISTED', 'SUSPENDED'] as const

export function isDisavowDPR(discordId: string): Promise<boolean> {
  return isDreadPizzaRoberts(discordId).catch(() => false)
}

/** Matches every identifier we know for the viewer: Discord id, member id, wallets, X. */
async function subjectWhere(discordId: string, statuses: readonly string[]) {
  const or = identifierOr(await viewerIdentifiers(discordId))
  return { OR: or, disavowal: { status: { in: [...statuses] } } }
}

/** Whether this person is LISTED or SUSPENDED. Throws on DB errors. */
export async function isDisavowSubject(discordId: string): Promise<boolean> {
  const hit = await prisma.disavowIdentifier.findFirst({
    where: (await subjectWhere(discordId, LOCKOUT_STATUSES)) as never,
    select: { id: true },
  })
  return !!hit
}

/** The viewer's own LISTED/SUSPENDED entries: the only things a subject can reach. */
export async function findSubjectDisavowals(discordId: string) {
  if (!disavowEnabled()) return []
  try {
    const hits = await prisma.disavowIdentifier.findMany({
      where: (await subjectWhere(discordId, LOCKOUT_STATUSES)) as never,
      select: { disavowalId: true },
    })
    const ids = [...new Set(hits.map((h: { disavowalId: string }) => h.disavowalId))]
    if (ids.length === 0) return []
    return await prisma.disavowal.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, status: true, displayName: true, reason: true, statement: true, evidenceUrls: true,
        subjectResponse: true, respondedAt: true, listedAt: true, reviewDueAt: true, lastAppealAt: true,
        rounds: { where: { state: 'OPEN' }, select: { id: true } },
      },
    })
  } catch {
    return []
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
    const [subject, dpr, level, minLevel] = await Promise.all([
      isDisavowSubject(discordId),
      isDisavowDPR(discordId),
      getCurrentLevel(discordId).catch(() => 0),
      getSetting('disavow.minLevel'),
    ])
    if (subject) return DENIED
    return { allowed: dpr || level >= minLevel, isDPR: dpr }
  } catch {
    return DENIED
  }
}

const VIEWER_CACHE_TTL_MS = 60_000
const viewerCache = new Map<string, { at: number; v: DisavowViewer }>()
export function __resetDisavowViewerCache() { viewerCache.clear() }

/**
 * Same answer as disavowViewer, remembered for 60s per user. ONLY for cosmetic,
 * frequently polled things (the nav link in /api/session). Every guard that
 * protects data calls disavowViewer directly, on every request.
 */
export async function disavowViewerCached(discordId: string, now = Date.now()): Promise<DisavowViewer> {
  const hit = viewerCache.get(discordId)
  if (hit && now - hit.at < VIEWER_CACHE_TTL_MS) return hit.v
  const v = await disavowViewer(discordId)
  if (viewerCache.size > 5000) viewerCache.clear()
  viewerCache.set(discordId, { at: now, v })
  return v
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
