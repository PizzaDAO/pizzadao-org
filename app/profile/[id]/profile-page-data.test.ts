// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const prefetchRoute = vi.fn();
vi.mock("@/app/lib/server-prefetch", () => ({ prefetchRoute: (...a: unknown[]) => prefetchRoute(...a) }));
vi.mock("@/app/api/profile-summary/[id]/route", () => ({
    withDeadline: async (p: Promise<unknown>, ms: number, fb: unknown) => {
        let t: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise((r) => {
            t = setTimeout(() => r({ value: fb, timedOut: true }), ms);
        });
        try {
            return await Promise.race([p.then((value) => ({ value, timedOut: false })), timeout]);
        } finally {
            clearTimeout(t);
        }
    },
}));
vi.mock("@/app/api/attendance/[memberId]/route", () => ({ GET: "attendance" }));
vi.mock("@/app/api/articles/by-member/[memberId]/route", () => ({ GET: "articles" }));
vi.mock("@/app/api/passport/[memberId]/route", () => ({ GET: "passport" }));
vi.mock("@/app/api/vouches/route", () => ({ GET: "vouches" }));
vi.mock("@/app/api/vouches/vouchers/route", () => ({ GET: "vouchers" }));

import { loadProfilePrefill, partialSummaryFromLight, PREFILL_BUDGET_MS } from "./profile-page-data";

beforeEach(() => {
    prefetchRoute.mockReset();
    prefetchRoute.mockImplementation(async (handler: string) => ({ from: handler }));
});

describe("loadProfilePrefill", () => {
    it("loads the five sections, passing route params where the route needs them", async () => {
        const r = await loadProfilePrefill("7", { anonymous: true });
        expect(r).toEqual({
            articles: { from: "articles" },
            vouches: { from: "vouches" },
            vouchers: { from: "vouchers" },
            attendance: { from: "attendance" },
            passport: { from: "passport" },
        });
        const att = prefetchRoute.mock.calls.find((c) => c[0] === "attendance")!;
        expect(att[1]).toBe("/api/attendance/7");
        expect(await (att[2] as { params: Promise<{ memberId: string }> }).params).toEqual({ memberId: "7" });
    });

    it("never prefetches the passport for a request that has a session cookie", async () => {
        const r = await loadProfilePrefill("7", { anonymous: false });
        expect(r.passport).toBeNull();
        expect(prefetchRoute.mock.calls.some((c) => c[0] === "passport")).toBe(false);
    });

    it("a slow section is dropped at its budget (the client fetches it) and does not hold the others", async () => {
        prefetchRoute.mockImplementation(async (handler: string) => (handler === "articles" ? new Promise(() => {}) : { from: handler }));
        const started = Date.now();
        const r = await loadProfilePrefill("7", { anonymous: true });
        expect(Date.now() - started).toBeLessThan(PREFILL_BUDGET_MS + 250);
        expect(r.articles).toBeNull();
        expect(r.attendance).toEqual({ from: "attendance" });
    });
});

describe("partialSummaryFromLight", () => {
    const light = {
        hero: { name: "Pat", pfpUrl: "/p.png", tagline: "hi", city: "Rome", level: 4, levelTitle: "X", mafiaRank: { rank: 1, tier: "T" }, vouchInCount: 9, memberSince: "2020-01-01" },
        about: { skills: "s", orgs: "o", turtles: ["t"], xAccount: { connected: false } },
        discordActivity: null,
        crewIds: ["Tech", "community_call", "community"],
        crewOptions: [],
        viewerId: "me",
        isOwner: true,
    };
    it("keeps hero, about and crews, drops the Community Call, and is flagged partial", () => {
        const p = partialSummaryFromLight(light as never);
        expect(p.hero).toMatchObject({ name: "Pat", pfpUrl: "/p.png", tagline: "hi", city: "Rome", level: null, mafiaRank: null, vouchInCount: 0, memberSince: null });
        expect(p.about).toEqual({ skills: "s", orgs: "o", turtles: ["t"], xAccount: null });
        expect(p.crewIds).toEqual(["Tech"]);
        expect(p.partial).toBe(true);
    });
    it("carries no viewer", () => {
        const p = partialSummaryFromLight(light as never);
        expect(p.viewerId).toBeNull();
        expect(p.isOwner).toBe(false);
    });
});
