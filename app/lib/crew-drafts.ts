// Crew drafts (tweets / posts composed on a crew page).
//
// Permissions: crew members create, edit and mark ready; crew leads and Dread
// Pizza Roberts (canReviewMission(id, 8)) also mark posted / archive / restore.
// Everyone else sees nothing. Drafts are never hard-deleted (archive instead).
// Every check FAILS CLOSED.
import { prisma } from './db'
import { normalizeCrewId } from './crew-id'
import { crewHasFeature } from './crew-features'
import { isCrewLead } from './crew-leads'
import { fetchAllMembers } from './sheets/members-list'
import { canReviewMission } from './mission-review-access'
import { ForbiddenError, NotFoundError, ValidationError } from './errors/api-errors'
import {
  DRAFT_PLATFORMS,
  canTransition,
  isHttpsUrl,
  isLeadOnlyTransition,
  type DraftPlatform,
  type DraftStatus,
} from './draft-text'

export const MAX_DRAFT_TEXT = 5000
export const MAX_NOTES = 1000

export type DraftAccess = { member: boolean; manager: boolean }

export async function isCrewMember(discordId: string, crewId: string): Promise<boolean> {
  if (!discordId || !crewId) return false
  try {
    const id = normalizeCrewId(crewId)
    const members = await fetchAllMembers({ includeDiscordId: true })
    const me = members.find((m) => m.discordId === discordId)
    return !!me && me.crews.some((c) => normalizeCrewId(c) === id)
  } catch {
    return false
  }
}

export async function isDraftManager(discordId: string, crewId: string): Promise<boolean> {
  if (await isCrewLead(discordId, crewId)) return true
  try {
    return await canReviewMission(discordId, 8)
  } catch {
    return false
  }
}

export async function getDraftAccess(discordId: string, crewId: string): Promise<DraftAccess> {
  if (!discordId || !crewHasFeature(crewId, 'drafts')) return { member: false, manager: false }
  const [isMember, manager] = await Promise.all([isCrewMember(discordId, crewId), isDraftManager(discordId, crewId)])
  return { member: isMember || manager, manager }
}

// ---- Status mapping (DB enums are upper-case) ----------------------------

export type DraftRow = Awaited<ReturnType<typeof prisma.crewDraft.findMany>>[number]

const toDb = <T extends string>(v: T) => v.toUpperCase() as Uppercase<T>
const fromDb = <T extends string>(v: T) => v.toLowerCase() as Lowercase<T>

export function serializeDraft(d: DraftRow) {
  return {
    id: d.id,
    crewId: d.crewId,
    platform: fromDb(d.platform) as DraftPlatform,
    text: d.text,
    mediaUrl: d.mediaUrl,
    notes: d.notes,
    status: fromDb(d.status) as DraftStatus,
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    postedBy: d.postedBy,
    postedAt: d.postedAt ? d.postedAt.toISOString() : null,
    postedUrl: d.postedUrl,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }
}

// ---- Validation ------------------------------------------------------------

export type DraftInput = { platform?: unknown; text?: unknown; mediaUrl?: unknown; notes?: unknown }

function optString(v: unknown, max: number, field: string): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (typeof v !== 'string' || v.length > max) throw new ValidationError(`Invalid ${field}`, field)
  return v.trim() || null
}

export function validateDraftInput(input: DraftInput, partial: boolean) {
  const out: { platform?: DraftPlatform; text?: string; mediaUrl?: string | null; notes?: string | null } = {}
  if (input.platform !== undefined || !partial) {
    if (typeof input.platform !== 'string' || !(DRAFT_PLATFORMS as readonly string[]).includes(input.platform)) {
      throw new ValidationError('Invalid platform', 'platform')
    }
    out.platform = input.platform as DraftPlatform
  }
  if (input.text !== undefined || !partial) {
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > MAX_DRAFT_TEXT) {
      throw new ValidationError('Text is required (max 5000 characters)', 'text')
    }
    out.text = input.text.trim()
  }
  const media = optString(input.mediaUrl, 2000, 'mediaUrl')
  if (media && !isHttpsUrl(media)) throw new ValidationError('Media link must be https', 'mediaUrl')
  if (media !== undefined) out.mediaUrl = media
  const notes = optString(input.notes, MAX_NOTES, 'notes')
  if (notes !== undefined) out.notes = notes
  return out
}

