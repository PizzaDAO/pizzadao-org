// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { addDiscordReaction, DiscordPostError, removeDiscordReaction } from "./discord-rest";

const target = { channelId: "10", messageId: "20", emoji: "1_raphael:814002564743692289", botToken: "tok" };

describe("addDiscordReaction / removeDiscordReaction", () => {
  it("PUTs the bot's own reaction", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await addDiscordReaction(target, { fetchImpl: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/channels/10/messages/20/reactions/1_raphael%3A814002564743692289/@me");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bot tok");
  });

  it("DELETEs another member's reaction by user id", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await removeDiscordReaction({ ...target, emoji: "✅", userId: "77" }, { fetchImpl: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/channels/10/messages/20/reactions/%E2%9C%85/77");
    expect(init.method).toBe("DELETE");
  });

  it("waits out one short 429 and retries; a 403 throws with its status", async () => {
    const sleep = vi.fn(async () => {});
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 0.2 }), { status: 429, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await addDiscordReaction(target, { fetchImpl: f as unknown as typeof fetch, sleep });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);

    const denied = vi.fn(async () => new Response(JSON.stringify({ message: "Missing Permissions" }), { status: 403 }));
    await expect(removeDiscordReaction({ ...target, userId: "1" }, { fetchImpl: denied as unknown as typeof fetch })).rejects.toMatchObject({ name: "DiscordPostError", status: 403 });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(new DiscordPostError("x", 1).status).toBe(1);
  });
});
