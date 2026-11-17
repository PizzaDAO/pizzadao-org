// The public view of a member's Discord activity (profile + hover card). Public endpoints, so:
// - dates are month precision only (first of the month, UTC),
// - channel names are shown only for channels @everyone (or a configured verified-member role) can see (the stored topChannels
//   carry names, not ids, so the names are matched against the guild's channels, cached). When the
//   guild cannot be read, no channel names are shown at all,
// - the block is hidden when the switch (members.discordActivityShow) is off or there is no row.

import { createHash } from "node:crypto"
import { prisma as realPrisma } from "./db"
import { cacheDel } from "@/app/api/lib/cache"
import { swrGet } from "./swr-cache"
import { getSetting } from "./settings"
import { toggleEnabled } from "./settings/toggles"
import { monthPrecisionIso } from "./member-since"
import { channelKey, readTopChannels } from "./discord-activity"
import { clearGuildChannelsCache, clearGuildRolesCache, getGuildChannels, getGuildRoles } from "./discord-channels"

export interface PublicDiscordActivity {
  messages: number
  /** Month precision ISO (first of the month). */
  since: string | null
  lastActive: string | null
  activeMonths: number
  /** Up to three public channel names, most used first. */
  topChannels: string[]
}

export const PUBLIC_TOP_CHANNELS = 3
const VIEW_CHANNEL = BigInt(1) << BigInt(10)
/** Text-like channel types whose names can appear: text, voice (its chat), announcement, stage, forum, media. */
const NAMED_TYPES = new Set([0, 2, 5, 13, 15, 16])

interface GuildChannel {
  name?: string
  type?: number
  permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>
}

/** Channel key (see channelKey) -> the live display name, for keys that are public. */
export type PublicChannels = Map<string, string>

const ADMINISTRATOR = BigInt(1) << BigInt(3)

/** Role ids from members.discordActivityPublicRoleIds: one per line, bad lines skipped. */
export function parsePublicRoleIds(raw: string): string[] {
  return [...new Set(raw.split("\n").map((l) => l.trim()).filter((l) => /^\d{15,25}$/.test(l)))]
}

type Overwrite = { id: string; type: number; allow: string; deny: string }

function applyOverwrite(perms: bigint, ow: Overwrite | undefined): bigint {
  return ow ? (perms & ~BigInt(ow.deny || "0")) | BigInt(ow.allow || "0") : perms
}

/** Can a member holding exactly @everyone plus (optionally) one role view the channel? */
function canView(guildId: string, everyonePerms: bigint, role: { id: string; perms: bigint } | null, overwrites: Overwrite[]): boolean {
  let perms = everyonePerms | (role?.perms ?? BigInt(0))
  if (perms & ADMINISTRATOR) return true
  perms = applyOverwrite(perms, overwrites.find((o) => o.id === guildId && o.type === 0))
  if (role) perms = applyOverwrite(perms, overwrites.find((o) => o.id === role.id && o.type === 0))
  return (perms & VIEW_CHANNEL) !== BigInt(0)
}

/**
 * Channels shown publicly: ones @everyone can see, or that any of the configured roles (the role every
 * verified member has) can see. For each candidate: base = @everyone perms | the role's perms
 * (ADMINISTRATOR sees all), then the channel's @everyone overwrite (deny, then allow), then the role's
 * overwrite (deny, then allow). Channel overwrites are the channel's own, as Discord returns them (a
 * synced channel carries its category's). Keyed by channelKey (the stored names are sanitized); a key is
 * public only when EVERY live channel with that key is public. Keys that match no live channel (e.g.
 * threads and forum posts, which the old crawl stored as channels) are never public.
 */
export function publicChannelNames(
  guildId: string,
  everyonePermissions: string,
  channels: GuildChannel[],
  roles: Array<{ id: string; permissions?: string }> = [],
): PublicChannels {
  const base = BigInt(everyonePermissions || "0")
  const candidates = roles.map((r) => ({ id: r.id, perms: BigInt(r.permissions || "0") }))
  const visible = new Map<string, string>()
  const hidden = new Set<string>()
  for (const ch of channels) {
    if (!ch.name || ch.type === undefined || !NAMED_TYPES.has(ch.type)) continue
    const ows = ch.permission_overwrites ?? []
    const key = channelKey(ch.name)
    if (canView(guildId, base, null, ows) || candidates.some((r) => canView(guildId, base, r, ows))) {
      if (!visible.has(key)) visible.set(key, ch.name)
    } else hidden.add(key)
  }
  for (const k of hidden) visible.delete(k)
  return visible
}

/** For the verification script: how many live channels each stored key maps to. */
export function countKeyMatches(storedKeys: Iterable<string>, liveNames: string[]): { one: number; none: number; many: number } {
  const live = new Map<string, number>()
  for (const n of liveNames) live.set(channelKey(n), (live.get(channelKey(n)) ?? 0) + 1)
  const out = { one: 0, none: 0, many: 0 }
  for (const k of new Set([...storedKeys].map(channelKey))) {
    const n = live.get(k) ?? 0
    if (n === 0) out.none++
    else if (n === 1) out.one++
    else out.many++
  }
  return out
}

/** Shared (KV) cache of the already-vetted public channel names. */
export const CHANNEL_NAMES_KEY_PREFIX = "discord:public-channel-names:v1"
/** Fresh for an hour; kept a day so a cold instance never waits on Discord, while a channel that turns private cannot be served for long. */
export const CHANNEL_NAMES_FRESH_SECONDS = 60 * 60
export const CHANNEL_NAMES_KEEP_SECONDS = 6 * 60 * 60
const CHANNEL_RETRY_MS = 5 * 60 * 1000
const failedUntil = new Map<string, number>()
const inflight = new Map<string, Promise<PublicChannels | null>>()
const usedKeys = new Set<string>()

