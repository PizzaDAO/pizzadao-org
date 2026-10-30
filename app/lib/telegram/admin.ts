/**
 * Data for the /admin/telegram page: the outbox, the rsv.pizza city directory and warnings about
 * configured city keys that cannot be posted to.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { describeToggle } from '@/app/lib/settings/toggles'
import { parseCityKeys } from '@/app/lib/settings/telegram-settings'
import { cityGroups, rsvTelegramConfigured, telegramSendsKilled, telegramSendAllowed, type CityGroup, type ProxyReason } from './rsv-client'

const DIRECTORY_TTL_MS = 5 * 60 * 1000
let cache: { at: number; groups: CityGroup[] } | null = null

export function resetDirectoryCache(): void {
  cache = null
}

export type Directory = { ok: true; groups: CityGroup[] } | { ok: false; reason: ProxyReason }

export async function loadDirectory(now: number = Date.now()): Promise<Directory> {
  if (cache && now - cache.at < DIRECTORY_TTL_MS) return { ok: true, groups: cache.groups }
  const r = await cityGroups()
  if (r.ok) cache = { at: now, groups: r.groups }
  return r
}

export interface ConfigWarning {
  source: 'crew' | 'announce'
  /** The crew id for source 'crew'. */
  crewId?: string
  cityKey: string
  problem: 'unknown' | 'no_chat'
}

/** Configured city keys that are not in the directory, or whose group has no chat yet. */
export function configWarnings(
  crewRows: Array<{ crewId: string; cityKeys: string }>,
  announceKeys: string[],
  groups: CityGroup[],
): ConfigWarning[] {
  const byKey = new Map(groups.map((g) => [g.cityKey.toLowerCase(), g]))
  const out: ConfigWarning[] = []
  const check = (source: 'crew' | 'announce', cityKey: string, crewId?: string) => {
    const g = byKey.get(cityKey)
    if (!g) out.push({ source, crewId, cityKey, problem: 'unknown' })
    else if (!g.hasChat) out.push({ source, crewId, cityKey, problem: 'no_chat' })
  }
  for (const r of crewRows) for (const k of parseCityKeys(r.cityKeys)) check('crew', k, r.crewId)
  for (const k of announceKeys) check('announce', k)
  return out
}

export async function loadAdminOverview() {
  const [settings, rows, directory] = await Promise.all([
    loadSettings(),
    prisma.telegramGroupPost.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    loadDirectory(),
  ])
  const toggles = {
    cityPosts: describeToggle('telegram.cityPostsEnabled', settings),
    recap: describeToggle('telegram.recapMirrorEnabled', settings),
    agenda: describeToggle('telegram.agendaMirrorEnabled', settings),
    announce: describeToggle('telegram.announceMirrorEnabled', settings),
  }
  const hostMatchToggle = describeToggle('telegram.hostMatchEnabled', settings)
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))
  const [matchGroups, checkedToday] = await Promise.all([
    prisma.telegramHostMatch.groupBy({ by: ['consent'], _count: { _all: true } }).catch(() => []),
    prisma.telegramHostMatchCheck.count({ where: { checkedAt: { gte: dayStart } } }).catch(() => 0),
  ])
  const matchCount = (c: string) => matchGroups.find((g) => g.consent === c)?._count._all ?? 0
  const crewRows = settings.get('telegram.crewCityGroups') as Array<{ crewId: string; cityKeys: string }>
  const announceKeys = settings.get('telegram.announceCityKeys') as string[]
  return {
    status: {
      keyConfigured: rsvTelegramConfigured(),
      killed: telegramSendsKilled(),
      sendAllowed: telegramSendAllowed(),
      production: process.env.VERCEL_ENV === 'production',
      cityPostsOn: toggles.cityPosts.effective,
      recapOn: toggles.recap.effective,
      agendaOn: toggles.agenda.effective,
      announceOn: toggles.announce.effective,
      directory: directory.ok ? 'ok' : directory.reason,
    },
    // Counts only: no ids, handles or member names.
    hostMatch: {
      on: hostMatchToggle.effective,
      mode: settings.get('telegram.hostMatchMode') as number,
      checkedToday,
      dailyBudget: settings.get('telegram.hostMatchDailyHashes') as number,
      counts: { pending: matchCount('PENDING'), invited: matchCount('INVITED'), confirmed: matchCount('CONFIRMED'), declined: matchCount('DECLINED') },
    },
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      crewId: r.crewId,
      cityKey: r.cityKey,
      text: r.text,
      status: r.status,
      code: r.code,
      attempts: r.attempts,
      createdAt: r.createdAt.toISOString(),
      sendAfter: r.sendAfter?.toISOString() ?? null,
      sentAt: r.sentAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
    })),
    directory: directory.ok
      ? directory.groups.map((g) => ({ cityKey: g.cityKey, title: g.title, country: g.country, region: g.region, hasChat: g.hasChat }))
      : [],
    warnings: directory.ok ? configWarnings(crewRows, announceKeys, directory.groups) : [],
  }
}

/** Skip a row that has not been sent. Returns false when it is not PENDING. */
export async function skipPost(id: string): Promise<boolean> {
  const r = await prisma.telegramGroupPost.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'SKIPPED', code: 'manual', claimedAt: null },
  })
  return r.count === 1
}
