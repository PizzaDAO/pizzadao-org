/**
 * A member's reminder preferences (ReminderPref). No row means no reminders. Calls: none, the Community Call, or
 * the Community Call plus the member's crews and the calls they marked Interested on Discord. How early (5 to 60
 * minutes, or the default) and where (Discord, Telegram or both) apply to calls. Proposals: one on/off choice,
 * over Discord. Nearby pizza-party invites are the one OPT-OUT kind: on unless turned off, with a radius.
 */
import { z } from 'zod'
import { prisma } from '@/app/lib/db'
import { clearDmBackoff, loadDmReach } from './reach'
import { LEAD_CHOICES } from './schedule'

const leadSchema = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)])

export const NEARBY_RADIUS_CHOICES = [10, 25, 50, 100, 250] as const
const radiusSchema = z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100), z.literal(250)])

export const CALL_CHOICES = ['NONE', 'COMMUNITY', 'MY_CREWS'] as const
export type CallChoice = (typeof CALL_CHOICES)[number]

export const CHANNEL_CHOICES = ['DISCORD', 'TELEGRAM', 'BOTH'] as const
export type ChannelChoice = (typeof CHANNEL_CHOICES)[number]

export const prefsBody = z
  .object({
    calls: z.enum(CALL_CHOICES).optional(),
    /** Minutes before a call: 5, 10, 15, 30 or 60; null uses the default. */
    leadMinutes: leadSchema.nullable().optional(),
    /** Where call reminders go. */
    channel: z.enum(CHANNEL_CHOICES).optional(),
    /** "Try again" after Discord DMs turned out to be closed. */
    retryDm: z.boolean().optional(),
    /** Proposal reminders (a new proposal opens, and closing soon) on or off. Both kinds move together. */
    proposals: z.boolean().optional(),
    /** Nearby pizza-party invites (opt-out: on unless turned off). */
    nearbyEvents: z.boolean().optional(),
    /** How far from the member's city: 10, 25, 50, 100 or 250 km; null uses the default. */
    nearbyRadiusKm: radiusSchema.nullable().optional(),
  })
  .strict()
  .refine((b) => b.calls !== undefined || b.leadMinutes !== undefined || b.channel !== undefined || b.retryDm === true || b.proposals !== undefined || b.nearbyEvents !== undefined || b.nearbyRadiusKm !== undefined, {
    message: 'nothing to update',
  })

export interface PrefsView {
  calls: CallChoice
  /** Minutes before a call; null is the default. */
  leadMinutes: number | null
  /** Where call reminders go (the stored AUTO reads as DISCORD). */
  channel: ChannelChoice
  /** The member has a Telegram account linked (needed for the Telegram choices). */
  telegramLinked: boolean
  /** Opted in to proposal reminders. */
  proposals: boolean
  /** Nearby pizza-party invites are on (the default: no row means on). */
  nearbyEvents: boolean
  /** The member's own radius in km; null is the default. */
  nearbyRadiusKm: number | null
  /** Discord refused our last DM (DMs from server members are off); the settings page says how to fix it. */
  dmClosed: boolean
}

export async function loadPrefsView(discordId: string): Promise<PrefsView> {
  const [row, reach, tg] = await Promise.all([
    prisma.reminderPref.findUnique({ where: { discordId }, select: { calls: true, callLeadMinutes: true, channel: true, proposalOpened: true, proposalClosing: true, nearbyEvents: true, nearbyRadiusKm: true } }),
    loadDmReach(discordId).catch(() => null),
    prisma.telegramAccount.findUnique({ where: { discordId }, select: { id: true } }).catch(() => null),
  ])
  const calls = row && (CALL_CHOICES as readonly string[]).includes(row.calls) ? (row.calls as CallChoice) : 'NONE'
  const leadMinutes = row?.callLeadMinutes && (LEAD_CHOICES as readonly number[]).includes(row.callLeadMinutes) ? row.callLeadMinutes : null
  const channel: ChannelChoice = row?.channel === 'TELEGRAM' || row?.channel === 'BOTH' ? row.channel : 'DISCORD'
  const nearbyRadiusKm = row?.nearbyRadiusKm && (NEARBY_RADIUS_CHOICES as readonly number[]).includes(row.nearbyRadiusKm) ? row.nearbyRadiusKm : null
  return {
    calls,
    leadMinutes,
    channel,
    telegramLinked: !!tg,
    proposals: !!row && (row.proposalOpened || row.proposalClosing),
    nearbyEvents: row ? row.nearbyEvents : true,
    nearbyRadiusKm,
    dmClosed: reach?.state === 'CLOSED',
  }
}

