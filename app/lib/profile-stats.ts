/**
 * The public stats of a member, for the Discord /profile command: only what their profile page
 * already shows (name, city, crews, level and title, vouch counts). Nothing level-gated
 * (budget, proposals, the disavow list) and nothing private (wallet, balance, email).
 */
import { fetchMemberByDiscordId, fetchMemberById } from '@/app/lib/sheets/member-repository'
import { getVouchCounts } from '@/app/lib/vouches'
import { getLevelInfo } from '@/app/lib/level-info'

export interface ProfileStats {
  memberId: string
  name: string
  city: string
  crews: string[]
  level: number
  levelTitle: string | null
  isMax: boolean
  vouchesReceived: number
  vouchesGiven: number
}

const splitCrews = (raw: unknown): string[] => {
  const s = String(raw ?? '').trim()
  return !s || s.toLowerCase() === 'none' ? [] : s.split(',').map((c) => c.trim()).filter(Boolean)
}

/** Null when the Discord user has no member profile. */
export async function getProfileStats(discordId: string): Promise<ProfileStats | null> {
  const member = await fetchMemberByDiscordId(discordId)
  if (!member) return null
  const [row, counts, level] = await Promise.all([
    fetchMemberById(member.memberId).catch(() => null),
    getVouchCounts(member.memberId).catch(() => ({ total: 0, followers: 0 })),
    getLevelInfo(discordId),
  ])
  return {
    memberId: member.memberId,
    name: member.name || 'PizzaDAO member',
    city: String(row?.['City'] ?? '').trim(),
    crews: splitCrews(row?.['Crews']),
    level: level.level,
    levelTitle: level.title,
    isMax: level.isMax,
    vouchesReceived: counts.followers,
    vouchesGiven: counts.total,
  }
}
