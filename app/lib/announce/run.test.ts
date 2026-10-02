import { describe, it, expect, vi, beforeEach } from "vitest";

// Nothing in these tests may reach Google or Discord.
vi.mock("googleapis", () => ({
  google: { auth: { GoogleAuth: vi.fn() }, sheets: vi.fn(() => { throw new Error("real sheets client used"); }) },
}));

import {
  runAnnouncement,
  getAnnounceConfig,
  postToTelegram,
  __resetAnnounceLockForTests,
  DEFAULT_ANNOUNCE_CHANNEL_ID,
  type AnnounceConfig,
} from "./run";
import type { AnnounceBlock, AnnounceSheetIO } from "./sheet";
import { DiscordPostError } from "@/app/lib/discord-rest";

const TZ = "America/New_York";
// Fri 2026-10-02 14:00:00 ET
const NOW = new Date("2026-10-02T18:00:00Z");

function block(overrides: Partial<AnnounceBlock> = {}): AnnounceBlock {
  return {
    sendCell: "'Crews'!C23",
    lastSentCell: "'Crews'!E23",
    lastErrorCell: "'Crews'!G23",
    sendValue: "Sent",
    lastSentValue: "2026-08-08 15:49:51",
    specials: [{ text: "Ops goals", url: null, crew: "Ops", status: "To Do" }],
    ...overrides,
  };
}

function fakeSheet(b: AnnounceBlock = block()) {
  const readBlock = vi.fn(async () => b);
  const writeCells = vi.fn(async () => {});
  return { io: { readBlock, writeCells } as AnnounceSheetIO, readBlock, writeCells };
}

const BOT_CONFIG: AnnounceConfig = {
  discord: { kind: "bot", channelId: "812143244149915679", botToken: "test-token" },
  telegram: null,
  timeZone: TZ,
};

