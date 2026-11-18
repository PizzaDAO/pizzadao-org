/**
 * The real dependencies of the call review buttons (./call-review.ts, ./call-review-run.ts): database
 * lookups, the recap preview (the same inputs the admin call page uses) and the interaction webhook.
 * Kept apart so the pure handlers import nothing heavy.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { settingInt } from '@/app/lib/settings/numbers'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { callReviewRole } from '@/app/lib/calls/review-role'
import { heldReason } from '@/app/lib/calls/hold-rules'
import { loadPostFilter } from '@/app/lib/calls/post-filters'
import { publishRecording } from '@/app/lib/calls/recordings'
import { setHold } from '@/app/lib/calls/hold'
import { recordCallReviewEvent } from '@/app/lib/calls/review-audit'
import { cardVersion, reviewCardsEnabled, syncCallReviewCard } from '@/app/lib/calls/review-cards'
import {
  buildRecapParts,
  loadRecapPeople,
  postCallRecap,
  recapActionViews,
  recapCrewExcluded,
  recapLimits,
  recapPostingEnabled,
  redactionsNewerThanSummary,
  resolveRecapChannel,
} from '@/app/lib/calls/recap'
import { isImportedSource } from '@/app/lib/calls/imported'
import type { CallReviewDeps, CallReviewTarget } from './call-review'
import type { CallReviewRunDeps, RecapPreview } from './call-review-run'

const API = 'https://discord.com/api/v10'

/** Both switches: cards (this surface) and capo review (the permission model). */
export async function callReviewButtonsEnabled(): Promise<boolean> {
  return (await reviewCardsEnabled()) && (await toggleEnabled('calls.capoReviewEnabled'))
}

export async function loadCallReviewTarget(id: string): Promise<CallReviewTarget | null> {
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: {
      id: true, source: true, status: true, summary: true, crewId: true, crewLabel: true, eventName: true, title: true,
      actionItems: true, chapters: true, transcript: true, redactedSpeakerIds: true, redactedSegmentIds: true,
      reviewHoldAt: true, redactionsUpdatedAt: true, summaryGeneratedAt: true, summaryEditedAt: true,
    },
  })
  if (!rec) return null
  // An unreadable filter holds the call (fail closed).
  const filter = await loadPostFilter().catch(() => null)
  return {
    id: rec.id,
    source: rec.source,
    status: rec.status,
    version: cardVersion(rec),
    hasSummary: !!rec.summary?.trim(),
    held: heldReason(rec, filter) !== null,
    staleRedactions: redactionsNewerThanSummary(rec),
  }
}

/** The exact recap the website's publish would post, and where, built like the admin call page does. */
export async function buildRecapPreview(id: string): Promise<(RecapPreview & { version: string }) | null> {
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: {
      id: true, source: true, status: true, crewId: true, crewLabel: true, eventName: true, title: true, summary: true, actionItems: true, chapters: true,
      redactedSpeakerIds: true, redactionsUpdatedAt: true, summaryGeneratedAt: true, summaryEditedAt: true,
    },
  })
  if (!rec || !rec.summary?.trim()) return null
  // A filter that can't be read: no preview (nothing is published from here without one).
  const filter = await loadPostFilter().catch(() => null)
  if (!filter) return null
  const settings = await loadSettings()
  const actionViews = await recapActionViews(rec, filter).catch(() => undefined)
  const parts = buildRecapParts(
    { id: rec.id, title: rec.title, eventName: rec.eventName, crewLabel: rec.crewLabel, summary: rec.summary, actionItems: rec.actionItems, chapters: rec.chapters, ...(actionViews ? { actionViews } : {}) },
    undefined,
    filter,
    actionViews ? { ...recapLimits(settings), minBullets: settingInt('calls.recapMinBullets', settings) } : recapLimits(settings),
    await loadRecapPeople({ id: rec.id, source: rec.source, actionItems: rec.actionItems, redactedSpeakerIds: rec.redactedSpeakerIds }),
  )
  const channel = await resolveRecapChannel(rec.crewId).catch(() => null)
  return {
    text: parts.text,
    channelLabel: channel?.label ?? null,
    postingOn: await recapPostingEnabled(),
    willSkip: recapCrewExcluded(rec, filter) || redactionsNewerThanSummary(rec) || isImportedSource(rec.source),
    version: cardVersion(rec),
  }
}

/** Edit the deferred / ephemeral reply through the interaction webhook. */
export async function editOriginalReply(applicationId: string, token: string, body: { embeds: unknown[]; components: unknown[]; content?: string }, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the reply: ${(await res.text()).slice(0, 200)}`)
}

export function callReviewHandlerDeps(appUrl: string, run: CallReviewDeps['run'], refresh: NonNullable<CallReviewDeps['refresh']>): CallReviewDeps {
  return {
    enabled: callReviewButtonsEnabled,
    roleFor: (roles) => callReviewRole(roles),
    target: loadCallReviewTarget,
    run,
    refresh,
    appUrl,
  }
}

export function callReviewRunDeps(appUrl: string): CallReviewRunDeps {
  return {
    preview: buildRecapPreview,
    // A capo may not publish over lines hidden after the summary (the same guard as the website).
    publish: (id, reviewerId, role) => publishRecording(id, reviewerId, undefined, role === 'capo' ? { refuseStaleRedactions: true } : {}),
    recap: (id) => postCallRecap(id),
    audit: ({ recordingId, actorId, recap }) => recordCallReviewEvent({ recordingId, actorId, action: 'publish', via: 'discord', ...(recap ? { metadata: { recap } } : {}) }),
    hold: (id, actorId) => setHold(id, actorId, null, 'discord'),
    syncCard: (id) => syncCallReviewCard(id),
    edit: editOriginalReply,
    appUrl,
  }
}
