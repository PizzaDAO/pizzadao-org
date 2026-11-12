/**
 * The proposal part of the reminders run (phase B2), after the call reminders (which are time-critical).
 *
 *  - "Opened": once per proposal, to the open snapshot (ProposalVoter) members who opted in, from the first
 *    run after it opens until the closing window starts.
 *  - "Closing soon": once, inside the closing window, ONLY to snapshot members who opted in AND whose
 *    ballot token was never issued (tokenIssuedAt IS NULL, so they certainly have not voted). Members holding
 *    a token are never reminded: whether they voted is unknowable, and this code never tries to know.
 *  - Secrecy: reads only voter ids, tokenIssuedAt and Proposal fields. Never ballots, never pending votes
 *    (pinned by proposal-secrecy.test.ts). Per-member send rows are deleted when the proposal closes.
 *  - Nothing at all when proposals are disabled. A test proposal goes only to pilot testers.
 *
 * Same claim-before-send, dm-closed backoff, rate-limit and cap handling as the call run. Counts only.
 */
import { capDecision, DAY_MS } from '@/app/lib/followups/quiet-hours'
import { pilotAllows, type PilotState } from '@/app/lib/proposals/pilot-state'
import { deliverDm, reminderSendAllowed, type DmSender } from './deliver'
import { proposalClosingText, proposalOpenedText, proposalReminderComponents } from './messages'
import type { OpenProposalLite, ProposalReminderStore } from './proposal-store'
import { canTryDm, type DmReach } from './reach'
import { MAX_ATTEMPTS, type ReminderStore, type SendKind } from './store'

export interface ProposalRunConfig {
  enabled: boolean
  /** Setting reminders.proposalClosingHours. */
  closingHours: number
  /** What is left of reminders.maxSendsPerRun after the call reminders. */
  maxSends: number
  maxPerMemberPerDay: number
}

export interface ProposalRunResult {
  dryRun: boolean
  proposals: number
  /** (member, proposal, kind) pairs that are wanted. */
  due: number
  sent: number
  skipped: Record<string, number>
  retried: number
  failed: number
  stoppedEarly: boolean
}

export interface ProposalRunDeps {
  now: Date
  env: Record<string, string | undefined>
  config: ProposalRunConfig
  /** proposals.enabled (the voting switch). False: nothing is sent or counted. */
  proposalsOn: boolean
  pilot: PilotState
  siteUrl: string
  store: Pick<ReminderStore, 'sentSince' | 'claimCall' | 'markSent' | 'markSkipped' | 'release' | 'markFailed'> & ProposalReminderStore
  getReach: (discordId: string) => Promise<DmReach | null>
  setClosed: (discordId: string, prev: DmReach | null, now: Date) => Promise<void>
  setOk: (discordId: string, now: Date) => Promise<void>
  send: DmSender
  settingsUrl: (discordId: string) => Promise<string | null>
  sleep: (ms: number) => Promise<void>
}

const PACE_MS = 250
const HOUR_MS = 60 * 60 * 1000

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

/**
 * When the closing window starts: `closingHours` before the close, but never earlier than the middle of a short
 * window (a 60-minute test proposal still gets an "opened" DM before its "closing soon" one).
 */
export function closingStart(p: { opensAt: Date; closesAt: Date }, closingHours: number): Date {
  const span = p.closesAt.getTime() - p.opensAt.getTime()
  return new Date(p.closesAt.getTime() - Math.min(closingHours * HOUR_MS, Math.max(0, span) / 2))
}

/** Test proposals are shown only to pilot testers; everything else follows the pilot gate (fails closed). */
export function mayRemind(p: Pick<OpenProposalLite, 'isTest'>, discordId: string, pilot: PilotState): boolean {
  if (p.isTest) return pilot.running && !pilot.unknown && pilot.ids.includes(discordId)
  return pilotAllows(pilot, discordId)
}

export function proposalUrl(siteUrl: string, p: Pick<OpenProposalLite, 'id' | 'fingerprint'>): string {
  // The same link as the channel post, so the page checks the key against the fingerprint.
  return `${siteUrl}/proposals/${p.id}${p.fingerprint ? `?fp=${p.fingerprint.replace(/\s+/g, '')}` : ''}`
}

interface Pair {
  discordId: string
  p: OpenProposalLite & { opensAt: Date; closesAt: Date }
  kind: Extract<SendKind, 'PROPOSAL_OPENED' | 'PROPOSAL_CLOSING'>
}

