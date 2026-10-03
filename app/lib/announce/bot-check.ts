/**
 * Pre-flight check for /announce: can the bot actually post (with @everyone)
 * in the announcement channel?
 *
 * Computes the bot's effective channel permissions with Discord's algorithm
 * (https://discord.com/developers/docs/topics/permissions):
 *
 *   1. base = @everyone role permissions | every role the member holds
 *   2. ADMINISTRATOR in base -> everything
 *   3. channel overwrite for @everyone (deny, then allow)
 *   4. channel overwrites for the member's roles (all denies, then all allows)
 *   5. channel overwrite for the member itself (deny, then allow)
 *
 * Server-side only.
 */

import { getAnnounceConfig } from "./run";

export const PERMISSIONS = {
  ADMINISTRATOR: BigInt(1) << BigInt(3),
  VIEW_CHANNEL: BigInt(1) << BigInt(10),
  SEND_MESSAGES: BigInt(1) << BigInt(11),
  MENTION_EVERYONE: BigInt(1) << BigInt(17),
} as const;

const ALL_PERMISSIONS = (BigInt(1) << BigInt(64)) - BigInt(1);

export interface GuildRole {
  id: string;
  /** Permission bitfield as a decimal string (Discord API v10). */
  permissions: string;
  name?: string;
}

export interface PermissionOverwrite {
  id: string;
  /** 0 = role, 1 = member. */
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface PermissionInput {
  guildId: string;
  userId: string;
  memberRoleIds: string[];
  guildRoles: GuildRole[];
  overwrites: PermissionOverwrite[];
  ownerId?: string | null;
}

function bits(value: string | undefined | null): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return BigInt(0);
  }
}

/** Effective channel permissions for a guild member (Discord's algorithm). */
export function computeChannelPermissions(input: PermissionInput): bigint {
  const { guildId, userId, memberRoleIds, guildRoles, overwrites, ownerId } = input;
  if (ownerId && ownerId === userId) return ALL_PERMISSIONS;

  const roleById = new Map(guildRoles.map((r) => [r.id, r]));

  // 1. Base permissions: @everyone (role id == guild id) + member roles.
  let perms = bits(roleById.get(guildId)?.permissions);
  for (const roleId of memberRoleIds) {
    const role = roleById.get(roleId);
    if (role) perms |= bits(role.permissions);
  }

  // 2. ADMINISTRATOR bypasses channel overwrites.
  if ((perms & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) return ALL_PERMISSIONS;

  // 3. @everyone overwrite.
  const everyone = overwrites.find((o) => o.id === guildId);
  if (everyone) {
    perms &= ~bits(everyone.deny);
    perms |= bits(everyone.allow);
  }

  // 4. Role overwrites, combined.
  let allow = BigInt(0);
  let deny = BigInt(0);
  const memberRoles = new Set(memberRoleIds);
  for (const o of overwrites) {
    if (Number(o.type) === 0 && o.id !== guildId && memberRoles.has(o.id)) {
      allow |= bits(o.allow);
      deny |= bits(o.deny);
    }
  }
  perms &= ~deny;
  perms |= allow;

  // 5. Member overwrite.
  const member = overwrites.find((o) => Number(o.type) === 1 && o.id === userId);
  if (member) {
    perms &= ~bits(member.deny);
    perms |= bits(member.allow);
  }

  return perms;
}

function has(perms: bigint, flag: bigint): boolean {
  return (perms & flag) === flag;
}

/** Translate a permission bitfield into the three things /announce needs. */
export function summarizeAnnouncePermissions(perms: bigint) {
  const canView = has(perms, PERMISSIONS.VIEW_CHANNEL);
  // Without VIEW_CHANNEL every other channel permission is implicitly denied.
  const canSend = canView && has(perms, PERMISSIONS.SEND_MESSAGES);
  const canMentionEveryone = canSend && has(perms, PERMISSIONS.MENTION_EVERYONE);
  return { canView, canSend, canMentionEveryone };
}

export type BotCheck =
  | { configured: true; via: "webhook" }
  | {
      configured: boolean;
      via?: "bot";
      channelId?: string;
      channelName?: string;
      canView: boolean;
      canSend: boolean;
      canMentionEveryone: boolean;
      error?: string;
    };

const DISCORD_API = "https://discord.com/api/v10";

class DiscordCheckError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function discordGet<T>(path: string, botToken: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const json = JSON.parse(text) as { message?: string; code?: number };
      if (json.message) detail = `${json.message}${json.code ? ` (code ${json.code})` : ""}`;
    } catch {
      /* keep raw text */
    }
    throw new DiscordCheckError(`Discord ${res.status} on ${path.split("/").slice(0, 2).join("/")}: ${detail}`, res.status);
  }
  return JSON.parse(text) as T;
}

