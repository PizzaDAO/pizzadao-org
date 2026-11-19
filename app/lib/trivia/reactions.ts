// app/lib/trivia/reactions.ts
//
// The Discord side of reaction answers (plans/trivia.md section 17): resolving the choice emoji, pre-adding the bot's
// reactions to a question post, removing a member's reaction after their attempt (so the counts never show what others
// picked), and checking which channel permissions the bot has. Nothing here changes permissions; it only reads them.
import { computeChannelPermissions, type GuildRole, type PermissionOverwrite } from "@/app/lib/announce/bot-check";
import { getGuildEmojiIds } from "@/app/lib/discord-channels";
import { addDiscordReaction, removeDiscordReaction } from "@/app/lib/discord-rest";
import { REACTION_PACE_MS } from "./config";
import { buildChoiceLabels, type ChoiceLabels } from "./emoji";

const API = "https://discord.com/api/v10";
const PERM_ADD_REACTIONS = BigInt(1) << BigInt(6);
const PERM_MANAGE_MESSAGES = BigInt(1) << BigInt(13);
const PERM_READ_HISTORY = BigInt(1) << BigInt(16);
const PERM_ADMINISTRATOR = BigInt(1) << BigInt(3);
const PERMS_TTL_MS = 5 * 60_000;
const WARN_EVERY_MS = 5 * 60_000;

const botToken = () => process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BotChannelPerms {
  /** False when the permissions could not be read: nothing is then assumed missing. */
  known: boolean;
  addReactions: boolean;
  readHistory: boolean;
  manageMessages: boolean;
}

const UNKNOWN: BotChannelPerms = { known: false, addReactions: true, readHistory: true, manageMessages: true };

/** Pure: the three permissions reaction answers need, from a computed permission bitfield. */
export function reactionPerms(bits: bigint): BotChannelPerms {
  const all = (bits & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR;
  const has = (flag: bigint) => all || (bits & flag) === flag;
  return { known: true, addReactions: has(PERM_ADD_REACTIONS), readHistory: has(PERM_READ_HISTORY), manageMessages: has(PERM_MANAGE_MESSAGES) };
}

let permsCache: { channelId: string; at: number; value: BotChannelPerms } | null = null

/** Test hook. */
export function resetReactionState(): void {
  permsCache = null;
  lastWarn.clear();
}

async function get<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bot ${botToken()}` }, cache: "no-store", signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Discord ${res.status} on ${path}`);
  return (await res.json()) as T;
}

/** What the bot may do in the channel (cached 5 minutes). Read-only; unreadable gives `known: false`. */
export async function botChannelPerms(channelId: string, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<BotChannelPerms> {
  if (permsCache && permsCache.channelId === channelId && now - permsCache.at < PERMS_TTL_MS) return permsCache.value;
  let value = UNKNOWN;
  try {
    const me = await get<{ id: string }>("/users/@me", fetchImpl);
    const channel = await get<{ guild_id?: string; permission_overwrites?: PermissionOverwrite[] }>(`/channels/${channelId}`, fetchImpl);
    const guildId = channel.guild_id || process.env.DISCORD_GUILD_ID?.trim();
    if (guildId) {
      const [member, roles] = await Promise.all([
        get<{ roles: string[] }>(`/guilds/${guildId}/members/${me.id}`, fetchImpl),
        get<GuildRole[]>(`/guilds/${guildId}/roles`, fetchImpl),
      ]);
      value = reactionPerms(
        computeChannelPermissions({ guildId, userId: me.id, memberRoleIds: member.roles ?? [], guildRoles: roles, overwrites: channel.permission_overwrites ?? [] }),
      );
    }
  } catch (e) {
    console.warn(`[trivia] could not read the bot's channel permissions: ${e instanceof Error ? e.message : "error"}`);
  }
  permsCache = { channelId, at: now, value };
  return value;
}

const lastWarn = new Map<string, number>();
/** console.warn at most once per WARN_EVERY_MS for a given key. */
export function warnThrottled(key: string, message: string, now: number = Date.now()): void {
  const last = lastWarn.get(key);
  if (last !== undefined && now - last < WARN_EVERY_MS) return;
  lastWarn.set(key, now);
  console.warn(message);
}

/** Labels for a multiple-choice round: the turtles, or the regional indicators (logged) when one is missing. */
export async function resolveChoiceLabels(count: number): Promise<ChoiceLabels> {
  const labels = buildChoiceLabels(count, await getGuildEmojiIds().catch(() => null));
  if (labels.fallback) warnThrottled("emoji-fallback", "[trivia] a turtle emoji is missing from the server (or the emoji list could not be read): this round uses the regional-indicator letters");
  return labels;
}

/**
 * Pre-add the bot's reactions to the question post, in order. Never throws: a failure leaves typed answers working.
 * Skipped (and said so) when the bot cannot add reactions; warns (throttled) when it cannot remove them, since the
 * picks then stay visible.
 */
export async function addQuestionReactions(channelId: string, messageId: string, reactions: string[]): Promise<void> {
  if (reactions.length === 0) return;
  const perms = await botChannelPerms(channelId);
  if (!perms.addReactions || !perms.readHistory) {
    warnThrottled("no-add-reactions", `[trivia] the bot lacks ${!perms.addReactions ? "Add Reactions" : "Read Message History"} in the trivia channel: no reactions were added; typed answers still work`);
    return;
  }
  if (!perms.manageMessages) {
    warnThrottled("no-manage-messages", "[trivia] the bot lacks Manage Messages in the trivia channel: members' reaction picks cannot be removed, so they stay visible to others");
  }
  for (let i = 0; i < reactions.length; i++) {
    try {
      await addDiscordReaction({ channelId, messageId, emoji: reactions[i], botToken: botToken() });
    } catch (e) {
      warnThrottled("add-reaction-failed", `[trivia] could not add a reaction to the question post: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`);
    }
    if (i < reactions.length - 1) await sleep(REACTION_PACE_MS);
  }
}

/**
 * Remove a member's reaction after their attempt (so counts stay at the bot's own). Never throws: when Discord refuses
 * (the bot lacks Manage Messages) it logs once per 5 minutes and carries on.
 */
export async function removeMemberReaction(channelId: string, messageId: string, reaction: string, userId: string): Promise<void> {
  try {
    await removeDiscordReaction({ channelId, messageId, emoji: reaction, userId, botToken: botToken() });
  } catch (e) {
    warnThrottled("remove-reaction-failed", `[trivia] could not remove a member's reaction (the bot needs Manage Messages): ${e instanceof Error ? e.message.slice(0, 160) : "error"}`);
  }
}
