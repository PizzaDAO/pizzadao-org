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
      where: { discordId: req.discordId, status: { not: 'REJECTED' }, lat: { not: null }, lng: { not: null } },
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

  // A malformed or ineligible attempt leaves no row; only a located/held/approved one is worth keeping.
  if (result.decision === 'REJECTED') {
    if (result.reason === 'too_far' || result.reason === 'low_accuracy' || result.reason === 'daily_limit') {
      await prisma.pizzeriaCheckIn.create({ data: row(req, pizzeria.id, memberId, result, 'REJECTED') })
    }
    return { ok: false, reason: result.reason! }
  }

  const info = { slug: pizzeria.slug, name: pizzeria.name, city: pizzeria.city, countryCode: pizzeria.countryCode }
  if (result.decision === 'PENDING') {
    await prisma.pizzeriaCheckIn.create({ data: row(req, pizzeria.id, memberId, result, 'PENDING') })
    return { ok: true, decision: 'PENDING', newStamp: false, countsAsVisit: false, pizzeria: info }
  }

  await prisma.$transaction(async (tx) => {
    const c = await tx.pizzeriaCheckIn.create({ data: row(req, pizzeria.id, memberId, result, 'APPROVED') })
    await applyApproved(tx, {
      checkInId: c.id,
      discordId: req.discordId,
      memberId,
      pizzeriaId: pizzeria.id,
      countsAsVisit: result.countsAsVisit,
      at: now,
    })
  })
  return { ok: true, decision: 'APPROVED', newStamp: result.newStamp, countsAsVisit: result.countsAsVisit, pizzeria: info }
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
    lat: r.located?.lat ?? null,
    lng: r.located?.lng ?? null,
    accuracyM: r.accuracyM,
    distanceM: r.distanceM,
    riskFlags: (r.riskFlags.length ? (r.riskFlags as unknown as Prisma.InputJsonValue) : undefined),
  }
}

/** Admin: release (approve) or reject a held check-in. Approving grants the stamp. */
export async function reviewCheckIn(checkInId: number, reviewerId: string, approve: boolean, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.pizzeriaCheckIn.findUnique({ where: { id: checkInId } })
    if (!c || c.status !== 'PENDING') return { ok: false as const, reason: 'not_pending' as const }
    await tx.pizzeriaCheckIn.update({
      where: { id: c.id },
      data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedBy: reviewerId },
    })
    if (approve) {
      const existing = await tx.passportStamp.findUnique({
        where: { discordId_pizzeriaId: { discordId: c.discordId, pizzeriaId: c.pizzeriaId } },
        select: { lastVisitAt: true },
      })
      await applyApproved(tx, {
        checkInId: c.id,
        discordId: c.discordId,
        memberId: c.memberId,
        pizzeriaId: c.pizzeriaId,
        countsAsVisit: !existing,
        at: now,
      })
    }
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
