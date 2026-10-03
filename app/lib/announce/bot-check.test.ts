import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PERMISSIONS,
  computeChannelPermissions,
  summarizeAnnouncePermissions,
  checkAnnounceBot,
  getAnnounceBotCheck,
  resetAnnounceBotCheckCache,
  type GuildRole,
  type PermissionOverwrite,
} from "./bot-check";

const GUILD = "900";
const BOT = "42";
const ROLE_BOT = "500";
const ROLE_ADMIN = "501";
const ROLE_MUTED = "502";

const p = (...flags: bigint[]) => flags.reduce((a, b) => a | b, BigInt(0)).toString();
const { VIEW_CHANNEL: VIEW, SEND_MESSAGES: SEND, MENTION_EVERYONE: MENTION, ADMINISTRATOR: ADMIN } = PERMISSIONS;

const roles: GuildRole[] = [
  { id: GUILD, name: "@everyone", permissions: p(VIEW, SEND) },
  { id: ROLE_BOT, name: "Bot", permissions: p(MENTION) },
  { id: ROLE_ADMIN, name: "Admin", permissions: p(ADMIN) },
  { id: ROLE_MUTED, name: "Muted", permissions: "0" },
];

function summarize(memberRoleIds: string[], overwrites: PermissionOverwrite[], guildRoles = roles) {
  return summarizeAnnouncePermissions(
    computeChannelPermissions({ guildId: GUILD, userId: BOT, memberRoleIds, guildRoles, overwrites }),
  );
}

describe("computeChannelPermissions", () => {
  it("combines @everyone and member role base permissions", () => {
    expect(summarize([ROLE_BOT], [])).toEqual({ canView: true, canSend: true, canMentionEveryone: true });
  });

  it("ADMINISTRATOR ignores deny overwrites", () => {
    const overwrites: PermissionOverwrite[] = [
      { id: GUILD, type: 0, allow: "0", deny: p(VIEW, SEND, MENTION) },
      { id: BOT, type: 1, allow: "0", deny: p(SEND) },
    ];
    expect(summarize([ROLE_ADMIN], overwrites)).toEqual({ canView: true, canSend: true, canMentionEveryone: true });
  });

  it("an @everyone deny overwrite removes Send Messages (read-only announcements channel)", () => {
    const overwrites: PermissionOverwrite[] = [{ id: GUILD, type: 0, allow: "0", deny: p(SEND) }];
    expect(summarize([ROLE_BOT], overwrites)).toEqual({ canView: true, canSend: false, canMentionEveryone: false });
  });

  it("a role allow overwrite beats the @everyone deny", () => {
    const overwrites: PermissionOverwrite[] = [
      { id: GUILD, type: 0, allow: "0", deny: p(SEND) },
      { id: ROLE_BOT, type: 0, allow: p(SEND), deny: "0" },
    ];
    expect(summarize([ROLE_BOT], overwrites)).toEqual({ canView: true, canSend: true, canMentionEveryone: true });
  });

  it("role allows win over role denies when the member holds both roles", () => {
    const overwrites: PermissionOverwrite[] = [
      { id: ROLE_MUTED, type: 0, allow: "0", deny: p(SEND) },
      { id: ROLE_BOT, type: 0, allow: p(SEND), deny: "0" },
    ];
    expect(summarize([ROLE_BOT, ROLE_MUTED], overwrites).canSend).toBe(true);
  });

  it("a member deny overwrite beats a role allow", () => {
    const overwrites: PermissionOverwrite[] = [
      { id: ROLE_BOT, type: 0, allow: p(SEND, MENTION), deny: "0" },
      { id: BOT, type: 1, allow: "0", deny: p(MENTION) },
    ];
    expect(summarize([ROLE_BOT], overwrites)).toEqual({ canView: true, canSend: true, canMentionEveryone: false });
  });

  it("a member allow overwrite grants Mention @everyone", () => {
    const overwrites: PermissionOverwrite[] = [{ id: BOT, type: 1, allow: p(MENTION), deny: "0" }];
    expect(summarize([], overwrites).canMentionEveryone).toBe(true);
  });

  it("missing role: without the bot role there is no Mention @everyone", () => {
    expect(summarize([], [])).toEqual({ canView: true, canSend: true, canMentionEveryone: false });
  });

  it("missing role: a member role absent from the guild role list contributes nothing", () => {
    expect(summarize(["999"], [])).toEqual({ canView: true, canSend: true, canMentionEveryone: false });
  });

  it("no View Channel implies no send / mention", () => {
    const overwrites: PermissionOverwrite[] = [{ id: GUILD, type: 0, allow: "0", deny: p(VIEW) }];
    expect(summarize([ROLE_BOT], overwrites)).toEqual({ canView: false, canSend: false, canMentionEveryone: false });
  });

  it("an overwrite for a role the bot doesn't hold is ignored", () => {
    const overwrites: PermissionOverwrite[] = [{ id: ROLE_MUTED, type: 0, allow: "0", deny: p(SEND) }];
    expect(summarize([ROLE_BOT], overwrites).canSend).toBe(true);
  });
});

