import { describe, it, expect, vi } from "vitest";
import { postDiscordMessage, DiscordPostError, parseRateLimit } from "./discord-rest";

const BOT = { kind: "bot" as const, channelId: "123", botToken: "test-bot-token" };
const HOOK = { kind: "webhook" as const, url: "https://discord.test/api/webhooks/1/abc" };

function res(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

describe("postDiscordMessage", () => {
  it("posts to the channel with the bot token and returns the message id", async () => {
    const fetchImpl = vi.fn(async () => res(200, JSON.stringify({ id: "m1" })));
    const out = await postDiscordMessage(BOT, { content: "hi" }, { fetchImpl: fetchImpl as typeof fetch });
    expect(out).toEqual({ id: "m1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/channels/123/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bot test-bot-token");
    expect(JSON.parse(String(init.body))).toEqual({ content: "hi" });
  });

  it("adds wait=true to webhook posts", async () => {
    const fetchImpl = vi.fn(async () => res(200, JSON.stringify({ id: "m2" })));
    await postDiscordMessage(HOOK, { content: "hi" }, { fetchImpl: fetchImpl as typeof fetch });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get("wait")).toBe("true");
  });

  it("waits out a JSON 429 retry_after and retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        res(429, JSON.stringify({ message: "You are being rate limited.", retry_after: 1.5, global: false }), {
          "content-type": "application/json",
        }),
      )
      .mockResolvedValueOnce(res(200, JSON.stringify({ id: "m3" })));
    const sleep = vi.fn(async () => {});
    const out = await postDiscordMessage(BOT, { content: "hi" }, { fetchImpl, sleep });
    expect(out.id).toBe("m3");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1750);
  });

  it("gives up when the rate-limit wait is too long", async () => {
    const fetchImpl = vi.fn(async () => res(429, JSON.stringify({ retry_after: 120 })));
    const sleep = vi.fn(async () => {});
    await expect(postDiscordMessage(BOT, { content: "hi" }, { fetchImpl, sleep })).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 120000,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops after maxAttempts", async () => {
    const fetchImpl = vi.fn(async () => res(429, JSON.stringify({ retry_after: 0.1 })));
    const sleep = vi.fn(async () => {});
    await expect(
      postDiscordMessage(BOT, { content: "hi" }, { fetchImpl, sleep, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(DiscordPostError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a Cloudflare 1015 block", async () => {
    const fetchImpl = vi.fn(async () =>
      res(429, "<html>error code: 1015</html>", { "content-type": "text/html", "retry-after": "1200" }),
    );
    const sleep = vi.fn(async () => {});
    const err = await postDiscordMessage(BOT, { content: "hi" }, { fetchImpl, sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(DiscordPostError);
    expect(err.cloudflare).toBe(true);
    expect(err.message).toMatch(/Cloudflare/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("surfaces Discord API errors without retrying", async () => {
    const fetchImpl = vi.fn(async () => res(403, JSON.stringify({ message: "Missing Permissions", code: 50013 })));
    await expect(postDiscordMessage(BOT, { content: "hi" }, { fetchImpl })).rejects.toThrow(
      /403.*Missing Permissions \(code 50013\)/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects messages over 2000 characters before calling Discord", async () => {
    const fetchImpl = vi.fn();
    await expect(postDiscordMessage(BOT, { content: "x".repeat(2001) }, { fetchImpl })).rejects.toThrow(/2000/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parseRateLimit reads the Retry-After header when there is no JSON", () => {
    expect(parseRateLimit(new Headers({ "retry-after": "3" }), "")).toEqual({ retryAfterMs: 3000, cloudflare: false });
  });
});
