/**
 * The lean public card printed on a name tag. Built field by field from an allow-list (never by spreading
 * a member row). Everything here is already shown on the member's public profile. No Discord id, email,
 * wallet or other contact field, no mafia rank, no Discord activity.
 */
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { getUserProgressSummary } from '@/app/lib/missions'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { normalizeCrewId, withoutNonCrewIds } from '@/app/lib/crew-id'
import { disavowEnabled } from '@/app/lib/disavow/constants'
import { isDisavowSubject } from '@/app/lib/disavow/access'
import { getSetting } from '@/app/lib/settings'
import { resolvePfpsAbsolute } from './pfp'

export interface NametagMember {
  memberId: string
  name: string
  pfpUrl: string
  crews?: { id: string; label: string; emoji?: string }[]
  city?: string
  levelCompleted?: number
  levelTitle?: string
}

/** Exactly these keys may appear on a member (the optional ones only when their field setting is on). Asserted in tests. */
export const NAMETAG_MEMBER_KEYS = ['memberId', 'name', 'pfpUrl', 'crews', 'city', 'levelCompleted', 'levelTitle'] as const

export interface NametagFields {
  city: boolean
  crews: boolean
  level: boolean
  maxCrews: number
}

type Crew = { id: string; label?: string; emoji?: string; type?: string | null }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
  }
}

export async function loadNametagFields(): Promise<NametagFields> {
  const [city, crews, level, maxCrews] = await Promise.all([
    getSetting('nametags.fields.city'),
    getSetting('nametags.fields.crews'),
    getSetting('nametags.fields.level'),
    getSetting('nametags.maxCrews'),
  ])
  return { city: city === 1, crews: crews === 1, level: level === 1, maxCrews }
}

/** A disavowed member is skipped (fails closed when the check errors). */
async function isHidden(discordId: string): Promise<boolean | 'error'> {
  if (!discordId) return false
  if (!(await disavowEnabled().catch(() => false))) return false
  return isDisavowSubject(discordId).catch(() => 'error' as const)
}

/** `cache: false` marks a transient failure (lookup error): the answer is not remembered. */
type Composed = { card: NametagMember | null; cache: boolean }

async function composeOne(memberId: string, fields: NametagFields, pfp: string, crews: Crew[]): Promise<Composed> {
  let member: unknown
  try {
    member = await fetchMemberById(memberId)
  } catch {
    return { card: null, cache: false }
  }
  if (!member) return { card: null, cache: true }
  const m = member as unknown as Record<string, unknown>
  const discordId = text(m['discordId'])
  const hidden = await isHidden(discordId)
  if (hidden === 'error') return { card: null, cache: false }
  if (hidden) return { card: null, cache: true }

  const card: NametagMember = {
    memberId,
    name: text(m['Name']) || text(m['Mafia Name']) || 'Anonymous Pizza Maker',
    pfpUrl: pfp,
  }
  if (fields.city) {
    const city = text(m['City'])
    if (city) card.city = city
  }
  if (fields.crews && fields.maxCrews > 0) {
    const ids = text(m['Crews'])
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c && c.toLowerCase() !== 'none')
    // The sheet cell holds ids or free-text labels; match either, in either case.
    const byKey = new Map<string, Crew>()
    for (const c of crews) {
      byKey.set(normalizeCrewId(c.id), c)
      if (c.label) byKey.set(normalizeCrewId(c.label), c)
    }
    card.crews = withoutNonCrewIds(ids, crews)
      .slice(0, fields.maxCrews)
      .map((raw) => {
        const c = byKey.get(normalizeCrewId(raw))
        return { id: c?.id ?? raw, label: c?.label || raw, ...(c?.emoji ? { emoji: c.emoji } : {}) }
      })
  }
  if (fields.level && discordId) {
    const mission = await safe(getUserProgressSummary(discordId), null)
    if (mission && typeof mission.completed === 'number') {
      card.levelCompleted = mission.completed
      card.levelTitle = mission.completedTitle ?? ''
    }
  }
  return { card, cache: true }
}

const CONCURRENCY = 6
const CACHE = new Map<string, { time: number; fieldsKey: string; card: NametagMember | null }>()
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 1000

export function __resetNametagCardCache() {
  CACHE.clear()
}

/** Cards for these members (unknown or disavowed ones are left out). Bounded concurrency, cached 5 minutes. */
export async function composeNametagCards(memberIds: string[], fields: NametagFields): Promise<Map<string, NametagMember>> {
  const ids = [...new Set(memberIds)]
  const out = new Map<string, NametagMember>()
  const fieldsKey = JSON.stringify(fields)
  const now = Date.now()
  const todo: string[] = []
  for (const id of ids) {
    const hit = CACHE.get(id)
    if (hit && hit.fieldsKey === fieldsKey && now - hit.time < CACHE_TTL_MS) {
      if (hit.card) out.set(id, hit.card)
    } else todo.push(id)
  }
  if (!todo.length) return out

  const [pfps, mappings] = await Promise.all([resolvePfpsAbsolute(todo), safe(getCrewMappings(), { crews: [] as Crew[], cached: false })])
  const crews = (mappings.crews ?? []) as Crew[]

  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++]
      const { card, cache } = await safe(composeOne(id, fields, pfps[id], crews), { card: null, cache: false } as Composed)
      if (CACHE.size >= CACHE_MAX) {
        const oldest = [...CACHE.entries()].sort((a, b) => a[1].time - b[1].time)[0]?.[0]
        if (oldest) CACHE.delete(oldest)
      }
      if (cache) CACHE.set(id, { time: Date.now(), fieldsKey, card })
      if (card) out.set(id, card)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
  return out
}
