// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const postDiscordMessage = vi.fn();
const savedChannelId = vi.fn();
vi.mock("./discord-rest", () => ({ postDiscordMessage: (...a: unknown[]) => postDiscordMessage(...a) }));
vi.mock("./settings/channels", () => ({ savedChannelId: (...a: unknown[]) => savedChannelId(...a) }));
vi.mock("./crew-mappings", () => ({ getCrewMappings: vi.fn(async () => ({ crews: [] })) }));
vi.mock("./google-auth", () => ({
    getGoogleAuth: vi.fn(),
    GOOGLE_SCOPES: { sheetsReadonly: "x" },
    hasServiceAccountCredentials: () => false,
}));

import { postToPurpose, sendWelcomeMessage } from "./discord-webhook";

const BODY = { content: "hi", allowed_mentions: { parse: [] as Array<"users"> } };

describe("postToPurpose", () => {
    beforeEach(() => {
        postDiscordMessage.mockReset().mockResolvedValue({ id: "m" });
        savedChannelId.mockReset();
        process.env.DISCORD_BOT_TOKEN = "tok";
    });

    it("posts as the bot to the saved channel", async () => {
        savedChannelId.mockResolvedValue("1234567890123456");
        expect(await postToPurpose({ settingKey: "discord.supportChannelId", sheetName: "Support", body: BODY })).toBe(true);
        expect(postDiscordMessage).toHaveBeenCalledWith(
            { kind: "bot", channelId: "1234567890123456", botToken: "tok" },
            BODY,
        );
    });

    it("with no saved channel, warns once and returns false when no sheet webhook exists", async () => {
        savedChannelId.mockResolvedValue("");
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const o = { settingKey: "discord.spotlightChannelId" as const, sheetName: "Nope", body: BODY };
        expect(await postToPurpose(o)).toBe(false);
        expect(await postToPurpose(o)).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(postDiscordMessage).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe("sendWelcomeMessage", () => {
    it("pings only the new member", async () => {
        postDiscordMessage.mockReset().mockResolvedValue({ id: "m" });
        savedChannelId.mockResolvedValue("1234567890123456");
        process.env.DISCORD_BOT_TOKEN = "tok";
        const r = await sendWelcomeMessage({ discordId: "99", memberId: "5", mafiaName: "Sal" });
        expect(r.ok).toBe(true);
        const body = postDiscordMessage.mock.calls[0][1];
        expect(body.allowed_mentions).toEqual({ users: ["99"] });
        expect(body.content).toContain("<@99>");
    });
});
