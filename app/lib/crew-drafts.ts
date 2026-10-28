// Crew drafts (tweets / posts composed on a crew page).
//
// Permissions: crew members create, edit and mark ready; crew leads and Dread
// Pizza Roberts (isDreadPizzaRoberts) also mark posted / archive / restore.
// Everyone else sees nothing. Drafts are never hard-deleted (archive instead).
// Every check FAILS CLOSED.
import { prisma } from './db'
import { canonicalCrewId, crewHasFeature } from './crew-features'
import { MAX_DRAFT_TEXT, MAX_NOTES, MAX_URL } from './draft-limits.mjs'
import { isCrewLead, isOnCrewRoster } from './crew-leads'
import { fetchAllMembers } from './sheets/members-list'
import { isDreadPizzaRoberts } from './mission-review-access'
import { ForbiddenError, NotFoundError, ValidationError } from './errors/api-errors'
import {
  DRAFT_PLATFORMS,
  DRAFT_STATUSES,
  canTransition,
  isHttpsUrl,
  isLeadOnlyTransition,
  type DraftPlatform,
  type DraftStatus,
} from './draft-text'


export type DraftAccess = { member: boolean; manager: boolean }

/** Listed for this crew on the members sheet (accepts aliases such as "Communications"). */
export async function isCrewMember(discordId: string, crewId: string): Promise<boolean> {
  if (!discordId || !crewId) return false
  try {
    const id = canonicalCrewId(crewId)
    const members = await fetchAllMembers({ includeDiscordId: true })
    const me = members.find((m) => m.discordId === discordId)
    return !!me && me.crews.some((c) => canonicalCrewId(c) === id)
  } catch {
    return false
  }
}

export async function isDraftManager(discordId: string, crewId: string): Promise<boolean> {
  if (await isCrewLead(discordId, canonicalCrewId(crewId))) return true
  try {
    return await isDreadPizzaRoberts(discordId)
  } catch {
    return false
  }
}

/**
 * Member = on the members sheet for the crew, OR a lead / Dread Pizza Roberts, OR on
 * the crew's own roster sheet. Confirmed sheet members skip the roster lookup.
 * Fails closed.
 */
export async function getDraftAccess(discordId: string, crewId: string): Promise<DraftAccess> {
  if (!discordId || !crewHasFeature(crewId, 'drafts')) return { member: false, manager: false }
  const id = canonicalCrewId(crewId)
  const [sheetMember, manager] = await Promise.all([isCrewMember(discordId, id), isDraftManager(discordId, id)])
  if (sheetMember || manager) return { member: true, manager }
  return { member: await isOnCrewRoster(discordId, id), manager: false }
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
  const media = optString(input.mediaUrl, MAX_URL, 'mediaUrl')
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
  const id = canonicalCrewId(crewId)
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
  const id = canonicalCrewId(crewId)
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
  if (!row || row.crewId !== canonicalCrewId(crewId)) throw new NotFoundError('Draft not found')
  return row
}

const EDIT_KEYS = ['platform', 'text', 'mediaUrl', 'notes'] as const

export type DraftUpdate = DraftInput & { status?: unknown; postedUrl?: unknown }

/**
 * One all-or-nothing update: edits (platform/text/media/notes) and/or a status
 * move. Everything is validated and permission-checked BEFORE the single write,
 * so a rejected status change never leaves edits behind.
 *
 * Members edit and toggle draft/ready; posted, archive and restore need a lead /
 * Dread Pizza Roberts. Posted and archived drafts are frozen. "Archive" is the
 * only removal: rows are never deleted. A body with no recognized field is a 400.
 */
export async function updateDraft(discordId: string, crewId: string, draftId: number, body: DraftUpdate) {
  const id = canonicalCrewId(crewId)
  requireFeature(id)
  const access = await getDraftAccess(discordId, id)
  if (!access.member) throw new ForbiddenError('Crew members only')

  const hasEdit = EDIT_KEYS.some((k) => body[k] !== undefined)
  const hasStatus = body.status !== undefined
  if (!hasEdit && !hasStatus) throw new ValidationError('Nothing to update')

  let to: DraftStatus | null = null
  if (hasStatus) {
    if (typeof body.status !== 'string' || !(DRAFT_STATUSES as readonly string[]).includes(body.status)) {
      throw new ValidationError('Invalid status', 'status')
    }
    to = body.status as DraftStatus
  }

  const row = await loadDraft(id, draftId)
  const from = fromDb(row.status) as DraftStatus
  const data: Record<string, unknown> = { updatedBy: discordId }

  if (hasEdit) {
    if (from === 'posted' || from === 'archived') {
      throw new ForbiddenError('Posted or archived drafts cannot be edited')
    }
    const edit = validateDraftInput(body, true)
    if (edit.platform) data.platform = toDb(edit.platform)
    if (edit.text !== undefined) data.text = edit.text
    if (edit.mediaUrl !== undefined) data.mediaUrl = edit.mediaUrl
    if (edit.notes !== undefined) data.notes = edit.notes
  }

  if (to) {
    if (!canTransition(from, to)) throw new ValidationError(`Cannot move a ${from} draft to ${to}`, 'status')
    if (isLeadOnlyTransition(from, to) && !access.manager) throw new ForbiddenError('Only crew leads can do that')
    data.status = toDb(to)
    if (to === 'posted') {
      const url = optString(body.postedUrl, MAX_URL, 'postedUrl')
      if (url && !isHttpsUrl(url)) throw new ValidationError('Posted link must be https', 'postedUrl')
      data.postedBy = discordId
      data.postedAt = new Date()
      data.postedUrl = url ?? null
    }
  }

  const updated = await prisma.crewDraft.update({ where: { id: draftId }, data })
  return serializeDraft(updated)
}

/** Edit text/platform/media/notes only. */
export function editDraft(discordId: string, crewId: string, draftId: number, input: DraftInput) {
  return updateDraft(discordId, crewId, draftId, { ...input, status: undefined })
}

/** Move a draft to `to` (see updateDraft for who may). */
export function changeDraftStatus(
  discordId: string,
  crewId: string,
  draftId: number,
  to: DraftStatus,
  opts: { postedUrl?: unknown } = {},
) {
  return updateDraft(discordId, crewId, draftId, { status: to, postedUrl: opts.postedUrl })
}
