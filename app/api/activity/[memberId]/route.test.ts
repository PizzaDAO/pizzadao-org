// app/api/activity/[memberId]/route.test.ts
//
// Smoke tests for the /api/activity/[memberId] BFF endpoint. The DB and
// session layers are stubbed so we just exercise the auth gate + shape +
// sort + cap behavior.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/session", () => ({
    getSession: vi.fn(),
}));

vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn(),
    fetchMemberById: vi.fn(),
}));

vi.mock("@/app/lib/db", () => ({
    prisma: {
        vouch: { findMany: vi.fn() },
        missionCompletion: { findMany: vi.fn() },
        unlockTicketClaim: { findMany: vi.fn() },
        notification: { findMany: vi.fn() },
        taskClaimEvent: { findMany: vi.fn() },
        poapFirstSeen: { findMany: vi.fn() },
        roleGrantEvent: { findMany: vi.fn() },
    },
}));

import { GET } from "./route";
import { getSession } from "@/app/lib/session";
import {
    fetchMemberIdByDiscordId,
    fetchMemberById,
} from "@/app/lib/sheets/member-repository";
import { prisma } from "@/app/lib/db";

function makeReq(memberId: string): {
    request: NextRequest;
    params: Promise<{ memberId: string }>;
} {
    return {
        request: new NextRequest(
            new URL(`/api/activity/${memberId}`, "http://localhost:3000"),
        ),
        params: Promise.resolve({ memberId }),
    };
}