const NONE = { canView: false, canSend: false, canMentionEveryone: false };

/** Run the check against Discord (uncached). */
export async function checkAnnounceBot(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<BotCheck> {
  const cfg = getAnnounceConfig(env);
  if (!cfg.discord) {
    return {
      configured: false,
      ...NONE,
      error: "Set DISCORD_BOT_TOKEN or ANNOUNCE_DISCORD_WEBHOOK_URL.",
    };
  }
  if (cfg.discord.kind === "webhook") return { configured: true, via: "webhook" };

  const { channelId, botToken } = cfg.discord;
  try {
    const me = await discordGet<{ id: string }>("/users/@me", botToken, fetchImpl);

    let channel: {
      guild_id?: string;
      name?: string;
      permission_overwrites?: PermissionOverwrite[];
    };
    try {
      channel = await discordGet(`/channels/${channelId}`, botToken, fetchImpl);
    } catch (e) {
      // 403 Missing Access / 404 Unknown Channel: the bot cannot see it.
      if (e instanceof DiscordCheckError && (e.status === 403 || e.status === 404)) {
        return {
          configured: true,
          via: "bot",
          channelId,
          ...NONE,
          error: `Bot can't access channel ${channelId} (${e.message}).`,
        };
      }
      throw e;
    }

    const guildId = channel.guild_id || env.DISCORD_GUILD_ID?.trim();
    if (!guildId) throw new Error(`Channel ${channelId} is not a guild channel.`);

    const [member, guildRoles] = await Promise.all([
      discordGet<{ roles: string[] }>(`/guilds/${guildId}/members/${me.id}`, botToken, fetchImpl),
      discordGet<GuildRole[]>(`/guilds/${guildId}/roles`, botToken, fetchImpl),
    ]);

    const perms = computeChannelPermissions({
      guildId,
      userId: me.id,
      memberRoleIds: member.roles ?? [],
      guildRoles,
      overwrites: channel.permission_overwrites ?? [],
    });

    return {
      configured: true,
      via: "bot",
      channelId,
      channelName: channel.name,
      ...summarizeAnnouncePermissions(perms),
    };
  } catch (e) {
    console.error("[announce] bot permission check failed", e);
    return {
      configured: true,
      via: "bot",
      channelId,
      ...NONE,
      error: e instanceof Error ? e.message : "Permission check failed",
    };
  }
}

export const BOT_CHECK_TTL_MS = 5 * 60 * 1000;
let cache: { key: string; at: number; value: BotCheck } | null = null;

/** Cached (5 min) wrapper around checkAnnounceBot. */
export async function getAnnounceBotCheck(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<BotCheck> {
  const cfg = getAnnounceConfig(env);
  const key =
    cfg.discord?.kind === "bot" ? `bot:${cfg.discord.channelId}` : cfg.discord?.kind ?? "none";
  if (cache && cache.key === key && now() - cache.at < BOT_CHECK_TTL_MS) return cache.value;
  const value = await checkAnnounceBot(env, fetchImpl);
  cache = { key, at: now(), value };
  return value;
}

/** Test helper. */
export function resetAnnounceBotCheckCache() {
  cache = null;
}
