/**
 * Server side of the reach-map levels: read the settings, load the members' signals in bulk (about
 * five queries for the whole membership), and build the public payload. Everything after the load is
 * pure (places.ts, score.ts, aggregate.ts). Nothing returned here carries a name or an id.
 */
import { prisma } from '@/app/lib/db'
import { missionStatsFor } from '@/app/lib/missions'
import { cellText, getMembersSheet, MEMBER_COLUMNS, membersColumn } from '@/app/lib/sheets/member-repository'
import type { Settings } from '@/app/lib/settings'
import { buildPublicPayload } from './aggregate'
import mapCities from './map-cities.json'
import { buildPlaceIndex, resolvePlace } from './places'
import { memberScore } from './score'
import type { MapCity, MapLevelsConfig, PublicMapLevels, ScoredMember } from './types'

export const MAP_CITIES: readonly MapCity[] = (mapCities as unknown as { cities: MapCity[] }).cities

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

/** Every member's place and score. Members with no Discord id count toward a place but score 0. */
export async function loadScoredMembers(cfg: MapLevelsConfig): Promise<ScoredMember[]> {
  const table = await getMembersSheet()
  const cityCol = membersColumn(table, MEMBER_COLUMNS.city)
  const discordCol = membersColumn(table, MEMBER_COLUMNS.discordId)
  if (cityCol === null) throw new Error('Members table has no City column')

  const idx = buildPlaceIndex(MAP_CITIES, cfg.aliases)
  const rows = table.rows.map((r) => ({
    place: resolvePlace(cellText(r?.c?.[cityCol]), idx),
    discordId: discordCol === null ? '' : cellText(r?.c?.[discordCol]),
  }))
  // Only members who land somewhere need their signals.
  const ids = [...new Set(rows.filter((r) => r.place.kind !== 'unplaced' && r.discordId).map((r) => r.discordId))]
  const [stats, wallets] = await Promise.all([missionStatsFor(ids), walletsFor(ids)])

  return rows
    .filter((r) => r.place.kind !== 'unplaced')
    .map((r) => {
      const st = stats.get(r.discordId)
      return {
        place: r.place,
        score: memberScore(
          { hasDiscord: !!r.discordId, level: st?.level ?? 1, approvedMissions: st?.approvedMissions ?? 0, pep: wallets.get(r.discordId) ?? 0 },
          cfg,
        ),
      }
    })
}

let memo: { at: number; key: string; payload: PublicMapLevels } | null = null
const MEMO_MS = 5 * 60_000

/** The public payload for the saved settings (memoised for a few minutes per warm instance). */
export async function computePublicMapLevels(settings: Settings, now: number = Date.now()): Promise<PublicMapLevels> {
  const cfg = mapLevelsConfig(settings)
  const key = JSON.stringify(cfg)
  if (memo && memo.key === key && now - memo.at < MEMO_MS) return memo.payload
  const members = await loadScoredMembers(cfg)
  const payload = buildPublicPayload(members, MAP_CITIES, cfg, new Date(now))
  memo = { at: now, key, payload }
  return payload
}

export function clearMapLevelsMemo(): void {
  memo = null
}