describe("GET /api/activity/[memberId]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 401 when not authenticated", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const { request, params } = makeReq("42");
        const res = await GET(request, { params });
        expect(res.status).toBe(401);
    });

    it("returns 403 when viewer is not the owner", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "d1",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue(
            "7",
        );
        const { request, params } = makeReq("42");
        const res = await GET(request, { params });
        expect(res.status).toBe(403);
    });

    it("aggregates events from all sources, sorts desc, caps at 20", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "d1",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue(
            "42",
        );
        (fetchMemberById as ReturnType<typeof vi.fn>).mockResolvedValue({
            Name: "LasagnaLisa",
        });

        const now = Date.now();
        const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

        (prisma.vouch.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 1, followerId: "7", createdAt: new Date(now - 1000) },
            { id: 2, followerId: "8", createdAt: new Date(now - 5000) },
        ]);
        (prisma.missionCompletion.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([
                {
                    id: 10,
                    status: "APPROVED",
                    reviewedAt: new Date(now - 2000),
                    submittedAt: new Date(now - 3000),
                    missionId: 14,
                    mission: { title: "Welcome", level: 1 },
                },
                {
                    id: 11,
                    status: "REJECTED",
                    reviewedAt: new Date(now - 4000),
                    submittedAt: new Date(now - 5000),
                    missionId: 15,
                    mission: { title: "Vouch", level: 1 },
                },
            ]);
        (prisma.unlockTicketClaim.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([
                {
                    id: 20,
                    connectedAt: new Date(now - 6000),
                    ticketCount: 3,
                },
            ]);
        (prisma.notification.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([
                {
                    id: "n1",
                    title: "A thing happened",
                    linkUrl: "/missions",
                    createdAt: new Date(now - 7000),
                },
            ]);
        (prisma.taskClaimEvent.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([
                {
                    id: 30,
                    taskName: "Wire up the toaster",
                    sheetUrl: "https://docs.google.com/spreadsheets/d/abc",
                    claimedAt: new Date(now - 1500),
                },
            ]);
        (prisma.poapFirstSeen.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([
                {
                    id: 40,
                    title: "Pizza Party 2024",
                    poapEventId: "12345",
                    firstSeenAt: new Date(now - 2500),
                },
                {
                    id: 41,
                    title: null,
                    poapEventId: "12346",
                    firstSeenAt: new Date(now - 8500),
                },
            ]);
        (prisma.roleGrantEvent.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([
                {
                    id: 50,
                    roleName: "Tech",
                    grantedAt: new Date(now - 3500),
                },
            ]);

        const { request, params } = makeReq("42");
        const res = await GET(request, { params });
        expect(res.status).toBe(200);
        const body = await res.json();

        // Shape
        expect(Array.isArray(body.events)).toBe(true);
        for (const ev of body.events) {
            expect(typeof ev.id).toBe("string");
            expect(typeof ev.kind).toBe("string");
            expect(typeof ev.title).toBe("string");
            expect(typeof ev.at).toBe("string");
            expect(ev.href === null || typeof ev.href === "string").toBe(true);
        }

        // Total = 2 vouches + 2 missions + 1 ticket + 1 notification
        //       + 1 task_claim + 2 poaps + 1 role_grant = 10
        expect(body.events.length).toBe(10);

        // Descending by `at`
        const ats = body.events.map((e: { at: string }) => Date.parse(e.at));
        for (let i = 0; i + 1 < ats.length; i++) {
            expect(ats[i]).toBeGreaterThanOrEqual(ats[i + 1]);
        }

        // First event is the most recent vouch
        expect(body.events[0].kind).toBe("vouch_received");
        expect(body.events[0].title).toContain("LasagnaLisa");

        // Covers every wired kind, including the three added in
        // stuffed-crust-39669.
        const kinds = body.events.map((e: { kind: string }) => e.kind);
        expect(kinds).toContain("mission_approved");
        expect(kinds).toContain("mission_rejected");
        expect(kinds).toContain("ticket_added");
        expect(kinds).toContain("notification");
        expect(kinds).toContain("task_claimed");
        expect(kinds).toContain("poap_received");
        expect(kinds).toContain("role_granted");

        // Task claim renders the human-readable task name and deep-links
        // back to the source sheet.
        const claim = body.events.find(
            (e: { kind: string }) => e.kind === "task_claimed",
        );
        expect(claim.title).toContain("Wire up the toaster");
        expect(claim.href).toBe("https://docs.google.com/spreadsheets/d/abc");

        // POAP without a title falls back to a generic label, with a title
        // it gets prefixed.
        const poapsOut = body.events.filter(
            (e: { kind: string }) => e.kind === "poap_received",
        );
        expect(poapsOut).toHaveLength(2);
        expect(poapsOut.some((p: { title: string }) =>
            p.title === "POAP: Pizza Party 2024",
        )).toBe(true);
        expect(poapsOut.some((p: { title: string }) =>
            p.title === "POAP received",
        )).toBe(true);

        // Role grant has no href and renders the role name in the title.
        const role = body.events.find(
            (e: { kind: string }) => e.kind === "role_granted",
        );
        expect(role.title).toContain("Tech");
        expect(role.href).toBeNull();

        // Avoid unused-var lint hint
        void iso;
    });

    it("caps results at 20 events", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "d1",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue(
            "42",
        );
        (fetchMemberById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        // 10 vouches + 10 notifications = 20. Pile 10 ticket claims on top
        // → 30 raw, but cap should clip to 20.
        const now = Date.now();
        (prisma.vouch.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
            Array.from({ length: 10 }, (_, i) => ({
                id: 100 + i,
                followerId: "7",
                createdAt: new Date(now - i * 1000),
            })),
        );
        (prisma.missionCompletion.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([]);
        (prisma.unlockTicketClaim.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue(
                Array.from({ length: 10 }, (_, i) => ({
                    id: 200 + i,
                    connectedAt: new Date(now - (i + 10) * 1000),
                    ticketCount: 1,
                })),
            );
        (prisma.notification.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue(
                Array.from({ length: 10 }, (_, i) => ({
                    id: `n${i}`,
                    title: `Notif ${i}`,
                    linkUrl: null,
                    createdAt: new Date(now - (i + 20) * 1000),
                })),
            );
        // Explicitly empty for the new sources — keeps the cap test focused
        // on the original sources while exercising the new findMany calls.
        (prisma.taskClaimEvent.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([]);
        (prisma.poapFirstSeen.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([]);
        (prisma.roleGrantEvent.findMany as ReturnType<typeof vi.fn>)
            .mockResolvedValue([]);

        const { request, params } = makeReq("42");
        const res = await GET(request, { params });
        const body = await res.json();
        expect(body.events.length).toBe(20);
    });
});