/** A request the member cannot have: `telegram_not_linked` (Telegram chosen without a linked account). */
export class PrefsError extends Error {
  constructor(readonly code: 'telegram_not_linked') {
    super(code)
  }
}

export async function savePrefs(discordId: string, body: z.infer<typeof prefsBody>): Promise<PrefsView> {
  if (body.channel === 'TELEGRAM' || body.channel === 'BOTH') {
    const tg = await prisma.telegramAccount.findUnique({ where: { discordId }, select: { id: true } })
    if (!tg) throw new PrefsError('telegram_not_linked')
  }
  if (body.calls !== undefined) {
    await prisma.reminderPref.upsert({
      where: { discordId },
      create: { discordId, calls: body.calls },
      update: { calls: body.calls },
    })
    // Opting in again is also a request to try again.
    if (body.calls !== 'NONE') await clearDmBackoff(discordId)
  }
  if (body.leadMinutes !== undefined || body.channel !== undefined) {
    const data = {
      ...(body.leadMinutes !== undefined ? { callLeadMinutes: body.leadMinutes } : {}),
      ...(body.channel !== undefined ? { channel: body.channel } : {}),
    }
    await prisma.reminderPref.upsert({ where: { discordId }, create: { discordId, ...data }, update: data })
  }
  if (body.proposals !== undefined) {
    await prisma.reminderPref.upsert({
      where: { discordId },
      create: { discordId, proposalOpened: body.proposals, proposalClosing: body.proposals },
      update: { proposalOpened: body.proposals, proposalClosing: body.proposals },
    })
    if (body.proposals) await clearDmBackoff(discordId)
  }
  if (body.nearbyEvents !== undefined || body.nearbyRadiusKm !== undefined) {
    const data = {
      ...(body.nearbyEvents !== undefined ? { nearbyEvents: body.nearbyEvents } : {}),
      ...(body.nearbyRadiusKm !== undefined ? { nearbyRadiusKm: body.nearbyRadiusKm } : {}),
    }
    await prisma.reminderPref.upsert({ where: { discordId }, create: { discordId, ...data }, update: data })
    if (body.nearbyEvents) await clearDmBackoff(discordId)
  }
  if (body.retryDm) await clearDmBackoff(discordId)
  return loadPrefsView(discordId)
}

/** The Stop button on a DM: turns call reminders off, and only that. Nothing is created for someone with no row. */
export async function stopCallReminders(discordId: string): Promise<void> {
  await prisma.reminderPref.updateMany({ where: { discordId }, data: { calls: 'NONE' } })
}

/** The Stop button on a proposal DM: turns proposal reminders off, and only that. */
export async function stopProposalReminders(discordId: string): Promise<void> {
  await prisma.reminderPref.updateMany({ where: { discordId }, data: { proposalOpened: false, proposalClosing: false } })
}

/**
 * The Stop button on a nearby-event DM: turns nearby invites off. Invites are opt-out, so most members have no
 * row yet: this creates one (nearbyEvents false, everything else the default) and touches nothing else.
 */
export async function stopNearbyInvites(discordId: string): Promise<void> {
  await prisma.reminderPref.upsert({ where: { discordId }, create: { discordId, nearbyEvents: false }, update: { nearbyEvents: false } })
}
