/**
 * Name reminders (admin-triggered only): lists members whose display name is not themed and DMs
 * selected ones the `members.nameReminderText` setting, at most once per cooldown. Never renames anyone.
 */
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { isThemedName } from '@/app/lib/themed-name'
import { sendDiscordDm } from '@/app/lib/followups/discord-dm'
import { isNonProductionDeploy } from '@/app/lib/admin-guard'

export interface NameReportRow {
  id: string
  name: string
  discordId: string | null
  lastReminderAt: string | null
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
  const last = new Map<string, Date>()
  if (ids.length) {
    const sent = await prisma.memberNameReminder.findMany({
      where: { discordId: { in: ids }, status: 'SENT' },
      select: { discordId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    for (const s of sent) last.set(s.discordId, s.createdAt)
  }
  const rows = bad.map((m): NameReportRow => {
    const at = m.discordId ? last.get(m.discordId) : undefined
    return {
      id: m.id,
      name: m.name,
      discordId: m.discordId,
      lastReminderAt: at ? at.toISOString() : null,
      coolingDown: !!at && now.getTime() - at.getTime() < cooldownDays * DAY_MS,
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

/** DM the selected member ids. Re-checks themed/cooldown server-side; previews never send. */
export async function sendNameReminders(memberIds: string[], actor: string, now = new Date()): Promise<SendResult> {
  const out: SendResult = { sent: [], skipped: [], failed: [] }
  if (isNonProductionDeploy()) {
    for (const id of memberIds) out.skipped.push({ id, reason: 'Previews never send' })
    return out
  }
  const [text, cooldownDays] = await Promise.all([getSetting('members.nameReminderText'), getSetting('members.nameReminderCooldownDays')])
  const members = await prisma.member.findMany({
    where: { id: { in: memberIds }, mergedInto: null },
    select: { id: true, name: true, discordId: true },
  })
  const byId = new Map(members.map((m) => [m.id, m]))
  for (const id of memberIds) {
    const m = byId.get(id)
    if (!m) { out.skipped.push({ id, reason: 'Not found' }); continue }
    if (!m.discordId) { out.skipped.push({ id, reason: 'No Discord id' }); continue }
    if (isThemedName((m.name ?? '').trim())) { out.skipped.push({ id, reason: 'Name is themed' }); continue }
    const since = new Date(now.getTime() - cooldownDays * DAY_MS)
    const recent = await prisma.memberNameReminder.findFirst({
      where: { discordId: m.discordId, status: 'SENT', createdAt: { gt: since } },
      select: { id: true },
    })
    if (recent) { out.skipped.push({ id, reason: 'Reminded within the cooldown' }); continue }
    try {
      await sendDiscordDm(m.discordId, text)
      await prisma.memberNameReminder.create({ data: { discordId: m.discordId, memberId: m.id, sentBy: actor, status: 'SENT' } })
      out.sent.push(id)
    } catch (e) {
      await prisma.memberNameReminder.create({ data: { discordId: m.discordId, memberId: m.id, sentBy: actor, status: 'FAILED' } }).catch(() => {})
      out.failed.push({ id, reason: e instanceof Error ? e.message : 'DM failed' })
    }
  }
  return out
}