// ---- Operations ------------------------------------------------------------

function requireFeature(crewId: string) {
  if (!crewHasFeature(crewId, 'drafts')) throw new NotFoundError('Drafts are not enabled for this crew')
}

/** Drafts for a crew, newest first. Archived only when `includeArchived`. Members only. */
export async function listDrafts(discordId: string, crewId: string, opts: { includeArchived?: boolean } = {}) {
  const id = normalizeCrewId(crewId)
  requireFeature(id)
  const access = await getDraftAccess(discordId, id)
  if (!access.member) throw new ForbiddenError('Crew members only')
  const rows = await prisma.crewDraft.findMany({
    where: { crewId: id, ...(opts.includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: { createdAt: 'desc' },
  })
  return { access, drafts: rows.map(serializeDraft) }
}

export async function createDraft(discordId: string, crewId: string, input: DraftInput) {
  const id = normalizeCrewId(crewId)
  requireFeature(id)
  const access = await getDraftAccess(discordId, id)
  if (!access.member) throw new ForbiddenError('Crew members only')
  const data = validateDraftInput(input, false)
  const row = await prisma.crewDraft.create({
    data: {
      crewId: id,
      platform: toDb(data.platform!),
      text: data.text!,
      mediaUrl: data.mediaUrl ?? null,
      notes: data.notes ?? null,
      createdBy: discordId,
      updatedBy: discordId,
    },
  })
  return serializeDraft(row)
}

async function loadDraft(crewId: string, draftId: number) {
  const row = await prisma.crewDraft.findUnique({ where: { id: draftId } })
  if (!row || row.crewId !== normalizeCrewId(crewId)) throw new NotFoundError('Draft not found')
  return row
}

/** Edit text/platform/media/notes. Members only; posted and archived drafts are frozen. */
export async function editDraft(discordId: string, crewId: string, draftId: number, input: DraftInput) {
  requireFeature(normalizeCrewId(crewId))
  const access = await getDraftAccess(discordId, crewId)
  if (!access.member) throw new ForbiddenError('Crew members only')
  const row = await loadDraft(crewId, draftId)
  if (row.status === 'POSTED' || row.status === 'ARCHIVED') {
    throw new ForbiddenError('Posted or archived drafts cannot be edited')
  }
  const data = validateDraftInput(input, true)
  const updated = await prisma.crewDraft.update({
    where: { id: draftId },
    data: {
      ...(data.platform ? { platform: toDb(data.platform) } : {}),
      ...(data.text !== undefined ? { text: data.text } : {}),
      ...(data.mediaUrl !== undefined ? { mediaUrl: data.mediaUrl } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      updatedBy: discordId,
    },
  })
  return serializeDraft(updated)
}

/**
 * Move a draft along draft -> ready -> posted -> archived. Members may toggle
 * draft/ready; posted, archive and restore need a lead / Dread Pizza Roberts.
 * "Archive" is the only removal: rows are never deleted.
 */
export async function changeDraftStatus(
  discordId: string,
  crewId: string,
  draftId: number,
  to: DraftStatus,
  opts: { postedUrl?: unknown } = {},
) {
  requireFeature(normalizeCrewId(crewId))
  const access = await getDraftAccess(discordId, crewId)
  if (!access.member) throw new ForbiddenError('Crew members only')
  const row = await loadDraft(crewId, draftId)
  const from = fromDb(row.status) as DraftStatus
  if (!canTransition(from, to)) throw new ValidationError(`Cannot move a ${from} draft to ${to}`, 'status')
  if (isLeadOnlyTransition(from, to) && !access.manager) {
    throw new ForbiddenError('Only crew leads can do that')
  }

  const data: Record<string, unknown> = { status: toDb(to), updatedBy: discordId }
  if (to === 'posted') {
    const url = optString(opts.postedUrl, 2000, 'postedUrl')
    if (url && !isHttpsUrl(url)) throw new ValidationError('Posted link must be https', 'postedUrl')
    data.postedBy = discordId
    data.postedAt = new Date()
    data.postedUrl = url ?? null
  }
  const updated = await prisma.crewDraft.update({ where: { id: draftId }, data })
  return serializeDraft(updated)
}
