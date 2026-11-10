/**
 * Server side of the reach-map levels: read the settings, load the members' signals in bulk (about
 * five queries for the whole membership), and build the public payload. Everything after the load is
 * pure (places.ts, score.ts, aggregate.ts). Nothing the public route returns carries a name or an id.
 */
import { prisma } from '@/app/lib/db'
import { missionStatsFor } from '@/app/lib/missions'
import { cellText, getMembersSheet, MEMBER_COLUMNS, membersColumn } from '@/app/lib/sheets/member-repository'
import type { Settings } from '@/app/lib/settings'
import { buildPublicPayload } from './aggregate'
import mapCities from './map-cities.json'
import { buildPlaceIndex, placeParts, resolvePlace } from './places'
import { buildAdminPreview, type AdminPreview, type PreviewRow } from './preview'
import { memberScore } from './score'
import type { MapCity, MapLevelsConfig, PublicMapLevels } from './types'

export const MAP_CITIES: readonly MapCity[] = (mapCities as unknown as { cities: MapCity[] }).cities
export const MAP_CITIES_SYNCED: string = (mapCities as unknown as { syncedAt: string }).syncedAt

export function mapLevelsConfig(s: Settings): MapLevelsConfig {
  return {
    weightLevel: s.get('map.weightLevel'),
    weightMission: s.get('map.weightMission'),
    missionCap: s.get('map.missionCap'),
    weightPep: s.get('map.weightPep'),
    pepCap: s.get('map.pepCap'),
    scoreCap: s.get('map.scoreCap'),
    minMembersCity: s.get('map.minMembersCity'),
    minMembersCountry: s.get('map.minMembersCountry'),
    tiers: s.get('map.tiers'),
    buckets: s.get('map.memberCountBuckets').map(Number).sort((a, b) => a - b),
    aliases: s.get('map.placeAliases'),
  }
}

async function walletsFor(discordIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < discordIds.length; i += 1000) {
    const rows = await prisma.economy.findMany({ where: { id: { in: discordIds.slice(i, i + 1000) } }, select: { id: true, wallet: true } })
    for (const r of rows ?? []) out.set(r.id, r.wallet)
  }
  return out
}

/**
 * One row per member (a Discord id appears once: the first row wins) with the place the City value
 * resolves to and the member's score. Members with no Discord id count toward a place but score 0.
 * `raw` is the typed City text: admin use only.
 */
export async function loadRows(cfg: MapLevelsConfig): Promise<PreviewRow[]> {
  const table = await getMembersSheet()
  const cityCol = membersColumn(table, MEMBER_COLUMNS.city)
  const discordCol = membersColumn(table, MEMBER_COLUMNS.discordId)
  if (cityCol === null) throw new Error('Members table has no City column')

  const idx = buildPlaceIndex(MAP_CITIES, cfg.aliases)
  const seenIds = new Set<string>()
  const rows: Array<Omit<PreviewRow, 'score'>> = []
  for (const r of table.rows) {
    const discordId = discordCol === null ? '' : cellText(r?.c?.[discordCol])
    if (discordId) {
      if (seenIds.has(discordId)) continue
      seenIds.add(discordId)
    }
    const text = cellText(r?.c?.[cityCol])
    rows.push({ raw: placeParts(text).join(', '), place: resolvePlace(text, idx), discordId })
  }
  // Only members who land somewhere need their signals.
  const ids = rows.filter((r) => r.place.kind !== 'unplaced' && r.discordId).map((r) => r.discordId)
  const [stats, wallets] = await Promise.all([missionStatsFor(ids), walletsFor(ids)])

  return rows.map((r) => {
    if (r.place.kind === 'unplaced') return { ...r, score: 0 }
    const st = stats.get(r.discordId)
    const score = memberScore(
      { hasDiscord: !!r.discordId, level: st?.level ?? 1, approvedMissions: st?.approvedMissions ?? 0, pep: wallets.get(r.discordId) ?? 0 },
      cfg,
    )
    return { ...r, score }
  })
}

const publicOf = (rows: PreviewRow[], cfg: MapLevelsConfig, now: number): PublicMapLevels =>
  buildPublicPayload(
    rows.filter((r) => r.place.kind !== 'unplaced').map((r) => ({ place: r.place, score: r.score, discordId: r.discordId || undefined })),
    MAP_CITIES,
    cfg,
    new Date(now),
  )

let memo: { at: number; key: string; payload: PublicMapLevels } | null = null
const MEMO_MS = 5 * 60_000

/** The public payload for the saved settings (memoised for a few minutes per warm instance). */
export async function computePublicMapLevels(settings: Settings, now: number = Date.now()): Promise<PublicMapLevels> {
  const cfg = mapLevelsConfig(settings)
  const key = JSON.stringify(cfg)
  if (memo && memo.key === key && now - memo.at < MEMO_MS) return memo.payload
  const payload = publicOf(await loadRows(cfg), cfg, now)
  memo = { at: now, key, payload }
  return payload
}

/** Admin preview with the saved settings, whether or not the public switch is on. Raw numbers and typed City text: admin only. */
export async function computeAdminPreview(settings: Settings): Promise<AdminPreview> {
  const cfg = mapLevelsConfig(settings)
  return buildAdminPreview(await loadRows(cfg), MAP_CITIES, cfg, MAP_CITIES_SYNCED)
}

export function clearMapLevelsMemo(): void {
  memo = null
}
