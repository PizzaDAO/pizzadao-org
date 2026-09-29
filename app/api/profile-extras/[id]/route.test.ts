// app/api/profile-extras/[id]/route.test.ts
//
// Plan: truffle-91035 (PR4 — burrata-13316).
//
// Verifies the public GET shape + the owner-only POST contract for the
// MemberProfileExtras tagline endpoint.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/session", () => ({
    getSession: vi.fn(),
}));

vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn(),
}));

vi.mock("@/app/lib/db", () => ({
    prisma: {
        memberProfileExtras: {
            findUnique: vi.fn(),
            upsert: vi.fn(),
        },
    },
}));

import { GET, POST, TAGLINE_MAX_LEN, getMemberTagline } from "./route";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { prisma } from "@/app/lib/db";

function extras() {
    return (
        prisma as unknown as {
            memberProfileExtras: {
                findUnique: ReturnType<typeof vi.fn>;
                upsert: ReturnType<typeof vi.fn>;
            };
        }
    ).memberProfileExtras;
}

function mkRequest(body: unknown): Request {
    return new Request("http://localhost/api/profile-extras/69", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

function paramsFor(id: string) {
    return { params: Promise.resolve({ id }) };
}

describe("GET /api/profile-extras/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the tagline when a row exists", async () => {
        extras().findUnique.mockResolvedValueOnce({ tagline: "Hello, pizza." });
        const res = await GET(new Request("http://x/") as never, paramsFor("69"));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ tagline: "Hello, pizza." });
    });

    it("returns { tagline: null } when no row exists", async () => {
        extras().findUnique.mockResolvedValueOnce(null);
        const res = await GET(new Request("http://x/") as never, paramsFor("404"));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tagline: null });
    });

    it("returns { tagline: null } when the prisma call throws (table missing, etc.)", async () => {
        extras().findUnique.mockRejectedValueOnce(new Error("relation does not exist"));
        const res = await GET(new Request("http://x/") as never, paramsFor("69"));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tagline: null });
    });
});

describe("POST /api/profile-extras/[id] — owner-only", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 401 when no session", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
        const res = await POST(mkRequest({ tagline: "hi" }) as never, paramsFor("69"));
        expect(res.status).toBe(401);
    });

    it("returns 403 when the viewer's memberId doesn't match", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            discordId: "discord-stranger",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            "42"
        );
        const res = await POST(mkRequest({ tagline: "hi" }) as never, paramsFor("69"));
        expect(res.status).toBe(403);
        expect(extras().upsert).not.toHaveBeenCalled();
    });

    it("returns 403 when the viewer has no resolvable memberId", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            discordId: "discord-orphan",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
        const res = await POST(mkRequest({ tagline: "hi" }) as never, paramsFor("69"));
        expect(res.status).toBe(403);
    });

    it("upserts and returns the saved value when viewer === owner", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            discordId: "discord-69",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            "69"
        );
        extras().upsert.mockResolvedValueOnce({ tagline: "Saved value" });

        const res = await POST(
            mkRequest({ tagline: "Saved value" }) as never,
            paramsFor("69")
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tagline: "Saved value" });

        expect(extras().upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { memberId: "69" },
                create: { memberId: "69", tagline: "Saved value" },
                update: { tagline: "Saved value" },
            })
        );
    });

    it("normalizes empty/whitespace input to null on save", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            discordId: "discord-69",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            "69"
        );
        extras().upsert.mockResolvedValueOnce({ tagline: null });

        const res = await POST(
            mkRequest({ tagline: "   " }) as never,
            paramsFor("69")
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tagline: null });
        expect(extras().upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { memberId: "69", tagline: null },
                update: { tagline: null },
            })
        );
    });

    it("rejects taglines longer than the max length", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            discordId: "discord-69",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            "69"
        );
        const tooLong = "a".repeat(TAGLINE_MAX_LEN + 1);
        const res = await POST(
            mkRequest({ tagline: tooLong }) as never,
            paramsFor("69")
        );
        expect(res.status).toBe(400);
        expect(extras().upsert).not.toHaveBeenCalled();
    });

    it("rejects a non-string tagline", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            discordId: "discord-69",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            "69"
        );
        const res = await POST(
            mkRequest({ tagline: 42 }) as never,
            paramsFor("69")
        );
        expect(res.status).toBe(400);
    });
});

describe("getMemberTagline (composer helper)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the tagline from the DB row", async () => {
        extras().findUnique.mockResolvedValueOnce({ tagline: "Hi" });
        expect(await getMemberTagline("69")).toBe("Hi");
    });

    it("returns null when row missing", async () => {
        extras().findUnique.mockResolvedValueOnce(null);
        expect(await getMemberTagline("404")).toBeNull();
    });

    it("returns null when DB throws (degrades to fallback)", async () => {
        extras().findUnique.mockRejectedValueOnce(new Error("nope"));
        expect(await getMemberTagline("69")).toBeNull();
    });

    it("returns null for missing memberId", async () => {
        expect(await getMemberTagline("")).toBeNull();
    });
});
