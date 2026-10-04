/**
 * Display labels for Discord IDs on reviewer / admin screens, resolved
 * server-side in this order:
 *
 *   1. the member's Crew-sheet name (cached members sheet; by member ID when
 *      known, else by Discord ID),
 *   2. the Discord guild nickname, global display name or username (the bot's
 *      guild-member lookup, cached for an hour),
 *   3. the raw Discord ID.
 *
 * Discord is only asked about people the sheet can't name. Lookups run in
 * parallel with bounded concurrency and a short per-call timeout, and every
 * failure falls through to the next source, so a slow or broken source never
 * blocks the page. Tests inject PeopleSources, so nothing reaches Discord.
 */
import { fetchGuildMemberProfile, type GuildMemberProfile } from './discord'
import { getSheetData } from './sheets/member-repository'

export interface PersonLabel {
  discordId: string
  /** Sheet name, else Discord nickname / display name / username, else the raw ID. */
  name: string
  memberId?: string
  /** "@username" when Discord was asked. */
  handle?: string
  avatarUrl?: string
  source: 'sheet' | 'discord' | 'id'
}

export interface PersonRef {
  discordId: string
  memberId?: string | null
}

export interface PeopleSources {
  /** Crew-sheet member (memberId + name) by member ID, else by Discord ID. Null when not found. */
  sheetMember: (ref: PersonRef) => Promise<{ memberId: string; name: string } | null>
  /** The guild member's names, or null. */
  discordProfile: (discordId: string, timeoutMs: number) => Promise<GuildMemberProfile | null>
}

const nameOf = (row: Record<string, unknown> | undefined) => String(row?.['Name'] || row?.['Mafia Name'] || '').trim()

export const defaultPeopleSources: PeopleSources = {
  async sheetMember({ discordId, memberId }) {
    const sheet = await getSheetData()
    const byMember = memberId ? sheet.memberToIdx.get(memberId) : undefined
    if (memberId && byMember !== undefined) return { memberId, name: nameOf(sheet.rows[byMember]) }
    const mid = sheet.discordToMember.get(discordId)
    const idx = mid === undefined ? undefined : sheet.memberToIdx.get(mid)
    if (mid === undefined || idx === undefined) return null
    return { memberId: mid, name: nameOf(sheet.rows[idx]) }
  },
  discordProfile: (discordId, timeoutMs) => fetchGuildMemberProfile(discordId, { timeoutMs }),
}

/** Run `fn` over `items` with at most `limit` in flight. Results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** Resolve within `ms`, else null (the underlying call is left to finish on its own). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(null)
      },
    )
  })
}

export interface ResolveOptions {
  sources?: PeopleSources
  /** Discord lookups in flight at once. */
  concurrency?: number
  /** Per-lookup Discord timeout. */
  timeoutMs?: number
  /** Crew-sheet timeout (one shared, cached read; a cold read takes longer). */
  sheetTimeoutMs?: number
  /** resolvePeople: total time budget; past it, people not yet looked up skip Discord (raw ID). */
  budgetMs?: number
  /** Internal: epoch ms after which Discord is skipped. */
  deadline?: number
}

/** Label one person (see the module comment for the order). Never throws. */
export async function resolvePerson(ref: PersonRef, opts: ResolveOptions = {}): Promise<PersonLabel> {
  const sources = opts.sources ?? defaultPeopleSources
  const timeoutMs = opts.timeoutMs ?? 1500
  const sheet = await withTimeout(sources.sheetMember(ref), opts.sheetTimeoutMs ?? 5000)
  const memberId = sheet?.memberId || ref.memberId || undefined
  if (sheet?.name) return { discordId: ref.discordId, name: sheet.name, memberId, source: 'sheet' }

  const left = opts.deadline === undefined ? timeoutMs : Math.min(timeoutMs, opts.deadline - Date.now())
  const d = left > 0 ? await withTimeout(sources.discordProfile(ref.discordId, left), left) : null
  const discordName = d?.nick || d?.globalName || d?.username
  if (d && discordName) {
    return {
      discordId: ref.discordId,
      name: discordName,
      ...(memberId ? { memberId } : {}),
      ...(d.username ? { handle: `@${d.username}` } : {}),
      ...(d.avatarUrl ? { avatarUrl: d.avatarUrl } : {}),
      source: 'discord',
    }
  }
  return { discordId: ref.discordId, name: ref.discordId, ...(memberId ? { memberId } : {}), source: 'id' }
}

/** Label many people at once (deduplicated by Discord ID; the first member ID seen wins). */
export async function resolvePeople(refs: Iterable<PersonRef | string>, opts: ResolveOptions = {}): Promise<Map<string, PersonLabel>> {
  const byId = new Map<string, PersonRef>()
  for (const r of refs) {
    const ref = typeof r === 'string' ? { discordId: r } : r
    if (!ref.discordId) continue
    const seen = byId.get(ref.discordId)
    if (!seen) byId.set(ref.discordId, { discordId: ref.discordId, memberId: ref.memberId ?? null })
    else if (!seen.memberId && ref.memberId) seen.memberId = ref.memberId
  }
  const list = [...byId.values()]
  const deadline = Date.now() + (opts.budgetMs ?? 4000)
  const labels = await mapLimit(list, opts.concurrency ?? 8, (ref) => resolvePerson(ref, { ...opts, deadline }))
  return new Map(labels.map((l) => [l.discordId, l]))
}