/** KV key for one allow-list: a changed role setting yields a different key, so an old allow-list is never served. */
export function channelNamesKey(roleIds: string[]): string {
  const h = createHash("sha1").update([...roleIds].sort().join(",")).digest("hex").slice(0, 12)
  return `${CHANNEL_NAMES_KEY_PREFIX}:${h}`
}

/** Test hook. */
export function clearPublicChannelCache() {
  failedUntil.clear()
  inflight.clear()
  for (const k of usedKeys) void cacheDel(k)
  usedKeys.clear()
  clearGuildChannelsCache()
  clearGuildRolesCache()
}

async function loadPublicChannelNames(fetchImpl: typeof fetch, wanted: string[]): Promise<PublicChannels | null> {
  const guildId = process.env.DISCORD_GUILD_ID
  const token = process.env.DISCORD_BOT_TOKEN
  if (!guildId || !token) return null
  const started = Date.now()
  let names: PublicChannels | null = null
  try {
    // The shared helpers time out (2.5 s), cache an hour per instance, keep the stale list on a failed
    // refresh and negative-cache a failure, so concurrent profile loads never each wait on Discord.
    const [roles, channels] = await Promise.all([getGuildRoles({ fetchImpl }), getGuildChannels({ fetchImpl })])
    if (roles && channels) {
      const everyone = roles.find((r) => r.id === guildId)
      if (everyone) names = publicChannelNames(guildId, everyone.permissions ?? "0", channels as GuildChannel[], roles.filter((r) => wanted.includes(r.id)))
    }
  } catch {
    names = null
  }
  console.info("[discord-activity] channel names", { ms: Date.now() - started, ok: names !== null })
  return names
}

/**
 * The public channel names, or null when they cannot be vetted (show no names then). Served from the
 * shared KV cache, stale-while-revalidate: a cold instance reads one key and never waits on Discord
 * unless nothing is stored yet. The stored value is only the already-filtered public names (never raw
 * channels or permissions), keyed by the configured role ids. A failed refresh keeps the stored list.
 */
export async function getPublicChannelNames(fetchImpl: typeof fetch = fetch): Promise<PublicChannels | null> {
  const wanted = parsePublicRoleIds(await getSetting("members.discordActivityPublicRoleIds").catch(() => ""))
  const key = channelNamesKey(wanted)
  usedKeys.add(key)
  if ((failedUntil.get(key) ?? 0) > Date.now()) return null
  // Single flight: concurrent cold requests share one lookup.
  let p = inflight.get(key)
  if (!p) {
    p = swrGet<Array<[string, string]>>(
      key,
      async () => {
        const names = await loadPublicChannelNames(fetchImpl, wanted)
        if (!names) throw new Error("public channel names unavailable")
        return [...names]
      },
      {
        freshSeconds: CHANNEL_NAMES_FRESH_SECONDS,
        keepSeconds: CHANNEL_NAMES_KEEP_SECONDS,
        serveStale: true,
        isValid: (v) => Array.isArray(v) && v.every((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string"),
      },
    )
      .then(({ value }) => new Map(value) as PublicChannels)
      .catch(() => {
        failedUntil.set(key, Date.now() + CHANNEL_RETRY_MS)
        return null
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, p)
  }
  return p
}

export interface PublicActivityRow {
  totalMessages: number
  firstSeen: Date
  lastSeen: Date
  activeMonths: number
  topChannels: unknown
}

/** Pure: the public shape of a row. `publicNames` null means channel names cannot be vetted: none shown. */
export function toPublicActivity(row: PublicActivityRow, publicNames: PublicChannels | null): PublicDiscordActivity {
  const topChannels: string[] = []
  if (publicNames) {
    for (const c of readTopChannels(row.topChannels)) {
      const shown = publicNames.get(channelKey(c.name))
      if (shown && !topChannels.includes(shown)) topChannels.push(shown)
      if (topChannels.length >= PUBLIC_TOP_CHANNELS) break
    }
  }
  return {
    messages: Math.max(0, Math.round(row.totalMessages)),
    since: monthPrecisionIso(row.firstSeen),
    lastActive: monthPrecisionIso(row.lastSeen),
    activeMonths: Math.max(0, row.activeMonths),
    topChannels,
  }
}

export interface PublicActivityDeps {
  findRow?: (discordId: string) => Promise<PublicActivityRow | null>
  show?: () => Promise<boolean>
  channelNames?: () => Promise<PublicChannels | null>
}

/** The member's public Discord activity, or null (switch off, no row, no messages, or any failure). Never throws. */
export async function getPublicDiscordActivity(discordId: string | null | undefined, deps: PublicActivityDeps = {}): Promise<PublicDiscordActivity | null> {
  if (!discordId) return null
  try {
    const show = await (deps.show ?? (() => toggleEnabled("members.discordActivityShow")))()
    if (!show) return null
    const row = await (deps.findRow ??
      ((id: string) =>
        (realPrisma as unknown as { discordActivity: { findUnique(args: unknown): Promise<PublicActivityRow | null> } }).discordActivity.findUnique({
          where: { discordId: id },
          select: { totalMessages: true, firstSeen: true, lastSeen: true, activeMonths: true, topChannels: true },
        })))(discordId)
    if (!row || row.totalMessages <= 0) return null
    const names = await (deps.channelNames ?? (() => getPublicChannelNames()))().catch(() => null)
    return toPublicActivity(row, names)
  } catch {
    return null
  }
}
