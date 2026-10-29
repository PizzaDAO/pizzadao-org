/** Database side of Pizza Passport: runs a check-in, releases held ones, reads stamps. */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { disavowEnabled } from '@/app/lib/disavow/constants'
import { isDisavowSubject } from '@/app/lib/disavow/access'
import { snowflakeCreatedAt } from '@/app/lib/mission-verify/policy'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { decideCheckIn, type DecisionResult, type RejectReason } from './checkin'
import type { PassportConfig } from './config'
import { verifyQrCode } from './qr'
import { COORD_RETENTION_DAYS } from './scrub'

const DAY_MS = 86_400_000

export interface CheckInRequest {
  discordId: string
  slug: string
  code: string
  client: { lat: unknown; lng: unknown; accuracy: unknown } | null
}

export type CheckInOutcome =
  | { ok: false; reason: 'not_found' | RejectReason }
  | {
      ok: true
      decision: 'APPROVED' | 'PENDING'
      newStamp: boolean
      countsAsVisit: boolean
      pizzeria: { slug: string; name: string; city: string | null; countryCode: string | null }
    }

async function memberIdOrNull(discordId: string): Promise<string | null> {
  try {
    return await findMemberIdByDiscordId(discordId)
  } catch {
    return null
  }
}

async function isDisallowed(discordId: string): Promise<boolean> {
  if (!disavowEnabled()) return false
  try {
    return await isDisavowSubject(discordId)
  } catch {
    return true // fail closed
  }
}

/** Create or bump the stamp for an approved check-in. Idempotent per (member, pizzeria). */
export async function applyApproved(
  tx: Prisma.TransactionClient,
  args: { checkInId: number; discordId: string; memberId: string | null; pizzeriaId: string; countsAsVisit: boolean; at: Date },
): Promise<void> {
  await tx.passportStamp.upsert({
    where: { discordId_pizzeriaId: { discordId: args.discordId, pizzeriaId: args.pizzeriaId } },
    create: {
      discordId: args.discordId,
      memberId: args.memberId,
      pizzeriaId: args.pizzeriaId,
      firstCheckInId: args.checkInId,
      verified: true,
      stampedAt: args.at,
      lastVisitAt: args.at,
    },
    update: args.countsAsVisit ? { visits: { increment: 1 }, lastVisitAt: args.at } : {},
  })
}

