// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/discord-channels", async (importActual) => ({ ...(await importActual<typeof import("@/app/lib/discord-channels")>()), getGuildEmojiIds: vi.fn() }));
vi.mock("@/app/lib/discord-rest", async (importActual) => ({ ...(await importActual<typeof import("@/app/lib/discord-rest")>()), addDiscordReaction: vi.fn(), removeDiscordReaction: vi.fn() }));

import { getGuildEmojiIds } from "@/app/lib/discord-channels";
import { addDiscordReaction, DiscordPostError, reactionPath, removeDiscordReaction } from "@/app/lib/discord-rest";
import { addQuestionReactions, botChannelPerms, reactionPerms, removeMemberReaction, resetReactionState, resolveChoiceLabels } from "./reactions";
import { CHOICE_EMOJI, REACTION_PACE_MS } from "./config";

const add = vi.mocked(addDiscordReaction);
const remove = vi.mocked(removeDiscordReaction);
const CHAN = "840000000000000001";
const MSG = "840000000000000002";

const ADD = BigInt(1) << BigInt(6);
const MANAGE = BigInt(1) << BigInt(13);
const HISTORY = BigInt(1) << BigInt(16);
const ADMIN = BigInt(1) << BigInt(3);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetReactionState();
  add.mockReset();
  add.mockResolvedValue(undefined);
  remove.mockReset();
  remove.mockResolvedValue(undefined);
  vi.mocked(getGuildEmojiIds).mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.DISCORD_BOT_TOKEN = "test-token";
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A fetch that answers the permission lookups: the bot has these `everyone` permission bits. */
function permsFetch(bits: bigint): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.endsWith("/users/@me")) return json({ id: "bot1" });
    if (u.includes(`/channels/${CHAN}`)) return json({ guild_id: "g1", permission_overwrites: [] });
    if (u.includes("/members/bot1")) return json({ roles: [] });
    if (u.endsWith("/guilds/g1/roles")) return json([{ id: "g1", permissions: String(bits) }]);
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("reactionPerms", () => {
  it("reads Add Reactions, Read Message History and Manage Messages from the bits; Administrator has all", () => {
    expect(reactionPerms(ADD | HISTORY)).toEqual({ known: true, addReactions: true, readHistory: true, manageMessages: false });
    expect(reactionPerms(ADD | HISTORY | MANAGE).manageMessages).toBe(true);
    expect(reactionPerms(BigInt(0))).toEqual({ known: true, addReactions: false, readHistory: false, manageMessages: false });
    expect(reactionPerms(ADMIN)).toEqual({ known: true, addReactions: true, readHistory: true, manageMessages: true });
  });

  it("botChannelPerms computes them from the bot's roles and the channel (read only) and caches the answer", async () => {
    const fetchImpl = vi.fn(permsFetch(ADD | HISTORY));
    expect(await botChannelPerms(CHAN, fetchImpl as unknown as typeof fetch)).toEqual({ known: true, addReactions: true, readHistory: true, manageMessages: false });
    const calls = fetchImpl.mock.calls.length;
    await botChannelPerms(CHAN, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls.length).toBe(calls);
    for (const c of fetchImpl.mock.calls) expect((c[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  });

  it("when Discord cannot be asked nothing is assumed missing", async () => {
    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await botChannelPerms(CHAN, failing)).toMatchObject({ known: false, addReactions: true, manageMessages: true });
  });
});

describe("addQuestionReactions", () => {
  // Permissions are read through the global fetch inside; give it a full-permission bot.
  beforeEach(() => {
    vi.stubGlobal("fetch", permsFetch(ADD | HISTORY | MANAGE));
  });
  afterEach(() => vi.unstubAllGlobals());

  const run = async (reactions: string[]) => {
    const p = addQuestionReactions(CHAN, MSG, reactions);
    await vi.runAllTimersAsync();
    await p;
  };

  it("adds the reactions in order, paced", async () => {
    await run(["a:1", "b:2", "c:3", "d:4"]);
    expect(add.mock.calls.map((c) => c[0].emoji)).toEqual(["a:1", "b:2", "c:3", "d:4"]);
    for (const c of add.mock.calls) expect(c[0]).toMatchObject({ channelId: CHAN, messageId: MSG, botToken: "test-token" });
    expect(REACTION_PACE_MS).toBeGreaterThan(0);
  });

  it("a failed add never throws and the rest still go, with one throttled warning", async () => {
    add.mockRejectedValueOnce(new DiscordPostError("nope", 403)).mockRejectedValueOnce(new DiscordPostError("nope", 403));
    await run(["a:1", "b:2", "c:3"]);
    expect(add).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("could not add a reaction"))).toHaveLength(1);
  });

  it("without Add Reactions nothing is added and it says so (typed answers still work)", async () => {
    vi.stubGlobal("fetch", permsFetch(HISTORY));
    await run(["a:1"]);
    expect(add).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("Add Reactions"))).toBe(true);
  });

  it("without Manage Messages it still adds them but warns that picks stay visible", async () => {
    vi.stubGlobal("fetch", permsFetch(ADD | HISTORY));
    await run(["a:1"]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("Manage Messages"))).toBe(true);
  });

  it("adds nothing for a short answer (no reactions)", async () => {
    await run([]);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("removeMemberReaction", () => {
  it("removes the member's own reaction by user id", async () => {
    await removeMemberReaction(CHAN, MSG, "1_raphael:814002564743692289", "777");
    expect(remove).toHaveBeenCalledWith({ channelId: CHAN, messageId: MSG, emoji: "1_raphael:814002564743692289", userId: "777", botToken: "test-token" });
  });

  it("a failure (the bot lacks Manage Messages) never throws, is logged once per window, and the next call still tries", async () => {
    remove.mockRejectedValue(new DiscordPostError("Missing Permissions", 403));
    await expect(removeMemberReaction(CHAN, MSG, "x", "1")).resolves.toBeUndefined();
    await expect(removeMemberReaction(CHAN, MSG, "x", "2")).resolves.toBeUndefined();
    await expect(removeMemberReaction(CHAN, MSG, "x", "3")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(3);
    const warnings = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("could not remove"));
    expect(warnings).toHaveLength(1);
    // after the throttle window it warns again
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await removeMemberReaction(CHAN, MSG, "x", "4");
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("could not remove"))).toHaveLength(2);
  });
});

describe("resolveChoiceLabels", () => {
  it("uses the turtles when the guild has them all", async () => {
    vi.mocked(getGuildEmojiIds).mockResolvedValue(new Set(CHOICE_EMOJI.map((e) => e.id)));
    expect((await resolveChoiceLabels(4)).fallback).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the regional indicators, and logs it, when a turtle was deleted", async () => {
    vi.mocked(getGuildEmojiIds).mockResolvedValue(new Set([CHOICE_EMOJI[0].id]));
    const l = await resolveChoiceLabels(4);
    expect(l.fallback).toBe(true);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("turtle emoji is missing"))).toBe(true);
  });

  it("falls back (and logs) when the emoji list cannot be read", async () => {
    vi.mocked(getGuildEmojiIds).mockRejectedValue(new Error("down"));
    expect((await resolveChoiceLabels(4)).fallback).toBe(true);
  });
});

describe("discord-rest reaction requests", () => {
  it("encodes the emoji for the path: custom as name:id, unicode percent-encoded", () => {
    expect(reactionPath("1_raphael:814002564743692289")).toBe("1_raphael%3A814002564743692289");
    expect(reactionPath("✅")).toBe("%E2%9C%85");
  });
});