describe("runAnnouncement", () => {
  beforeEach(() => __resetAnnounceLockForTests());

  it("posts to Discord, marks Sent, stamps Last Sent and clears the stale Last Error", async () => {
    const sheet = fakeSheet();
    const postDiscord = vi.fn(async () => ({ id: "m1" }));
    const r = await runAnnouncement({ sheet: sheet.io, config: BOT_CONFIG, now: () => NOW, postDiscord });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, sentAt: "2026-10-02 14:00:00" });
    expect(postDiscord).toHaveBeenCalledTimes(1);
    const [target, body] = postDiscord.mock.calls[0] as unknown as [unknown, { content: string; allowed_mentions: unknown }];
    expect(target).toEqual(BOT_CONFIG.discord);
    expect(body.content).toContain("Community Call Sunday, October 4");
    expect(body.content).toContain("🫡 Ops goals");
    expect(body.allowed_mentions).toEqual({ parse: ["everyone"] });
    expect(sheet.writeCells).toHaveBeenCalledWith([
      { range: "'Crews'!C23", value: "Sent" },
      { range: "'Crews'!E23", value: "2026-10-02 14:00:00" },
      { range: "'Crews'!G23", value: "" },
    ]);
  });

  it("on Discord failure: resets Announce?, keeps Last Sent, writes Last Error, returns 502", async () => {
    const sheet = fakeSheet();
    const postDiscord = vi.fn(async () => {
      throw new DiscordPostError("Discord rate limit posting to channel 1: retry after 120s.", 429, 120000);
    });
    const r = await runAnnouncement({ sheet: sheet.io, config: BOT_CONFIG, now: () => NOW, postDiscord });

    expect(r.status).toBe(502);
    expect(r.body.success).toBe(false);
    expect(r.body.error).toMatch(/Discord: Discord rate limit/);
    expect(sheet.writeCells).toHaveBeenCalledWith([
      { range: "'Crews'!C23", value: "" },
      { range: "'Crews'!G23", value: expect.stringMatching(/^❌ Discord: .*retry after 120s\.  \[2026-10-02 14:00:00\]$/) },
    ]);
  });

  it("refuses a second fire within the double-fire window", async () => {
    const sheet = fakeSheet(block({ sendValue: "Sent", lastSentValue: "2026-10-02 13:55:00" }));
    const postDiscord = vi.fn();
    const r = await runAnnouncement({ sheet: sheet.io, config: BOT_CONFIG, now: () => NOW, postDiscord });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Already sent at 2026-10-02 13:55:00/);
    expect(postDiscord).not.toHaveBeenCalled();
    expect(sheet.writeCells).not.toHaveBeenCalled();
  });

  it("allows a re-send once the window has passed", async () => {
    const sheet = fakeSheet(block({ sendValue: "Sent", lastSentValue: "2026-10-02 13:45:00" }));
    const postDiscord = vi.fn(async () => ({ id: "m1" }));
    const r = await runAnnouncement({ sheet: sheet.io, config: BOT_CONFIG, now: () => NOW, postDiscord });
    expect(r.status).toBe(200);
  });

  it("rejects concurrent fires in the same instance", async () => {
    const sheet = fakeSheet();
    let release!: () => void;
    const postDiscord = vi.fn(
      () => new Promise<{ id: string }>((resolve) => (release = () => resolve({ id: "m1" }))),
    );
    const first = runAnnouncement({ sheet: sheet.io, config: BOT_CONFIG, now: () => NOW, postDiscord });
    await vi.waitFor(() => expect(postDiscord).toHaveBeenCalled());
    const second = await runAnnouncement({ sheet: sheet.io, config: BOT_CONFIG, now: () => NOW, postDiscord });
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });

  it("returns 500 without touching the sheet when Discord is not configured", async () => {
    const sheet = fakeSheet();
    const r = await runAnnouncement({ sheet: sheet.io, config: { ...BOT_CONFIG, discord: null }, now: () => NOW });
    expect(r.status).toBe(500);
    expect(sheet.readBlock).not.toHaveBeenCalled();
  });

  it("returns 502 when the sheet cannot be read", async () => {
    const sheet = fakeSheet();
    sheet.readBlock.mockRejectedValueOnce(new Error("The caller does not have permission"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const postDiscord = vi.fn();
    const r = await runAnnouncement({ sheet: sheet.io, config: BOT_CONFIG, now: () => NOW, postDiscord });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/permission/);
    expect(postDiscord).not.toHaveBeenCalled();
  });

  it("still reports success when only the status write fails", async () => {
    const sheet = fakeSheet();
    sheet.writeCells.mockRejectedValueOnce(new Error("quota"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAnnouncement({
      sheet: sheet.io,
      config: BOT_CONFIG,
      now: () => NOW,
      postDiscord: vi.fn(async () => ({ id: "m1" })),
    });
    expect(r.status).toBe(200);
    errSpy.mockRestore();
  });

  it("cross-posts to Telegram when configured and records partial failures", async () => {
    const sheet = fakeSheet();
    const postTelegram = vi.fn(async () => {
      throw new Error("Telegram failed for chat 1: 400 Bad Request");
    });
    const r = await runAnnouncement({
      sheet: sheet.io,
      config: { ...BOT_CONFIG, telegram: { botToken: "tg", chatIds: ["1"] } },
      now: () => NOW,
      postDiscord: vi.fn(async () => ({ id: "m1" })),
      postTelegram,
    });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
    expect(r.body.error).toMatch(/Sent with errors: ❌ Telegram/);
    const tgText = (postTelegram.mock.calls[0] as unknown as [unknown, string])[1];
    expect(tgText).toContain("Community Call Sunday, October 4 on https://discord.pizzadao.xyz");
    expect(sheet.writeCells).toHaveBeenCalledWith([
      { range: "'Crews'!C23", value: "Sent" },
      { range: "'Crews'!E23", value: "2026-10-02 14:00:00" },
      { range: "'Crews'!G23", value: expect.stringContaining("❌ Telegram") },
    ]);
  });
});

describe("getAnnounceConfig", () => {
  it("uses the bot token and default channel", () => {
    const c = getAnnounceConfig({ DISCORD_BOT_TOKEN: "b" });
    expect(c.discord).toEqual({ kind: "bot", channelId: DEFAULT_ANNOUNCE_CHANNEL_ID, botToken: "b" });
    expect(c.telegram).toBeNull();
    expect(c.timeZone).toBe("America/New_York");
  });

  it("prefers a webhook when ANNOUNCE_DISCORD_WEBHOOK_URL is set", () => {
    const c = getAnnounceConfig({
      DISCORD_BOT_TOKEN: "b",
      ANNOUNCE_DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/1/x",
    });
    expect(c.discord).toEqual({ kind: "webhook", url: "https://discord.test/api/webhooks/1/x" });
  });

  it("enables Telegram only with token and chat ids", () => {
    expect(getAnnounceConfig({ ANNOUNCE_TELEGRAM_BOT_TOKEN: "t" }).telegram).toBeNull();
    expect(
      getAnnounceConfig({ ANNOUNCE_TELEGRAM_BOT_TOKEN: "t", ANNOUNCE_TELEGRAM_CHAT_IDS: "1, 2" })
        .telegram,
    ).toEqual({ botToken: "t", chatIds: ["1", "2"] });
  });

  it("returns no Discord target when nothing is configured", () => {
    expect(getAnnounceConfig({}).discord).toBeNull();
  });
});

describe("postToTelegram", () => {
  it("sends to every chat and aggregates failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ description: "chat not found" }), { status: 400 }));
    await expect(postToTelegram({ botToken: "t", chatIds: ["1", "2"] }, "hi", fetchImpl)).rejects.toThrow(
      "Telegram failed for chat 2: 400 chat not found",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      chat_id: "1",
      text: "hi",
      parse_mode: "Markdown",
    });
  });
});
