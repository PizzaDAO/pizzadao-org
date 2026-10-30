/**
 * Reviewer operations behind /admin/followups (phase 1): list, edit, approve, dismiss, re-resolve.
 * Every change is logged to FollowUpEvent. Approving is the only way a row can ever be sent.
 */
import { Prisma, type FollowUpChannel, type FollowUpStatus } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { telegramSenderAvailable } from './telegram'
import { fetchAllMembers } from '@/app/lib/sheets/members-list'
import { addEvent, guardedTransition } from './store'
import { canTransition, EDITABLE } from './state'
import { resolveOwner, normalizeName, type MemberRef } from './resolve'

export const MAX_MESSAGE_CHARS = 1500

export class FollowUpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

export async function loadMemberRefs(): Promise<MemberRef[]> {
  const all = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true })
  return all.map((m) => ({ id: m.id, name: m.name, discordId: m.discordId ?? '' }))
}

export async function searchMembers(q: string, limit = 8): Promise<Array<{ memberId: string; name: string; discordId: string }>> {
  const needle = normalizeName(q)
  if (needle.length < 2) return []
  return (await loadMemberRefs())
    .filter((m) => m.discordId && normalizeName(m.name).includes(needle))
    .slice(0, limit)
    .map((m) => ({ memberId: m.id, name: m.name, discordId: m.discordId }))
}

export interface ListFilter {
  status?: FollowUpStatus[]
  recordingId?: string
  limit?: number
}

export async function listFollowUps(f: ListFilter = {}) {
  const rows = await prisma.followUp.findMany({
    where: { ...(f.status?.length ? { status: { in: f.status } } : {}), ...(f.recordingId ? { recordingId: f.recordingId } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    take: Math.min(f.limit ?? 200, 500),
    include: { events: { orderBy: { createdAt: 'asc' }, take: 50 } },
  })
  const owners = [...new Set(rows.flatMap((r) => (r.ownerDiscordId ? [r.ownerDiscordId] : [])))]
  const [telegram, optedOut, calls] = await Promise.all([
    owners.length ? prisma.telegramAccount.findMany({ where: { discordId: { in: owners } }, select: { discordId: true, dmAllowed: true } }) : [],
    owners.length ? prisma.messagingOptOut.findMany({ where: { discordId: { in: owners } }, select: { discordId: true } }) : [],
    prisma.callRecording.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.recordingId ? [r.recordingId] : [])))] } },
      select: { id: true, title: true, eventName: true, crewLabel: true, startedAt: true },
    }),
  ])
  const tgSender = telegramSenderAvailable()
  const tg = new Map(telegram.map((t) => [t.discordId, t.dmAllowed]))
  const opted = new Set(optedOut.map((o) => o.discordId))
  const callById = new Map(calls.map((c) => [c.id, c]))
  const items = rows.map((r) => ({
    ...r,
    telegramLinked: r.ownerDiscordId ? tg.has(r.ownerDiscordId) : false,
    telegramDmAllowed: r.ownerDiscordId ? tg.get(r.ownerDiscordId) === true && tgSender : false,
    optedOut: r.ownerDiscordId ? opted.has(r.ownerDiscordId) : false,
    call: r.recordingId ? (callById.get(r.recordingId) ?? null) : null,
  }))
  // Reach: of the rows with a person, how many can be messaged on Telegram (the rest use Discord DMs).
  const withOwner = items.filter((i) => i.ownerDiscordId)
  return {
    items,
    reach: { people: withOwner.length, telegram: withOwner.filter((i) => i.telegramDmAllowed).length },
  }
}

export interface FollowUpPatch {
  message?: string
  dueAt?: string | null
  channel?: FollowUpChannel | null
  /** Pick the person from the member sheet (the Discord id is looked up there, never taken from the client). */
  ownerMemberId?: string
}