export async function performCheckIn(req: CheckInRequest, config: PassportConfig, now = new Date()): Promise<CheckInOutcome> {
  const pizzeria = await prisma.pizzeria.findUnique({ where: { slug: req.slug } })
  if (!pizzeria) return { ok: false, reason: 'not_found' }

  const since = new Date(now.getTime() - 24 * 3_600_000)
  const [disallowed, existing, newStampsLast24h, prev, memberId] = await Promise.all([
    isDisallowed(req.discordId),
    prisma.passportStamp.findUnique({
      where: { discordId_pizzeriaId: { discordId: req.discordId, pizzeriaId: pizzeria.id } },
      select: { lastVisitAt: true },
    }),
    prisma.passportStamp.count({ where: { discordId: req.discordId, stampedAt: { gte: since } } }),
    prisma.pizzeriaCheckIn.findFirst({
      where: { discordId: req.discordId, status: { not: 'REJECTED' }, lat: { not: null }, lng: { not: null }, createdAt: { gte: new Date(now.getTime() - COORD_RETENTION_DAYS * DAY_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { lat: true, lng: true, createdAt: true },
    }),
    memberIdOrNull(req.discordId),
  ])

  const created = snowflakeCreatedAt(req.discordId)
  const newAccount = !created || now.getTime() - created.getTime() < config.newAccountDays * 86_400_000

  const result: DecisionResult = decideCheckIn({
    disallowed,
    pizzeria,
    qrValid: verifyQrCode(pizzeria.id, pizzeria.qrVersion, req.code),
    client: req.client,
    config,
    newAccount,
    previous: prev && prev.lat != null && prev.lng != null ? { lat: prev.lat, lng: prev.lng, at: prev.createdAt } : null,
    existing,
    newStampsLast24h,
    now,
  })

  // A malformed or ineligible attempt leaves no row; a located refusal keeps distance/accuracy only (no coordinates).
  if (result.decision === 'REJECTED') {
    if (result.reason === 'too_far' || result.reason === 'low_accuracy' || result.reason === 'daily_limit') {
      await prisma.pizzeriaCheckIn.create({ data: row(req, pizzeria.id, memberId, result, 'REJECTED') })
    }
    return { ok: false, reason: result.reason! }
  }

  const info = { slug: pizzeria.slug, name: pizzeria.name, city: pizzeria.city, countryCode: pizzeria.countryCode }
  if (result.decision === 'PENDING') {
    // A flagged revisit inside the cooldown would not count anyway: leave nothing for a reviewer.
    if (existing && now.getTime() - existing.lastVisitAt.getTime() < config.revisitCooldownHours * 3_600_000) {
      return { ok: true, decision: 'APPROVED', newStamp: false, countsAsVisit: false, pizzeria: info }
    }
    await prisma.pizzeriaCheckIn.create({ data: row(req, pizzeria.id, memberId, result, 'PENDING') })
    return { ok: true, decision: 'PENDING', newStamp: false, countsAsVisit: false, pizzeria: info }
  }

  // Serialize per member so parallel requests cannot all pass the daily cap, then decide on fresh counts.
  const outcome = await prisma.$transaction(async (tx) => {
    await lockMember(tx, req.discordId)
    const [stamp, fresh] = await Promise.all([
      tx.passportStamp.findUnique({
        where: { discordId_pizzeriaId: { discordId: req.discordId, pizzeriaId: pizzeria.id } },
        select: { lastVisitAt: true },
      }),
      tx.passportStamp.count({ where: { discordId: req.discordId, stampedAt: { gte: since } } }),
    ])
    if (!stamp && fresh >= config.maxNewStampsPerDay) {
      await tx.pizzeriaCheckIn.create({ data: row(req, pizzeria.id, memberId, result, 'REJECTED') })
      return { capped: true as const }
    }
    const countsAsVisit = !stamp || now.getTime() - stamp.lastVisitAt.getTime() >= config.revisitCooldownHours * 3_600_000
    const c = await tx.pizzeriaCheckIn.create({ data: row(req, pizzeria.id, memberId, result, 'APPROVED') })
    await applyApproved(tx, { checkInId: c.id, discordId: req.discordId, memberId, pizzeriaId: pizzeria.id, countsAsVisit, at: now })
    return { capped: false as const, newStamp: !stamp, countsAsVisit }
  })
  if (outcome.capped) return { ok: false, reason: 'daily_limit' }
  return { ok: true, decision: 'APPROVED', newStamp: outcome.newStamp, countsAsVisit: outcome.countsAsVisit, pizzeria: info }
}

/** Per-member advisory lock held until the transaction ends. */
export async function lockMember(tx: Prisma.TransactionClient, discordId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'passport:' + discordId}))`
}

function row(
  req: CheckInRequest,
  pizzeriaId: string,
  memberId: string | null,
  r: DecisionResult,
  status: 'APPROVED' | 'PENDING' | 'REJECTED',
): Prisma.PizzeriaCheckInUncheckedCreateInput {
  return {
    pizzeriaId,
    discordId: req.discordId,
    memberId,
    method: r.method,
    status,
    lat: status === 'REJECTED' ? null : (r.located?.lat ?? null),
    lng: status === 'REJECTED' ? null : (r.located?.lng ?? null),
    accuracyM: r.accuracyM,
    distanceM: r.distanceM,
    riskFlags: (r.riskFlags.length ? (r.riskFlags as unknown as Prisma.InputJsonValue) : undefined),
  }
}

/** Admin: release (approve) or reject a held check-in. Approving grants the stamp, with the same cap and cooldown rules. */
export async function reviewCheckIn(
  checkInId: number,
  reviewerId: string,
  approve: boolean,
  config: Pick<PassportConfig, 'revisitCooldownHours' | 'maxNewStampsPerDay'>,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.pizzeriaCheckIn.findUnique({ where: { id: checkInId }, include: { pizzeria: true } })
    if (!c || c.status !== 'PENDING') return { ok: false as const, reason: 'not_pending' as const }
    if (!approve) {
      await tx.pizzeriaCheckIn.update({ where: { id: c.id }, data: { status: 'REJECTED', reviewedBy: reviewerId, lat: null, lng: null } })
      return { ok: true as const }
    }
    if (c.pizzeria.status !== 'ACTIVE' || !c.pizzeria.isPartner || c.pizzeria.isChain) {
      return { ok: false as const, reason: 'not_eligible' as const }
    }
    if (await isDisallowed(c.discordId)) return { ok: false as const, reason: 'not_allowed' as const }

    await lockMember(tx, c.discordId)
    const [existing, fresh] = await Promise.all([
      tx.passportStamp.findUnique({
        where: { discordId_pizzeriaId: { discordId: c.discordId, pizzeriaId: c.pizzeriaId } },
        select: { lastVisitAt: true },
      }),
      tx.passportStamp.count({ where: { discordId: c.discordId, stampedAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    ])
    if (!existing && fresh >= config.maxNewStampsPerDay) return { ok: false as const, reason: 'daily_limit' as const }
    const countsAsVisit = !existing || now.getTime() - existing.lastVisitAt.getTime() >= config.revisitCooldownHours * 3_600_000

    await tx.pizzeriaCheckIn.update({ where: { id: c.id }, data: { status: 'APPROVED', reviewedBy: reviewerId } })
    await applyApproved(tx, {
      checkInId: c.id,
      discordId: c.discordId,
      memberId: c.memberId,
      pizzeriaId: c.pizzeriaId,
      countsAsVisit,
      at: now,
    })
    return { ok: true as const }
  })
}

export interface StampView {
  id: number
  slug: string
  name: string
  city: string | null
  countryCode: string | null
  ink: string | null
  logoUrl: string | null
  stampedAt: Date
  verified: boolean
  pinned: boolean
  visits: number
}

export async function listStamps(discordId: string): Promise<StampView[]> {
  const rows = await prisma.passportStamp.findMany({
    where: { discordId },
    orderBy: [{ pinned: 'desc' }, { stampedAt: 'desc' }],
    include: { pizzeria: true },
  })
  return rows.map((r) => ({
    id: r.id,
    slug: r.pizzeria.slug,
    name: r.pizzeria.name,
    city: r.pizzeria.city,
    countryCode: r.pizzeria.countryCode,
    ink: r.pizzeria.stampInk,
    // The logo is shown only while the partner's consent is on record.
    logoUrl: r.pizzeria.logoConsentAt ? r.pizzeria.logoUrl : null,
    stampedAt: r.stampedAt,
    verified: r.verified,
    pinned: r.pinned,
    visits: r.visits,
  }))
}
