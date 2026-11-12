/**
 * Database side of proposal reminders (phase B2). Ballot secrecy rules, enforced by proposal-secrecy.test.ts:
 *  - this file and proposals.ts read ONLY ProposalVoter.discordId and ProposalVoter.tokenIssuedAt (day precision),
 *    Proposal fields and ReminderPref / ReminderSend. Never ProposalBallot, never the pending vote store.
 *  - the per-member send rows for a proposal are deleted when it stops being OPEN (settled or cancelled), leaving
 *    only aggregate counts on a ProposalEvent (REMINDERS_SENT {opened, closing}).
 */
import { prisma } from '@/app/lib/db'

export interface OpenProposalLite {
  id: string
  title: string
  isTest: boolean
  opensAt: Date | null
  closesAt: Date | null
  /** The voting key fingerprint (as in the channel post's link), or null. */
  fingerprint: string | null
}

export interface ProposalPrefLite {
  discordId: string
  opened: boolean
  closing: boolean
}

export interface ProposalReminderStore {
  /** Members who opted in to at least one kind of proposal reminder. */
  listProposalPrefs(): Promise<ProposalPrefLite[]>
  /** OPEN app proposals (test proposals included; the run decides who may see them). */
  listOpenProposals(): Promise<OpenProposalLite[]>
  /** The open snapshot's member ids. `noTokenOnly` keeps those whose tokenIssuedAt IS NULL (certainly not voted). */
  listVoters(proposalId: string, noTokenOnly: boolean): Promise<string[]>
}

export const PROPOSAL_KINDS = ['PROPOSAL_OPENED', 'PROPOSAL_CLOSING'] as const

export const prismaProposalStore: ProposalReminderStore = {
  async listProposalPrefs() {
    const rows = await prisma.reminderPref.findMany({
      where: { OR: [{ proposalOpened: true }, { proposalClosing: true }] },
      select: { discordId: true, proposalOpened: true, proposalClosing: true },
    })
    return rows.map((r) => ({ discordId: r.discordId, opened: r.proposalOpened, closing: r.proposalClosing }))
  },

  async listOpenProposals() {
    const rows = await prisma.proposal.findMany({
      where: { source: 'APP', status: 'OPEN' },
      select: { id: true, title: true, isTest: true, opensAt: true, closesAt: true, keyFingerprint: true },
    })
    return rows.map((r) => ({ id: r.id, title: r.title, isTest: r.isTest, opensAt: r.opensAt, closesAt: r.closesAt, fingerprint: r.keyFingerprint }))
  },

  async listVoters(proposalId, noTokenOnly) {
    const rows = await prisma.proposalVoter.findMany({
      where: { proposalId, ...(noTokenOnly ? { tokenIssuedAt: null } : {}) },
      select: { discordId: true },
    })
    return rows.map((r) => r.discordId)
  },
}

/**
 * Delete the per-member reminder rows of proposals that are no longer OPEN (or are gone), keeping aggregate
 * counts on a ProposalEvent. With `ids`, only those proposals are looked at. Best effort and idempotent: the
 * cron sweeps whatever a hook missed. Returns the number of rows deleted.
 */
export async function clearSettledProposalReminders(ids?: readonly string[]): Promise<number> {
  const rows = await prisma.reminderSend.findMany({
    where: { kind: { in: [...PROPOSAL_KINDS] }, ...(ids ? { refKey: { in: [...ids] } } : {}) },
    select: { refKey: true, kind: true, status: true },
  })
  if (!rows.length) return 0
  const refKeys = [...new Set(rows.map((r) => r.refKey))]
  const proposals = await prisma.proposal.findMany({ where: { id: { in: refKeys } }, select: { id: true, status: true } })
  const status = new Map(proposals.map((p) => [p.id, p.status]))
  const done = refKeys.filter((k) => status.get(k) !== 'OPEN')
  if (!done.length) return 0
  for (const id of done) {
    if (!status.has(id)) continue
    const mine = rows.filter((r) => r.refKey === id && r.status === 'SENT')
    const opened = mine.filter((r) => r.kind === 'PROPOSAL_OPENED').length
    const closing = mine.filter((r) => r.kind === 'PROPOSAL_CLOSING').length
    if (opened + closing > 0) {
      await prisma.proposalEvent.create({ data: { proposalId: id, type: 'REMINDERS_SENT', actorDiscordId: null, data: { opened, closing } } })
    }
  }
  const r = await prisma.reminderSend.deleteMany({ where: { kind: { in: [...PROPOSAL_KINDS] }, refKey: { in: done } } })
  return r.count
}

/** The lifecycle hook (settle, cancel): outside any transaction, never throws. */
export async function clearProposalReminders(proposalId: string): Promise<void> {
  try {
    await clearSettledProposalReminders([proposalId])
  } catch (e) {
    console.error('[reminders] clear proposal reminders failed:', (e as Error)?.name)
  }
}
