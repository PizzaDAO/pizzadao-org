// app/api/profile-summary/[id]/route.test.ts
//
// Plan: plans/truffle-91035-profile-redesign.md §6.3 / §6.5 — PR3 (capricciosa-16483).
//
// These tests exercise the composer directly (composeProfileSummary) so we
// can verify (a) the sensitive-fields strip behavior the public endpoint
// must guarantee, (b) the isOwner flag, and (c) that the aggregator merges
// supplementary data sources into the expected shape.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every upstream module the composer touches BEFORE importing it.
vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberById: vi.fn(),
    fetchMemberIdByDiscordId: vi.fn(),
}));

vi.mock("@/app/lib/missions", () => ({
    getUserProgressSummary: vi.fn(),
}));

vi.mock("@/app/lib/mafia-points", () => ({
    getMafiaRank: vi.fn(),
}));

vi.mock("@/app/lib/vouches", () => ({
    getVouchCounts: vi.fn(),
}));

vi.mock("@/app/lib/crew-mappings", () => ({
    getCrewMappings: vi.fn(),
}));

vi.mock("@/app/lib/db", () => ({
    prisma: {
        xAccount: {
            findFirst: vi.fn(),
        },
    },
}));

vi.mock("@/app/lib/session", () => ({
    getSession: vi.fn(),
}));

// PR4 — composer now reads tagline from MemberProfileExtras (Postgres).
vi.mock("@/app/api/profile-extras/[id]/route", () => ({
    getMemberTagline: vi.fn(),
}));

// Stub fs to avoid touching disk during pfp resolution.
vi.mock("fs", async () => {
    const actual = await vi.importActual<typeof import("fs")>("fs");
    return {
        ...actual,
        existsSync: () => false,
    };
});

import { composeProfileSummary, SENSITIVE_SHEET_KEYS } from "./route";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { getUserProgressSummary } from "@/app/lib/missions";
import { getMafiaRank } from "@/app/lib/mafia-points";
import { getVouchCounts } from "@/app/lib/vouches";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { prisma } from "@/app/lib/db";
import { getMemberTagline } from "@/app/api/profile-extras/[id]/route";

const memberRow: Record<string, unknown> = {
    discordId: "discord-69",
    Name: "Turkey Sausage",
    "Mafia Name": "Turkey 'The Sausage' Bird",
    City: "Brooklyn",
    Tagline: "Pizza maker extraordinaire",
    Specialties: "Pizza ovens, dough",
    Affiliation: "PizzaDAO, Brooklyn Pizza",
    Crews: "Tech, Comms",
    Turtles: "🍕 Pizza Hacker, 🐢 Veteran",
    // Sensitive fields that MUST NOT leak through.
    discordid: "leaky-discord-id",
    discord: "leakydiscord#1234",
    telegram: "@leakyTelegram",
    email: "leak@example.com",
    wallet: "0xLEAKDEADBEEF000000000000000000000000",
    address: "123 Leak Street",
};

function setupHappyPath() {
    (fetchMemberById as ReturnType<typeof vi.fn>).mockResolvedValue(memberRow);
    (getUserProgressSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
        currentLevel: 3,
        levelTitle: "Pizzaiolo",
        totalMissions: 14,
        approvedCount: 5,
        currentLevelMissions: 2,
        currentLevelApproved: 1,
    });
    (getMafiaRank as ReturnType<typeof vi.fn>).mockResolvedValue({
        memberId: "69",
        memberName: "Turkey Sausage",
        rank: { name: "Made Man", minPoints: 100 },
        lastCalculated: Date.now(),
    });
    (getVouchCounts as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 4,
        pizzadao: 3,
        farcaster: 1,
        twitter: 0,
        followers: 7,
    });
    (
        prisma as unknown as {
            xAccount: { findFirst: ReturnType<typeof vi.fn> };
        }
    ).xAccount.findFirst.mockResolvedValue({ xUsername: "turkeysausage" });
    (getCrewMappings as ReturnType<typeof vi.fn>).mockResolvedValue({
        crews: [
            { id: "tech", label: "Tech", turtles: [], emoji: "🛠" },
            { id: "comms", label: "Comms", turtles: [], emoji: "📣" },
        ],
        cached: false,
    });
    // Default: no Postgres tagline → composer falls back to the sheet column.
    (getMemberTagline as ReturnType<typeof vi.fn>).mockResolvedValue(null);
}

