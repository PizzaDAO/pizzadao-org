/**
 * The real wiring of the nearby-invite run, used by the reminders cron: settings, the rsv.pizza feed, the
 * members table (cached, see member-repository), Discord and Telegram senders, in-app notifications.
 */
import { SITE_URL } from '@/app/lib/site-url'
import { sendDiscordDm } from '@/app/lib/followups/discord-dm'
import { createNotification, NotificationType } from '@/app/lib/notifications'
import mapCities from '@/app/lib/map-levels/map-cities.json'
import { buildPlaceIndex, resolvePlace } from '@/app/lib/map-levels/places'
import type { MapCity } from '@/app/lib/map-levels/types'
import { loadDmReach, recordDmClosed, recordDmOk } from '@/app/lib/reminders/reach'
import { reminderSendAllowed } from '@/app/lib/reminders/deliver'
import { cellText, getMembersSheet, MEMBER_COLUMNS, memberIdColumn, membersColumn } from '@/app/lib/sheets/member-repository'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { prisma } from '@/app/lib/db'
import { loadReach, recordResult } from '@/app/lib/telegram/reach'
import { sendDm } from '@/app/lib/telegram/rsv-client'
import { fetchUpcomingEvents } from './client'
import { runNearbyInvites, type InviteMember, type NearbyRunResult } from './run'
import { prismaNearbyStore, sweepOldNearbySends } from './store'

const CITIES = (mapCities as unknown as { cities: MapCity[] }).cities

/** One entry per Discord id (the first row wins) whose City resolves to a map city. Others are never invited. */
export async function loadInviteMembers(aliases: Parameters<typeof buildPlaceIndex>[1]): Promise<InviteMember[]> {
  const table = await getMembersSheet()
  const idCol = memberIdColumn(table)
  const cityCol = membersColumn(table, MEMBER_COLUMNS.city)
  const discordCol = membersColumn(table, MEMBER_COLUMNS.discordId)
  if (cityCol === null || discordCol === null) return []
  const idx = buildPlaceIndex(CITIES, aliases)
  const seen = new Set<string>()
  const out: InviteMember[] = []
  for (const r of table.rows) {
    const discordId = cellText(r?.c?.[discordCol])
    if (!discordId || seen.has(discordId)) continue
    seen.add(discordId)
    const place = resolvePlace(cellText(r?.c?.[cityCol]), idx)
    if (place.kind !== 'city') continue
    const city = idx.byKey.get(place.key)
    if (!city) continue
    const memberId = cellText(r?.c?.[idCol])
    if (!memberId) continue
    // Map coordinates are [lng, lat].
    out.push({ discordId, memberId, lat: city.coords[1], lng: city.coords[0], cityName: city.name })
  }
  return out
}

export async function runNearbyInvitesNow(
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
  opts: { dryRun?: boolean } = {},
): Promise<NearbyRunResult | { skipped: string }> {
  // Preview check first: a preview never reads settings or the database.
  const live = reminderSendAllowed(env) && (await toggleEnabled('reminders.nearbyEventsEnabled', env))
  if (!live && !opts.dryRun) return { skipped: 'disabled' }
  const settings = await loadSettings()
  const result = await runNearbyInvites({
    now,
    env,
    siteUrl: SITE_URL,
    config: {
      enabled: live && !opts.dryRun,
      match: {
        defaultRadiusKm: settings.get('reminders.nearbyDefaultRadiusKm'),
        citySlackKm: settings.get('reminders.nearbyCityLevelSlackKm'),
        minLeadHours: settings.get('reminders.nearbyMinLeadHours'),
        maxLeadDays: settings.get('reminders.nearbyMaxLeadDays'),
        maxPerWeek: settings.get('reminders.nearbyMaxPerWeek'),
        maxPerDay: settings.get('reminders.nearbyMaxPerDay'),
        kinds: settings.get('reminders.nearbyEventKinds'),
      },
      maxSends: settings.get('reminders.nearbyMaxSendsPerRun'),
      quiet: {
        startHour: settings.get('followups.quietStartHour'),
        endHour: settings.get('followups.quietEndHour'),
        unknownTzStartHour: settings.get('followups.unknownTzStartHour'),
        unknownTzEndHour: settings.get('followups.unknownTzEndHour'),
      },
      telegramRecheck: { dmRecheckDays: settings.get('telegram.dmRecheckDays'), dmRecheckMaxDays: settings.get('telegram.dmRecheckMaxDays') },
    },
    fetchEvents: (until) => fetchUpcomingEvents({ baseUrl: settings.get('profile.eventsAttended.rsvApiUrl'), until, env: env as NodeJS.ProcessEnv }),
    loadMembers: () => loadInviteMembers(settings.get('map.placeAliases')),
    store: prismaNearbyStore,
    getReach: loadDmReach,
    setClosed: recordDmClosed,
    setOk: recordDmOk,
    send: (id, text, o) => sendDiscordDm(id, text, o),
    getTelegram: async (discordId) => {
      const acct = await prisma.telegramAccount.findUnique({ where: { discordId }, select: { telegramId: true } })
      return acct ? { telegramId: acct.telegramId, reach: await loadReach(acct.telegramId) } : null
    },
    sendTelegram: (a) => sendDm(a),
    recordTelegramReach: (telegramId, code, cfg, at) => recordResult(telegramId, code, cfg, at),
    notify: async (o) => {
      await createNotification({
        type: NotificationType.NEARBY_EVENT,
        recipientId: o.discordId,
        title: o.title,
        message: o.message,
        linkUrl: o.linkUrl,
        metadata: { eventId: o.eventId },
      })
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  if (reminderSendAllowed(env)) await sweepOldNearbySends(now).catch(() => 0)
  return result
}
