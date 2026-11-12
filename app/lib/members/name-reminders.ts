/**
 * Name reminders (admin-triggered only): lists members whose display name is not themed and DMs
 * selected ones the `members.nameReminderText` setting, at most once per cooldown. Never renames anyone.
 */
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { isThemedName } from '@/app/lib/themed-name'
import { deliverDm, type DmOutcome } from '@/app/lib/reminders/deliver'
import { isNonProductionDeploy } from '@/app/lib/admin-guard'

export interface NameReportRow {
  id: string
  name: string
  discordId: string | null
  lastReminderAt: string | null
  /** Last attempt: SENT | CLOSED (DMs closed) | FAILED | SENDING. */
  lastStatus: string | null
  /** True while the cooldown blocks another reminder. */
  coolingDown: boolean
}

export interface NameReport {
  total: number
  nonThemed: number
  withoutDiscord: number
  cooldownDays: number
  rows: NameReportRow[]
}

const DAY_MS = 86_400_000
/** Most members per request, and the pause between DMs (like the reminders scheduler). */
export const MAX_PER_REQUEST = 20
const PACE_MS = 250
const TIME_BUDGET_MS = 100_000
/** Statuses that block another reminder within the cooldown (CLOSED backs off like a sent one). */
const BLOCKING = ['SENT', 'SENDING', 'CLOSED']

export async function buildNameReport(now = new Date()): Promise<NameReport> {
  const cooldownDays = await getSetting('members.nameReminderCooldownDays')
  const members = await prisma.member.findMany({
    where: { mergedInto: null },
    select: { id: true, name: true, discordId: true },
  })
  const bad = members.filter((m) => {
    const n = (m.name ?? '').trim()
    return n !== '' && !isThemedName(n)
  })
  const ids = bad.map((m) => m.discordId).filter((d): d is string => !!d)
  const last = new Map<string, { at: Date; status: string }>()
  if (ids.length) {
    const sent = await prisma.memberNameReminder.findMany({
      where: { discordId: { in: ids } },
      select: { discordId: true, createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    })
    for (const s of sent) last.set(s.discordId, { at: s.createdAt, status: s.status })
  }
  const rows = bad.map((m): NameReportRow => {
    const l = m.discordId ? last.get(m.discordId) : undefined
    const at = l?.at
    return {
      id: m.id,
      name: m.name,
      discordId: m.discordId,
      lastReminderAt: at ? at.toISOString() : null,
      lastStatus: l?.status ?? null,
      coolingDown: !!l && BLOCKING.includes(l.status) && now.getTime() - l.at.getTime() < cooldownDays * DAY_MS,
    }
  })
  return {
    total: members.length,
    nonThemed: bad.length,
    withoutDiscord: bad.filter((m) => !m.discordId).length,
    cooldownDays,
    rows,
  }
}

export interface SendResult {
  sent: string[]
  skipped: Array<{ id: string; reason: string }>
  failed: Array<{ id: string; reason: string }>
}

const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'

/**
 * DM the selected member ids (at most MAX_PER_REQUEST). Claim-first: a SENDING row (unique per discordId
 * per cooldown window) is written before the DM, then updated to SENT / CLOSED / FAILED, so concurrent
 * sends cannot double-DM and a DB blip after a send cannot lose the cooldown. Re-checks themed and
 * cooldown server-side; previews never send. A 429 stops the batch.
 */
export async function sendNameReminders(
  memberIds: string[],
  actor: string,
  now = new Date(),
  deps: { send?: typeof deliverDm; sleep?: (ms: number) => Promise<void>; clock?: () => number } = {},
): Promise<SendResult> {
  const out: SendResult = { sent: [], skipped: [], failed: [] }
  if (isNonProductionDeploy()) {
    for (const id of memberIds) out.skipped.push({ id, reason: 'Previews never send' })
    return out
  }
  const send = deps.send ?? deliverDm
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const clock = deps.clock ?? Date.now
  const started = clock()
  const batch = memberIds.slice(0, MAX_PER_REQUEST)
  for (const id of memberIds.slice(MAX_PER_REQUEST)) out.skipped.push({ id, reason: `Over the ${MAX_PER_REQUEST} per request cap` })

  const [text, cooldownDays] = await Promise.all([getSetting('members.nameReminderText'), getSetting('members.nameReminderCooldownDays')])
  const members = await prisma.member.findMany({
    where: { id: { in: batch }, mergedInto: null },
    select: { id: true, name: true, discordId: true },
  })
  const byId = new Map(members.map((m) => [m.id, m]))
  const windowMs = cooldownDays * DAY_MS
  let stop: string | null = null
  let first = true
  for (const id of batch) {
    if (stop) { out.skipped.push({ id, reason: stop }); continue }
    if (clock() - started > TIME_BUDGET_MS) { stop = 'Not sent (time limit)'; out.skipped.push({ id, reason: stop }); continue }
    const m = byId.get(id)
    if (!m) { out.skipped.push({ id, reason: 'Not found' }); continue }
    if (!m.discordId) { out.skipped.push({ id, reason: 'No Discord id' }); continue }
    if (isThemedName((m.name ?? '').trim())) { out.skipped.push({ id, reason: 'Name is themed' }); continue }
    const recent = await prisma.memberNameReminder.findFirst({
      where: { discordId: m.discordId, status: { in: BLOCKING }, createdAt: { gt: new Date(now.getTime() - windowMs) } },
      select: { status: true },
    })
    if (recent) { out.skipped.push({ id, reason: recent.status === 'CLOSED' ? 'DMs closed (backing off)' : 'Reminded within the cooldown' }); continue }

    let claim: { id: string }
    try {
      claim = await prisma.memberNameReminder.create({
        data: { discordId: m.discordId, memberId: m.id, sentBy: actor, status: 'SENDING', claimKey: `${m.discordId}:${Math.floor(now.getTime() / windowMs)}` },
        select: { id: true },
      })
    } catch (e) {
      out.skipped.push({ id, reason: isUniqueViolation(e) ? 'Already being sent' : 'Could not claim' })
      continue
    }
    if (!first) await sleep(PACE_MS)
    first = false
    const outcome: DmOutcome = await send({ discordId: m.discordId, text })
    // Settle the claim; a failed update must not hide the send, so it is only logged.
    const settle = (status: string, release: boolean) =>
      prisma.memberNameReminder
        .update({ where: { id: claim.id }, data: { status, ...(release ? { claimKey: null } : {}) } })
        .catch((e: unknown) => console.error('[name-reminders] could not settle claim', e instanceof Error ? e.message : e))
    switch (outcome.kind) {
      case 'sent':
        await settle('SENT', false)
        out.sent.push(id)
        break
      case 'closed':
        await settle('CLOSED', false)
        out.skipped.push({ id, reason: 'DMs closed' })
        break
      case 'rate_limited':
        await settle('FAILED', true)
        stop = 'Not sent (rate limited)'
        out.skipped.push({ id, reason: stop })
        break
      default:
        await settle('FAILED', true)
        out.failed.push({ id, reason: outcome.code })
    }
  }
  return out
}