describe("composeProfileSummary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupHappyPath();
    });

    it("returns null when the member sheet row doesn't exist", async () => {
        (fetchMemberById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
        const summary = await composeProfileSummary({
            memberId: "ghost",
            viewerMemberId: null,
        });
        expect(summary).toBeNull();
    });

    it("merges expected fields into the hero / about / crew shape", async () => {
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        expect(summary).not.toBeNull();
        expect(summary!.hero.name).toBe("Turkey Sausage");
        expect(summary!.hero.city).toBe("Brooklyn");
        expect(summary!.hero.tagline).toBe("Pizza maker extraordinaire");
        expect(summary!.hero.level).toBe(3);
        expect(summary!.hero.levelTitle).toBe("Pizzaiolo");
        expect(summary!.hero.mafiaRank).toEqual({ rank: 100, tier: "Made Man" });
        expect(summary!.hero.vouchInCount).toBe(7);

        expect(summary!.about.skills).toBe("Pizza ovens, dough");
        expect(summary!.about.orgs).toBe("PizzaDAO, Brooklyn Pizza");
        expect(summary!.about.turtles).toEqual([
            "🍕 Pizza Hacker",
            "🐢 Veteran",
        ]);
        expect(summary!.about.xAccount).toEqual({
            connected: true,
            username: "turkeysausage",
        });

        expect(summary!.crewIds).toEqual(["Tech", "Comms"]);
        expect(summary!.crewOptions).toHaveLength(2);
    });

    it("strips sensitive sheet fields — none leak into the response payload", async () => {
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        // Walk the entire response and assert no sensitive key (case-insensitive)
        // appears anywhere.
        const serialized = JSON.stringify(summary);
        for (const key of SENSITIVE_SHEET_KEYS) {
            // Match `"key":` at any case — JSON keys are always quoted.
            const pattern = new RegExp(`"${key}"\\s*:`, "i");
            expect(pattern.test(serialized)).toBe(false);
        }
        // Also explicitly check the values don't appear.
        expect(serialized).not.toContain("leaky-discord-id");
        expect(serialized).not.toContain("leakydiscord#1234");
        expect(serialized).not.toContain("@leakyTelegram");
        expect(serialized).not.toContain("leak@example.com");
        expect(serialized).not.toContain("0xLEAKDEADBEEF");
        expect(serialized).not.toContain("123 Leak Street");
    });

    it("isOwner === true when viewer matches the requested memberId", async () => {
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: "69",
        });
        expect(summary!.isOwner).toBe(true);
        expect(summary!.viewerId).toBe("69");
    });

    it("isOwner === false when viewer is a different member", async () => {
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: "42",
        });
        expect(summary!.isOwner).toBe(false);
        expect(summary!.viewerId).toBe("42");
    });

    it("isOwner === false when viewer is not signed in", async () => {
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        expect(summary!.isOwner).toBe(false);
        expect(summary!.viewerId).toBeNull();
    });

    it("hero.level is null when the member has no approved missions yet", async () => {
        (getUserProgressSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            currentLevel: 1,
            levelTitle: null,
            totalMissions: 14,
            approvedCount: 0,
            currentLevelMissions: 2,
            currentLevelApproved: 0,
        });
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        expect(summary!.hero.level).toBeNull();
        expect(summary!.hero.levelTitle).toBe("");
    });

    it("hero.level becomes 'MAX' when the member is past level 8", async () => {
        (getUserProgressSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            currentLevel: 9,
            levelTitle: "Capo",
            totalMissions: 14,
            approvedCount: 14,
            currentLevelMissions: 0,
            currentLevelApproved: 0,
        });
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        expect(summary!.hero.level).toBe("MAX");
    });

    it("xAccount is { connected: false } when no row exists", async () => {
        (
            prisma as unknown as {
                xAccount: { findFirst: ReturnType<typeof vi.fn> };
            }
        ).xAccount.findFirst.mockResolvedValueOnce(null);
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        expect(summary!.about.xAccount).toEqual({ connected: false });
    });

    // ---- PR4 — tagline precedence -----------------------------------------

    it("prefers MemberProfileExtras.tagline over the sheet 'Tagline' column", async () => {
        (getMemberTagline as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            "DB wins — Postgres tagline"
        );
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        // The sheet row's "Tagline" is "Pizza maker extraordinaire" — DB
        // must win.
        expect(summary!.hero.tagline).toBe("DB wins — Postgres tagline");
    });

    it("falls back to the sheet 'Tagline' column when Postgres has no row", async () => {
        // getMemberTagline returns null (default from setupHappyPath).
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        expect(summary!.hero.tagline).toBe("Pizza maker extraordinaire");
    });

    it("treats an empty/whitespace Postgres tagline as no value (falls back to sheet)", async () => {
        (getMemberTagline as ReturnType<typeof vi.fn>).mockResolvedValueOnce("   ");
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        // Whitespace-only DB tagline shouldn't override a real sheet value.
        expect(summary!.hero.tagline).toBe("Pizza maker extraordinaire");
    });

    it("returns empty tagline when neither Postgres nor sheet has one", async () => {
        (fetchMemberById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ...memberRow,
            Tagline: "",
        });
        (getMemberTagline as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        expect(summary!.hero.tagline).toBe("");
    });

    it("degrades gracefully when supplementary calls reject", async () => {
        (getUserProgressSummary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error("boom")
        );
        (getMafiaRank as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error("boom")
        );
        (getVouchCounts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error("boom")
        );
        const summary = await composeProfileSummary({
            memberId: "69",
            viewerMemberId: null,
        });
        // Core member shape still resolves.
        expect(summary!.hero.name).toBe("Turkey Sausage");
        expect(summary!.hero.level).toBeNull();
        expect(summary!.hero.mafiaRank).toBeNull();
        expect(summary!.hero.vouchInCount).toBe(0);
    });
});
