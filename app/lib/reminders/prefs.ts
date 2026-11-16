/**
 * A member's reminder preferences (ReminderPref). No row means no reminders. Calls: none, the Community Call, or
 * the Community Call plus the member's crews and the calls they marked Interested on Discord. How early (5 to 60
 * minutes, or the default) and where (Discord, Telegram or both) apply to calls. Proposals: one on/off choice,
 * over Discord.
 */
import { z } from 'zod'
import { prisma } from '@/app/lib/db'
import { clearDmBackoff, loadDmReach } from './reach'
import { LEAD_CHOICES } from './schedule'

const leadSchema = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)])

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
  })
  .strict()
  .refine((b) => b.calls !== undefined || b.leadMinutes !== undefined || b.channel !== undefined || b.retryDm === true || b.proposals !== undefined, {
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
  /** Discord refused our last DM (DMs from server members are off); the settings page says how to fix it. */
  dmClosed: boolean
}

export async function loadPrefsView(discordId: string): Promise<PrefsView> {
  const [row, reach, tg] = await Promise.all([
    prisma.reminderPref.findUnique({ where: { discordId }, select: { calls: true, callLeadMinutes: true, channel: true, proposalOpened: true, proposalClosing: true } }),
    loadDmReach(discordId).catch(() => null),
    prisma.telegramAccount.findUnique({ where: { discordId }, select: { id: true } }).catch(() => null),
  ])
  const calls = row && (CALL_CHOICES as readonly string[]).includes(row.calls) ? (row.calls as CallChoice) : 'NONE'
  const leadMinutes = row?.callLeadMinutes && (LEAD_CHOICES as readonly number[]).includes(row.callLeadMinutes) ? row.callLeadMinutes : null
  const channel: ChannelChoice = row?.channel === 'TELEGRAM' || row?.channel === 'BOTH' ? row.channel : 'DISCORD'
  return { calls, leadMinutes, channel, telegramLinked: !!tg, proposals: !!row && (row.proposalOpened || row.proposalClosing), dmClosed: reach?.state === 'CLOSED' }
}

export async function savePrefs(discordId: string, body: z.infer<typeof prefsBody>): Promise<PrefsView> {
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