export async function runProposalReminders(d: ProposalRunDeps): Promise<ProposalRunResult> {
  const { now, config } = d
  const dryRun = !config.enabled || !reminderSendAllowed(d.env)
  const res: ProposalRunResult = { dryRun, proposals: 0, due: 0, sent: 0, skipped: {}, retried: 0, failed: 0, stoppedEarly: false }
  if (!d.proposalsOn) {
    bump(res.skipped, 'proposals_off')
    return res
  }

  const prefs = await d.store.listProposalPrefs()
  if (!prefs.length) return res
  const wantsOpened = new Set(prefs.filter((x) => x.opened).map((x) => x.discordId))
  const wantsClosing = new Set(prefs.filter((x) => x.closing).map((x) => x.discordId))

  const open = (await d.store.listOpenProposals())
    .filter((p): p is OpenProposalLite & { opensAt: Date; closesAt: Date } => !!p.opensAt && !!p.closesAt && p.opensAt <= now && p.closesAt > now)
    .sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime())
  res.proposals = open.length

  const closingPairs: Pair[] = []
  const openedPairs: Pair[] = []
  for (const p of open) {
    const closing = now >= closingStart(p, config.closingHours)
    const wanted = closing ? wantsClosing : wantsOpened
    if (!wanted.size) continue
    // Closing: only members with no ballot token. Opened: the whole snapshot.
    const voters = await d.store.listVoters(p.id, closing)
    for (const id of voters) {
      if (!wanted.has(id)) continue
      if (!mayRemind(p, id, d.pilot)) {
        bump(res.skipped, 'pilot')
        continue
      }
      ;(closing ? closingPairs : openedPairs).push({ discordId: id, p, kind: closing ? 'PROPOSAL_CLOSING' : 'PROPOSAL_OPENED' })
    }
  }
  // Closing soon is time-critical; "opened" is not.
  const pairs = [...closingPairs, ...openedPairs]
  res.due = pairs.length
  if (dryRun || !pairs.length) return res

  const sentToday = await d.store.sentSince([...new Set(pairs.map((x) => x.discordId))], new Date(now.getTime() - DAY_MS))
  let first = true

  for (const { discordId: id, p, kind } of pairs) {
    if (res.sent >= config.maxSends) {
      res.stoppedEarly = true
      break
    }
    const reach = await d.getReach(id)
    if (!canTryDm(reach, now)) {
      bump(res.skipped, 'dm_closed')
      continue
    }
    const cap = capDecision(sentToday.get(id) ?? [], now, config.maxPerMemberPerDay)
    if (!cap.ok) {
      bump(res.skipped, 'cap')
      continue
    }
    const claim = await d.store.claimCall(id, p.id, kind)
    if (!claim.claimed) {
      bump(res.skipped, 'already')
      continue
    }

    if (!first) await d.sleep(PACE_MS)
    first = false

    const url = proposalUrl(d.siteUrl, p)
    const text = kind === 'PROPOSAL_CLOSING' ? proposalClosingText({ title: p.title, closesAt: p.closesAt, url }) : proposalOpenedText({ title: p.title, closesAt: p.closesAt, url })
    const components = proposalReminderComponents(await d.settingsUrl(id).catch(() => null))
    const outcome = await deliverDm({ discordId: id, text, components, send: d.send })

    switch (outcome.kind) {
      case 'sent':
        await d.store.markSent(id, p.id, kind)
        await d.setOk(id, now).catch(() => undefined)
        sentToday.set(id, [...(sentToday.get(id) ?? []), now])
        res.sent++
        break
      case 'closed':
        await d.store.markSkipped(id, p.id, 'dm_closed', kind)
        await d.setClosed(id, reach, now).catch(() => undefined)
        bump(res.skipped, 'dm_closed')
        break
      case 'rate_limited':
        await d.store.release(id, p.id, 'rate_limited', claim.attempts, false, kind)
        res.stoppedEarly = true
        return res
      case 'retry':
        if (claim.attempts + 1 >= MAX_ATTEMPTS) {
          await d.store.markFailed(id, p.id, outcome.code, kind)
          res.failed++
        } else {
          await d.store.release(id, p.id, outcome.code, claim.attempts, true, kind)
          res.retried++
        }
        break
      case 'failed':
        await d.store.markFailed(id, p.id, outcome.code, kind)
        res.failed++
        break
    }
  }
  return res
}
