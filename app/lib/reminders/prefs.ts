/**
 * A member's reminder preferences (ReminderPref). No row means no reminders. Calls: none, the Community Call, or
 * the Community Call plus the member's crews. Proposals: one on/off choice. Both over Discord.
 */
import { z } from 'zod'
import { prisma } from '@/app/lib/db'
import { clearDmBackoff, loadDmReach } from './reach'

export const CALL_CHOICES = ['NONE', 'COMMUNITY', 'MY_CREWS'] as const
export type CallChoice = (typeof CALL_CHOICES)[number]

export const prefsBody = z
  .object({
    calls: z.enum(CALL_CHOICES).optional(),
    /** "Try again" after Discord DMs turned out to be closed. */
    retryDm: z.boolean().optional(),
    /** Proposal reminders (a new proposal opens, and closing soon) on or off. Both kinds move together. */
    proposals: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.calls !== undefined || b.retryDm === true || b.proposals !== undefined, { message: 'nothing to update' })

export interface PrefsView {
  calls: CallChoice
  /** Opted in to proposal reminders. */
  proposals: boolean
  /** Discord refused our last DM (DMs from server members are off); the settings page says how to fix it. */
  dmClosed: boolean
}

export async function loadPrefsView(discordId: string): Promise<PrefsView> {
  const [row, reach] = await Promise.all([
    prisma.reminderPref.findUnique({ where: { discordId }, select: { calls: true, proposalOpened: true, proposalClosing: true } }),
    loadDmReach(discordId).catch(() => null),
  ])
  const calls = row && (CALL_CHOICES as readonly string[]).includes(row.calls) ? (row.calls as CallChoice) : 'NONE'
  return { calls, proposals: !!row && (row.proposalOpened || row.proposalClosing), dmClosed: reach?.state === 'CLOSED' }
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
