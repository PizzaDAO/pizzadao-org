import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const hasAnyRole = vi.fn();
const notifyNewTicket = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }));
vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42"),
}));
// Never touch Discord in tests.
vi.mock("@/app/lib/discord-webhook", () => ({ getWebhookUrl: vi.fn().mockResolvedValue(null) }));
vi.mock("@/app/lib/support-tickets", async (orig) => {
    const actual = await orig<typeof import("@/app/lib/support-tickets")>();
    return { ...actual, notifyNewTicket: (...a: unknown[]) => notifyNewTicket(...a) };
});
vi.mock("@/app/lib/db", () => ({
    prisma: {
        supportTicket: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            count: vi.fn(),
        },
    },
}));

import { GET, POST } from "./route";
import { GET as ADMIN_GET } from "../../admin/support/tickets/route";
import { PATCH } from "../../admin/support/tickets/[id]/route";
import { prisma } from "@/app/lib/db";
import { NextRequest } from "next/server";

type Fn = ReturnType<typeof vi.fn>;
const st = (prisma as unknown as { supportTicket: Record<string, Fn> }).supportTicket;

const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    discordId: "d1",
    memberId: "42",
    displayName: "Tony",
    subject: "Help",
    body: "Broken",
    status: "OPEN",
    adminNotes: "internal note",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    closedAt: null,
    ...over,
});

function jsonReq(url: string, method: string, body: unknown) {
    return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ discordId: "d1", nick: "Tony", createdAt: Date.now() });
    hasAnyRole.mockResolvedValue(false);
    notifyNewTicket.mockResolvedValue(true);
    st.count.mockResolvedValue(0);
});

describe("/api/support/tickets", () => {
    it("requires a session", async () => {
        getSession.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        expect((await POST(jsonReq("http://x/api/support/tickets", "POST", {}))).status).toBe(401);
    });

    it("GET lists only the caller's tickets without admin notes", async () => {
        st.findMany.mockResolvedValue([row()]);
        const res = await GET();
        const json = await res.json();
        expect(st.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { discordId: "d1" } }));
        expect(json.tickets).toHaveLength(1);
        expect(json.tickets[0]).not.toHaveProperty("adminNotes");
    });

    it("POST validates input", async () => {
        const res = await POST(jsonReq("http://x", "POST", { subject: "", body: "x" }));
        expect(res.status).toBe(400);
        const res2 = await POST(jsonReq("http://x", "POST", { subject: "a".repeat(151), body: "x" }));
        expect(res2.status).toBe(400);
        expect(st.create).not.toHaveBeenCalled();
    });

    it("POST creates a ticket and notifies (mocked)", async () => {
        st.create.mockResolvedValue(row());
        const res = await POST(jsonReq("http://x", "POST", { subject: " Help ", body: "Broken" }));
        expect(res.status).toBe(201);
        expect(st.create).toHaveBeenCalledWith({
            data: { discordId: "d1", memberId: "42", displayName: "Tony", subject: "Help", body: "Broken" },
        });
        expect(notifyNewTicket).toHaveBeenCalledTimes(1);
    });

    it("POST rate-limits per day", async () => {
        st.count.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
        const res = await POST(jsonReq("http://x", "POST", { subject: "a", body: "b" }));
        expect(res.status).toBe(429);
        expect(st.create).not.toHaveBeenCalled();
    });
});

describe("/api/admin/support/tickets", () => {
    it("rejects non-admins", async () => {
        expect((await ADMIN_GET(new NextRequest("http://x/api/admin/support/tickets"))).status).toBe(403);
        const res = await PATCH(jsonReq("http://x", "PATCH", { status: "CLOSED" }), {
            params: Promise.resolve({ id: "1" }),
        });
        expect(res.status).toBe(403);
        expect(st.update).not.toHaveBeenCalled();
    });

    it("lists tickets with notes for admins", async () => {
        hasAnyRole.mockResolvedValue(true);
        st.findMany.mockResolvedValue([row()]);
        const json = await (await ADMIN_GET(new NextRequest("http://x/api/admin/support/tickets?status=OPEN"))).json();
        expect(st.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "OPEN" } }));
        expect(json.tickets[0].adminNotes).toBe("internal note");
    });

    it("rejects an invalid status filter", async () => {
        hasAnyRole.mockResolvedValue(true);
        expect((await ADMIN_GET(new NextRequest("http://x/api/admin/support/tickets?status=NOPE"))).status).toBe(400);
    });

    it("PATCH closes a ticket and sets closedAt", async () => {
        hasAnyRole.mockResolvedValue(true);
        st.findUnique.mockResolvedValue({ status: "OPEN" });
        st.update.mockResolvedValue(row({ status: "CLOSED", closedAt: new Date() }));
        const res = await PATCH(jsonReq("http://x", "PATCH", { status: "CLOSED", adminNotes: "fixed" }), {
            params: Promise.resolve({ id: "1" }),
        });
        expect(res.status).toBe(200);
        const { data } = st.update.mock.calls[0][0];
        expect(data.status).toBe("CLOSED");
        expect(data.adminNotes).toBe("fixed");
        expect(data.closedAt).toBeInstanceOf(Date);
    });

    it("PATCH reopening clears closedAt", async () => {
        hasAnyRole.mockResolvedValue(true);
        st.findUnique.mockResolvedValue({ status: "CLOSED" });
        st.update.mockResolvedValue(row());
        await PATCH(jsonReq("http://x", "PATCH", { status: "OPEN" }), { params: Promise.resolve({ id: "1" }) });
        expect(st.update.mock.calls[0][0].data).toEqual({ status: "OPEN", closedAt: null });
    });

    it("PATCH 404s on a missing ticket and 400s on a bad id", async () => {
        hasAnyRole.mockResolvedValue(true);
        st.findUnique.mockResolvedValue(null);
        expect(
            (await PATCH(jsonReq("http://x", "PATCH", { status: "OPEN" }), { params: Promise.resolve({ id: "9" }) }))
                .status,
        ).toBe(404);
        expect(
            (await PATCH(jsonReq("http://x", "PATCH", { status: "OPEN" }), { params: Promise.resolve({ id: "x" }) }))
                .status,
        ).toBe(400);
    });
});
