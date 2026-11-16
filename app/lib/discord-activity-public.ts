// The public view of a member's Discord activity (profile + hover card). Public endpoints, so:
// - dates are month precision only (first of the month, UTC),
// - channel names are shown only for channels the @everyone role can see (the stored topChannels
//   carry names, not ids, so the names are matched against the guild's channels, cached). When the
//   guild cannot be read, no channel names are shown at all,
// - the block is hidden when the switch (members.discordActivityShow) is off or there is no row.

import { prisma as realPrisma } from "./db"
import { toggleEnabled } from "./settings/toggles"
import { monthPrecisionIso } from "./member-since"
import { readTopChannels } from "./discord-activity"

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

/**
 * Names of channels everyone in the server can see: @everyone's base permission, then the channel's
 * @everyone overwrite (deny, then allow). A name that also belongs to a channel @everyone cannot see
 * is left out (names are not unique, and the stored data has only the name).
 */
export function publicChannelNames(guildId: string, everyonePermissions: string, channels: GuildChannel[]): Set<string> {
  const base = BigInt(everyonePermissions || "0")
  const visible = new Set<string>()
  const hidden = new Set<string>()
  for (const ch of channels) {
    if (!ch.name || ch.type === undefined || !NAMED_TYPES.has(ch.type)) continue
    let perms = base
    const ow = ch.permission_overwrites?.find((o) => o.id === guildId && o.type === 0)
    if (ow) perms = (perms & ~BigInt(ow.deny || "0")) | BigInt(ow.allow || "0")
    ;(perms & VIEW_CHANNEL ? visible : hidden).add(ch.name)
  }
  for (const n of hidden) visible.delete(n)
  return visible
}

const CHANNEL_CACHE_MS = 60 * 60 * 1000
const CHANNEL_RETRY_MS = 5 * 60 * 1000
let channelCache: { at: number; names: Set<string> | null } | null = null

/** Test hook. */
export function clearPublicChannelCache() {
  channelCache = null
}

/** The public channel names (cached one hour), or null when Discord cannot be read: show no names then. */
export async function getPublicChannelNames(fetchImpl: typeof fetch = fetch): Promise<Set<string> | null> {
  const now = Date.now()
  if (channelCache && now - channelCache.at < (channelCache.names ? CHANNEL_CACHE_MS : CHANNEL_RETRY_MS)) return channelCache.names
  const guildId = process.env.DISCORD_GUILD_ID
  const token = process.env.DISCORD_BOT_TOKEN
  let names: Set<string> | null = null
  if (guildId && token) {
    try {
      const headers = { Authorization: `Bot ${token}` }
      const [rolesRes, chRes] = await Promise.all([
        fetchImpl(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers, cache: "no-store" }),
        fetchImpl(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers, cache: "no-store" }),
      ])
      if (rolesRes.ok && chRes.ok) {
        const roles = (await rolesRes.json()) as Array<{ id: string; permissions?: string }>
        const everyone = roles.find((r) => r.id === guildId)
        if (everyone) names = publicChannelNames(guildId, everyone.permissions ?? "0", (await chRes.json()) as GuildChannel[])
      }
    } catch {
      names = null
    }
  }
  channelCache = { at: now, names }
  return names
}

export interface PublicActivityRow {
  totalMessages: number
  firstSeen: Date
  lastSeen: Date
  activeMonths: number
  topChannels: unknown
}

/** Pure: the public shape of a row. `publicNames` null means channel names cannot be vetted: none shown. */
export function toPublicActivity(row: PublicActivityRow, publicNames: Set<string> | null): PublicDiscordActivity {
  const topChannels = publicNames
    ? readTopChannels(row.topChannels)
        .filter((c) => publicNames.has(c.name))
        .slice(0, PUBLIC_TOP_CHANNELS)
        .map((c) => c.name)
    : []
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
  channelNames?: () => Promise<Set<string> | null>
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
