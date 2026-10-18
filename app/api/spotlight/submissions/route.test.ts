import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const hasAnyRole = vi.fn();
const notifyNewSubmission = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }));
vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42"),
}));
// Never touch Discord in tests.
vi.mock("@/app/lib/discord-webhook", () => ({ getWebhookUrl: vi.fn().mockResolvedValue(null) }));
vi.mock("@/app/lib/spotlight", async (orig) => {
    const actual = await orig<typeof import("@/app/lib/spotlight")>();
    return { ...actual, notifyNewSubmission: (...a: unknown[]) => notifyNewSubmission(...a) };
});
vi.mock("@/app/lib/db", () => ({
    prisma: {
        spotlightSubmission: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            count: vi.fn(),
        },
    },
}));

import { GET, POST } from "./route";
import { GET as ADMIN_GET } from "../../admin/spotlight/submissions/route";
import { PATCH } from "../../admin/spotlight/submissions/[id]/route";
import { prisma } from "@/app/lib/db";
import { NextRequest } from "next/server";

type Fn = ReturnType<typeof vi.fn>;
const ss = (prisma as unknown as { spotlightSubmission: Record<string, Fn> }).spotlightSubmission;

const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    submitterDiscordId: "d1",
    submitterMemberId: "42",
    submitterName: "Tony",
    isSelf: true,
    nomineeName: "Tony",
    nomineeDiscord: null,
    nomineeDiscordId: "d1",
    nomineeMemberId: "42",
    city: null,
    pitch: "Built a thing",
    links: [],
    photoUrl: null,
    consent: true,
    status: "NEW",
    featuredOn: null,
    adminNotes: "internal note",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
});

function jsonReq(url: string, method: string, body: unknown) {
    return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const good = { isSelf: true, pitch: "Built a thing", consent: true };

beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ discordId: "d1", nick: "Tony", createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(false);
    notifyNewSubmission.mockResolvedValue(true);
    ss.count.mockResolvedValue(0);
});

describe("/api/spotlight/submissions", () => {
    it("requires a session", async () => {
        getSession.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        expect((await POST(jsonReq("http://x", "POST", good))).status).toBe(401);
    });

    it("GET lists only the caller's rows without admin notes", async () => {
        ss.findMany.mockResolvedValue([row()]);
        const json = await (await GET()).json();
        expect(ss.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { submitterDiscordId: "d1" } }));
        expect(json.submissions).toHaveLength(1);
        expect(json.submissions[0]).not.toHaveProperty("adminNotes");
    });

    it("POST 400s with a field", async () => {
        const res = await POST(jsonReq("http://x", "POST", { ...good, pitch: "" }));
        expect(res.status).toBe(400);
        expect((await res.json()).field).toBe("pitch");
        expect(ss.create).not.toHaveBeenCalled();
    });

    it("POST self-nomination fills the nominee from the session and notifies", async () => {
        ss.create.mockResolvedValue(row());
        const res = await POST(jsonReq("http://x", "POST", good));
        expect(res.status).toBe(201);
        const { data } = ss.create.mock.calls[0][0];
        expect(data).toMatchObject({
            submitterDiscordId: "d1",
            submitterMemberId: "42",
            isSelf: true,
            nomineeName: "Tony",
            nomineeDiscordId: "d1",
            nomineeMemberId: "42",
            consent: true,
        });
        expect(notifyNewSubmission).toHaveBeenCalledTimes(1);
    });

    it("POST nominating someone else stores the typed nominee", async () => {
        ss.create.mockResolvedValue(row({ isSelf: false, nomineeName: "Sal" }));
        const res = await POST(jsonReq("http://x", "POST", { ...good, isSelf: false, nomineeName: "Sal", nomineeDiscord: "@sal" }));
        expect(res.status).toBe(201);
        expect(ss.create.mock.calls[0][0].data).toMatchObject({
            isSelf: false,
            nomineeName: "Sal",
            nomineeDiscord: "@sal",
            nomineeDiscordId: null,
        });
    });

    it("POST rate-limits per day and on pending", async () => {
        ss.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
        expect((await POST(jsonReq("http://x", "POST", good))).status).toBe(429);
        ss.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5);
        expect((await POST(jsonReq("http://x", "POST", good))).status).toBe(429);
        expect(ss.create).not.toHaveBeenCalled();
    });
});

describe("/api/admin/spotlight/submissions", () => {
    it("rejects non-admins", async () => {
        expect((await ADMIN_GET(new NextRequest("http://x/api/admin/spotlight/submissions"))).status).toBe(403);
        const res = await PATCH(jsonReq("http://x", "PATCH", { status: "FEATURED" }), { params: Promise.resolve({ id: "1" }) });
        expect(res.status).toBe(403);
        expect(ss.update).not.toHaveBeenCalled();
    });

    it("lists with notes and filters by status", async () => {
        hasAnyRole.mockResolvedValue(true);
        ss.findMany.mockResolvedValue([row()]);
        const json = await (await ADMIN_GET(new NextRequest("http://x/api/admin/spotlight/submissions?status=NEW"))).json();
        expect(ss.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "NEW" } }));
        expect(json.submissions[0].adminNotes).toBe("internal note");
    });

    it("rejects an invalid status filter", async () => {
        hasAnyRole.mockResolvedValue(true);
        expect((await ADMIN_GET(new NextRequest("http://x/api/admin/spotlight/submissions?status=NOPE"))).status).toBe(400);
    });

    it("PATCH FEATURED without a date defaults featuredOn to now", async () => {
        hasAnyRole.mockResolvedValue(true);
        ss.findUnique.mockResolvedValue({ status: "NEW", featuredOn: null });
        ss.update.mockResolvedValue(row({ status: "FEATURED" }));
        const res = await PATCH(jsonReq("http://x", "PATCH", { status: "FEATURED" }), { params: Promise.resolve({ id: "1" }) });
        expect(res.status).toBe(200);
        const { data } = ss.update.mock.calls[0][0];
        expect(data.status).toBe("FEATURED");
        expect(data.featuredOn).toBeInstanceOf(Date);
    });

    it("PATCH FEATURED keeps an explicit date", async () => {
        hasAnyRole.mockResolvedValue(true);
        ss.findUnique.mockResolvedValue({ status: "NEW", featuredOn: null });
        ss.update.mockResolvedValue(row({ status: "FEATURED" }));
        await PATCH(jsonReq("http://x", "PATCH", { status: "FEATURED", featuredOn: "2026-11-05" }), {
            params: Promise.resolve({ id: "1" }),
        });
        expect(ss.update.mock.calls[0][0].data.featuredOn.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    });

    it("PATCH 404s on a missing row and 400s on a bad id", async () => {
        hasAnyRole.mockResolvedValue(true);
        ss.findUnique.mockResolvedValue(null);
        expect(
            (await PATCH(jsonReq("http://x", "PATCH", { status: "NEW" }), { params: Promise.resolve({ id: "9" }) })).status,
        ).toBe(404);
        expect(
            (await PATCH(jsonReq("http://x", "PATCH", { status: "NEW" }), { params: Promise.resolve({ id: "x" }) })).status,
        ).toBe(400);
    });
});
