import { describe, it, expect, vi, beforeEach } from "vitest";

const postToPurpose = vi.fn();
vi.mock("./discord-webhook", () => ({ postToPurpose: (...a: unknown[]) => postToPurpose(...a) }));

import {
    parseTicketInput,
    parseAdminUpdate,
    toMemberTicket,
    toAdminTicket,
    notifyNewTicket,
    supportWebhookChannel,
    SUBJECT_MAX_LEN,
    BODY_MAX_LEN,
    ADMIN_NOTES_MAX_LEN,
} from "./support-tickets";

describe("parseTicketInput", () => {
    it("trims and accepts valid input", () => {
        expect(parseTicketInput({ subject: "  Help ", body: " broken " })).toEqual({
            ok: true,
            value: { subject: "Help", body: "broken" },
        });
    });

    it("requires subject and body", () => {
        expect(parseTicketInput({ body: "x" })).toMatchObject({ ok: false, field: "subject" });
        expect(parseTicketInput({ subject: "x", body: "   " })).toMatchObject({ ok: false, field: "body" });
        expect(parseTicketInput(null)).toMatchObject({ ok: false });
        expect(parseTicketInput({ subject: 5, body: ["x"] })).toMatchObject({ ok: false });
    });

    it("enforces length limits", () => {
        expect(parseTicketInput({ subject: "a".repeat(SUBJECT_MAX_LEN), body: "b" }).ok).toBe(true);
        expect(parseTicketInput({ subject: "a".repeat(SUBJECT_MAX_LEN + 1), body: "b" })).toMatchObject({
            ok: false,
            field: "subject",
        });
        expect(parseTicketInput({ subject: "a", body: "b".repeat(BODY_MAX_LEN + 1) })).toMatchObject({
            ok: false,
            field: "body",
        });
    });
});

describe("parseAdminUpdate", () => {
    it("accepts status and notes", () => {
        expect(parseAdminUpdate({ status: "IN_PROGRESS", adminNotes: " looking " })).toEqual({
            ok: true,
            value: { status: "IN_PROGRESS", adminNotes: "looking" },
        });
    });

    it("clears empty notes to null", () => {
        expect(parseAdminUpdate({ adminNotes: "  " })).toEqual({ ok: true, value: { adminNotes: null } });
        expect(parseAdminUpdate({ adminNotes: null })).toEqual({ ok: true, value: { adminNotes: null } });
    });

    it("rejects bad status, oversize notes, and empty updates", () => {
        expect(parseAdminUpdate({ status: "DONE" }).ok).toBe(false);
        expect(parseAdminUpdate({ adminNotes: "x".repeat(ADMIN_NOTES_MAX_LEN + 1) }).ok).toBe(false);
        expect(parseAdminUpdate({ adminNotes: 3 }).ok).toBe(false);
        expect(parseAdminUpdate({}).ok).toBe(false);
    });
});

const TICKET = {
    id: 7,
    discordId: "d1",
    memberId: "42",
    displayName: "Tony",
    subject: "Can't claim",
    body: "secret details",
    status: "OPEN" as const,
    adminNotes: "internal",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    closedAt: null,
};

describe("serialization", () => {
    it("member view omits admin notes and identity", () => {
        const m = toMemberTicket(TICKET);
        expect(m).not.toHaveProperty("adminNotes");
        expect(m).not.toHaveProperty("discordId");
        expect(m.createdAt).toBe("2026-10-01T00:00:00.000Z");
    });

    it("admin view includes notes", () => {
        expect(toAdminTicket(TICKET)).toMatchObject({ adminNotes: "internal", discordId: "d1", memberId: "42" });
    });
});

describe("notifyNewTicket", () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postToPurpose.mockReset();
        delete process.env.SUPPORT_DISCORD_CHANNEL;
    });

    it("returns false when nothing is configured", async () => {
        postToPurpose.mockResolvedValue(false);
        expect(await notifyNewTicket(TICKET)).toBe(false);
    });

    it("posts subject only (not body) with mentions disabled", async () => {
        postToPurpose.mockResolvedValue(true);
        expect(await notifyNewTicket(TICKET)).toBe(true);
        const arg = postToPurpose.mock.calls[0][0];
        expect(arg.settingKey).toBe("discord.supportChannelId");
        expect(arg.sheetName).toBe("Support");
        expect(arg.body.content).toContain("#7");
        expect(arg.body.content).toContain("Can't claim");
        expect(arg.body.content).not.toContain("secret details");
        expect(arg.body.allowed_mentions).toEqual({ parse: [] });
    });

    it("uses SUPPORT_DISCORD_CHANNEL when set", () => {
        process.env.SUPPORT_DISCORD_CHANNEL = "Tech";
        expect(supportWebhookChannel()).toBe("Tech");
    });

    it("never throws on post failure", async () => {
        postToPurpose.mockRejectedValue(new Error("down"));
        expect(await notifyNewTicket(TICKET)).toBe(false);
    });
});
