// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("./discord-webhook", () => ({ getWebhookUrl: vi.fn().mockResolvedValue(null) }));

import { parseSubmissionInput as parseWithId, parseAdminUpdate, toMemberSubmission, toAdminSubmission, notifyNewSubmission } from "./spotlight";
import { getWebhookUrl } from "./discord-webhook";
import type { SpotlightSubmission } from "@prisma/client";

const parseSubmissionInput = (payload: unknown, id = "d1") => parseWithId(payload, id);

const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
afterEach(() => {
    if (savedToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = savedToken;
    vi.unstubAllGlobals();
});

const valid = { isSelf: true, pitch: "Built a thing", consent: true };

describe("parseSubmissionInput", () => {
    it("accepts a minimal self nomination and trims", () => {
        const r = parseSubmissionInput({ ...valid, pitch: "  Built a thing  ", city: "  NYC " });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.pitch).toBe("Built a thing");
            expect(r.value.city).toBe("NYC");
            expect(r.value.nomineeName).toBeNull();
            expect(r.value.links).toEqual([]);
        }
    });

    it("requires pitch and consent", () => {
        expect(parseSubmissionInput({ ...valid, pitch: "  " })).toMatchObject({ ok: false, field: "pitch" });
        expect(parseSubmissionInput({ ...valid, consent: false })).toMatchObject({ ok: false, field: "consent" });
        expect(parseSubmissionInput({ ...valid, consent: "true" })).toMatchObject({ ok: false, field: "consent" });
        expect(parseSubmissionInput(null)).toMatchObject({ ok: false });
    });

    it("requires a nominee name only when not self", () => {
        expect(parseSubmissionInput({ ...valid, isSelf: false })).toMatchObject({ ok: false, field: "nomineeName" });
        const r = parseSubmissionInput({ ...valid, isSelf: false, nomineeName: " Tony ", nomineeDiscord: " @tony " });
        expect(r.ok && r.value.nomineeName).toBe("Tony");
        expect(r.ok && r.value.nomineeDiscord).toBe("@tony");
    });

    it("caps field lengths", () => {
        expect(parseSubmissionInput({ ...valid, pitch: "a".repeat(2001) })).toMatchObject({ ok: false, field: "pitch" });
        expect(parseSubmissionInput({ ...valid, city: "a".repeat(101) })).toMatchObject({ ok: false, field: "city" });
        expect(parseSubmissionInput({ ...valid, isSelf: false, nomineeName: "a".repeat(101) })).toMatchObject({
            ok: false,
            field: "nomineeName",
        });
    });

    it("validates links: scheme, count, length", () => {
        const ok = parseSubmissionInput({ ...valid, links: ["https://a.com", " http://b.com ", ""] });
        expect(ok.ok && ok.value.links).toEqual(["https://a.com", "http://b.com"]);
        expect(parseSubmissionInput({ ...valid, links: ["javascript:alert(1)"] })).toMatchObject({ ok: false, field: "links" });
        expect(parseSubmissionInput({ ...valid, links: ["not a url"] })).toMatchObject({ ok: false, field: "links" });
        expect(parseSubmissionInput({ ...valid, links: ["https://a.com", "https://b.com", "https://c.com", "https://d.com"] })).toMatchObject({
            ok: false,
            field: "links",
        });
        expect(parseSubmissionInput({ ...valid, links: [`https://a.com/${"x".repeat(500)}`] })).toMatchObject({ ok: false, field: "links" });
        expect(parseSubmissionInput({ ...valid, links: "https://a.com" })).toMatchObject({ ok: false, field: "links" });
    });

    it("accepts only our own Blob photo under /spotlight/", () => {
        process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_AbC123_secret";
        const own = "https://abc123.public.blob.vercel-storage.com/spotlight/d1/x.png";
        const r = parseSubmissionInput({ ...valid, photoUrl: own });
        expect(r.ok && r.value.photoUrl).toBe(own);
        for (const bad of [
            "https://evil.com/spotlight/x.png",
            "https://other.public.blob.vercel-storage.com/spotlight/x.png",
            "https://abc123.public.blob.vercel-storage.com/suggestions/x.png",
            "https://abc123.public.blob.vercel-storage.com/spotlight/d2/x.png",
            123,
        ]) {
            expect(parseSubmissionInput({ ...valid, photoUrl: bad })).toMatchObject({ ok: false, field: "photoUrl" });
        }
    });
});

describe("parseAdminUpdate", () => {
    it("accepts status, notes and a date", () => {
        const r = parseAdminUpdate({ status: "FEATURED", adminNotes: " hi ", featuredOn: "2026-11-05" });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.status).toBe("FEATURED");
            expect(r.value.adminNotes).toBe("hi");
            expect(r.value.featuredOn).toBeInstanceOf(Date);
        }
        const cleared = parseAdminUpdate({ featuredOn: null, adminNotes: "  " });
        expect(cleared.ok && cleared.value).toEqual({ featuredOn: null, adminNotes: null });
    });

    it("rejects bad status, long notes, bad date and empty updates", () => {
        expect(parseAdminUpdate({ status: "NOPE" })).toMatchObject({ ok: false, field: "status" });
        expect(parseAdminUpdate({ adminNotes: "a".repeat(5001) })).toMatchObject({ ok: false, field: "adminNotes" });
        expect(parseAdminUpdate({ adminNotes: 5 })).toMatchObject({ ok: false, field: "adminNotes" });
        expect(parseAdminUpdate({ featuredOn: "not-a-date" })).toMatchObject({ ok: false, field: "featuredOn" });
        expect(parseAdminUpdate({})).toMatchObject({ ok: false });
    });
});

const row = (over: Partial<SpotlightSubmission> = {}): SpotlightSubmission => ({
    id: 1,
    submitterDiscordId: "d1",
    submitterMemberId: "42",
    submitterName: "Tony",
    isSelf: false,
    nomineeName: "Sal",
    nomineeDiscord: "@sal",
    nomineeDiscordId: null,
    nomineeMemberId: null,
    city: "NYC",
    pitch: "p".repeat(400),
    links: ["https://a.com"],
    photoUrl: null,
    consent: true,
    status: "NEW",
    featuredOn: null,
    adminNotes: "internal",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
});

describe("serializers", () => {
    it("member view omits admin notes and internal ids", () => {
        const m = toMemberSubmission(row());
        expect(m).not.toHaveProperty("adminNotes");
        expect(m).not.toHaveProperty("submitterDiscordId");
        expect(m).not.toHaveProperty("nomineeDiscord");
        expect(m.createdAt).toBe("2026-10-01T00:00:00.000Z");
    });

    it("admin view includes everything", () => {
        const a = toAdminSubmission(row());
        expect(a.adminNotes).toBe("internal");
        expect(a.submitterDiscordId).toBe("d1");
    });
});

describe("notifyNewSubmission", () => {
    it("returns false without a webhook row", async () => {
        expect(await notifyNewSubmission(row())).toBe(false);
    });

    it("posts a truncated pitch with mentions disabled and never throws", async () => {
        vi.mocked(getWebhookUrl).mockResolvedValueOnce("https://discord.test/hook");
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchMock);
        expect(await notifyNewSubmission(row())).toBe(true);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.allowed_mentions).toEqual({ parse: [] });
        expect(body.content).toContain("Sal");
        expect(body.content).not.toContain("p".repeat(400));
        expect(body.content).toContain("/admin/spotlight");

        vi.mocked(getWebhookUrl).mockResolvedValueOnce("https://discord.test/hook");
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
        expect(await notifyNewSubmission(row())).toBe(false);
    });
});