export async function editFollowUp(id: string, actor: string, patch: FollowUpPatch): Promise<{ updatedAt: string }> {
  const row = await prisma.followUp.findUnique({ where: { id } })
  if (!row) throw new FollowUpError(404, 'Not found')
  if (!EDITABLE.includes(row.status)) throw new FollowUpError(409, 'This follow-up can no longer be edited')
  const data: Prisma.FollowUpUpdateInput = {}
  const diff: Record<string, [unknown, unknown]> = {}
  if (patch.message !== undefined) {
    const m = patch.message.trim()
    if (!m || m.length > MAX_MESSAGE_CHARS) throw new FollowUpError(400, `The message must be 1-${MAX_MESSAGE_CHARS} characters`)
    if (m !== row.message) {
      data.message = m
      diff.message = [row.message.slice(0, 200), m.slice(0, 200)]
    }
  }
  if (patch.dueAt !== undefined) {
    const d = patch.dueAt === null ? null : new Date(patch.dueAt)
    if (d && Number.isNaN(d.getTime())) throw new FollowUpError(400, 'Invalid due date')
    if ((d?.getTime() ?? null) !== (row.dueAt?.getTime() ?? null)) {
      data.dueAt = d
      diff.dueAt = [row.dueAt?.toISOString() ?? null, d?.toISOString() ?? null]
    }
  }
  if (patch.channel !== undefined) {
    if (patch.channel !== null && patch.channel !== 'DISCORD' && patch.channel !== 'TELEGRAM') throw new FollowUpError(400, 'Invalid channel')
    if (patch.channel !== row.channel) {
      data.channel = patch.channel
      diff.channel = [row.channel, patch.channel]
    }
  }
  if (patch.ownerMemberId !== undefined) {
    const m = (await loadMemberRefs()).find((x) => x.id === patch.ownerMemberId)
    if (!m || !m.discordId) throw new FollowUpError(400, 'That member has no linked Discord account')
    if (m.discordId !== row.ownerDiscordId) {
      data.ownerDiscordId = m.discordId
      data.ownerMemberId = m.id
      data.candidates = Prisma.DbNull
      diff.owner = [row.ownerMemberId, m.id]
    }
  }
  if (Object.keys(data).length === 0) return { updatedAt: row.updatedAt.toISOString() }
  const res = await prisma.followUp.updateMany({ where: { id, status: row.status }, data: data as Prisma.FollowUpUpdateManyMutationInput })
  if (res.count !== 1) throw new FollowUpError(409, 'This follow-up changed; reload and retry')
  await addEvent(id, 'edited', actor, { diff: JSON.stringify(diff).slice(0, 900) })
  const fresh = await prisma.followUp.findUnique({ where: { id }, select: { updatedAt: true } })
  return { updatedAt: (fresh?.updatedAt ?? new Date()).toISOString() }
}

/** The only door to sending: DRAFT (or a failed / unreachable row, to retry) -> APPROVED. */
/** `expectedUpdatedAt` (ISO) is what the reviewer was looking at; if the row changed since, nothing is approved. */
export async function approveFollowUp(id: string, actor: string, opts: { escalateOnly?: boolean; expectedUpdatedAt: string }): Promise<void> {
  const row = await prisma.followUp.findUnique({ where: { id } })
  if (!row) throw new FollowUpError(404, 'Not found')
  if (!EDITABLE.includes(row.status)) throw new FollowUpError(409, 'This follow-up is already decided')
  if (row.updatedAt.toISOString() !== opts.expectedUpdatedAt) throw new FollowUpError(409, 'This follow-up changed since you opened it; reload and check it again')
  if (!opts.escalateOnly && !row.ownerDiscordId) throw new FollowUpError(400, 'Pick the person first, or send it to the approvers instead')
  if (!row.message.trim()) throw new FollowUpError(400, 'The message is empty')
  const ok = await guardedTransition(
    id,
    row.status,
    'APPROVED',
    { approvedBy: actor, approvedAt: new Date(), sendAfter: null, sendAttemptAt: null, escalateOnly: !!opts.escalateOnly, error: null },
    { type: 'approved', actorId: actor, data: { escalateOnly: !!opts.escalateOnly } },
    { updatedAt: row.updatedAt },
  )
  if (!ok) throw new FollowUpError(409, 'This follow-up changed; reload and retry')
}

export async function dismissFollowUp(id: string, actor: string): Promise<void> {
  const row = await prisma.followUp.findUnique({ where: { id }, select: { status: true, sendAfter: true, sendAttemptAt: true } })
  if (!row) throw new FollowUpError(404, 'Not found')
  if (!canTransition(row.status, 'DISMISSED')) throw new FollowUpError(409, 'This follow-up can no longer be dismissed')
  // A send is in flight (attempt marker + live lease): dismissing now could not stop it.
  if (row.status === 'APPROVED' && row.sendAttemptAt && row.sendAfter && row.sendAfter.getTime() > Date.now()) {
    throw new FollowUpError(409, 'A send is in progress; try again in a few minutes')
  }
  const ok = await guardedTransition(id, row.status, 'DISMISSED', { sendAfter: null }, { type: 'dismissed', actorId: actor })
  if (!ok) throw new FollowUpError(409, 'This follow-up changed; reload and retry')
}

/** Redo the people match from the name (DRAFT rows only). */
export async function reresolveFollowUp(id: string, actor: string): Promise<void> {
  const row = await prisma.followUp.findUnique({ where: { id } })
  if (!row) throw new FollowUpError(404, 'Not found')
  if (!EDITABLE.includes(row.status)) throw new FollowUpError(409, 'This follow-up can no longer be edited')
  const r = resolveOwner({ ownerName: row.ownerName }, await loadMemberRefs())
  await prisma.followUp.updateMany({
    where: { id, status: row.status },
    data: { ownerDiscordId: r.discordId, ownerMemberId: r.memberId, candidates: r.candidates.length ? (r.candidates as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
  })
  await addEvent(id, 'reresolved', actor, { resolution: r.status, matchedBy: r.matchedBy })
}