// Fake Discord API: no real network calls.
function fakeDiscord(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const routes: Record<string, { status: number; body: unknown }> = {
    "/users/@me": { status: 200, body: { id: BOT } },
    "/channels/812143244149915679": {
      status: 200,
      body: {
        guild_id: GUILD,
        name: "announcements",
        permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: p(SEND) }],
      },
    },
    [`/guilds/${GUILD}/members/${BOT}`]: { status: 200, body: { roles: [ROLE_BOT] } },
    [`/guilds/${GUILD}/roles`]: { status: 200, body: roles },
    ...overrides,
  };
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace("https://discord.com/api/v10", "");
    const r = routes[path];
    if (!r) return new Response(JSON.stringify({ message: "Unknown" }), { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
}

describe("checkAnnounceBot", () => {
  beforeEach(() => {
    resetAnnounceBotCheckCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reports missing Send Messages / Mention @everyone from the channel overwrites", async () => {
    const fetchImpl = fakeDiscord();
    const out = await checkAnnounceBot({ DISCORD_BOT_TOKEN: "t" }, fetchImpl as unknown as typeof fetch);
    expect(out).toMatchObject({
      configured: true,
      via: "bot",
      channelName: "announcements",
      canView: true,
      canSend: false,
      canMentionEveryone: false,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bot t");
  });

  it("uses ANNOUNCE_DISCORD_CHANNEL_ID and reports a channel the bot can't see", async () => {
    const fetchImpl = fakeDiscord({ "/channels/123": { status: 403, body: { message: "Missing Access", code: 50001 } } });
    const out = await checkAnnounceBot(
      { DISCORD_BOT_TOKEN: "t", ANNOUNCE_DISCORD_CHANNEL_ID: "123" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(out).toMatchObject({ configured: true, canView: false, canSend: false });
    expect("error" in out && out.error).toMatch(/Missing Access/);
  });

  it("returns an error (not a throw) when Discord fails", async () => {
    const fetchImpl = fakeDiscord({ "/users/@me": { status: 401, body: { message: "401: Unauthorized" } } });
    const out = await checkAnnounceBot({ DISCORD_BOT_TOKEN: "bad" }, fetchImpl as unknown as typeof fetch);
    expect(out).toMatchObject({ configured: true, canSend: false });
    expect("error" in out && out.error).toMatch(/401/);
  });

  it("skips the permission math for a webhook", async () => {
    const fetchImpl = fakeDiscord();
    const out = await checkAnnounceBot(
      { DISCORD_BOT_TOKEN: "t", ANNOUNCE_DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/1/x" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(out).toEqual({ configured: true, via: "webhook" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports not configured without a token or webhook", async () => {
    const fetchImpl = fakeDiscord();
    const out = await checkAnnounceBot({}, fetchImpl as unknown as typeof fetch);
    expect(out).toMatchObject({ configured: false, canSend: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches the result for 5 minutes", async () => {
    const fetchImpl = fakeDiscord();
    const f = fetchImpl as unknown as typeof fetch;
    let t = 1_000_000;
    const now = () => t;
    await getAnnounceBotCheck({ DISCORD_BOT_TOKEN: "t" }, f, now);
    const calls = fetchImpl.mock.calls.length;
    t += 4 * 60 * 1000;
    await getAnnounceBotCheck({ DISCORD_BOT_TOKEN: "t" }, f, now);
    expect(fetchImpl.mock.calls.length).toBe(calls);
    t += 2 * 60 * 1000;
    await getAnnounceBotCheck({ DISCORD_BOT_TOKEN: "t" }, f, now);
    expect(fetchImpl.mock.calls.length).toBe(calls * 2);
  });
});
