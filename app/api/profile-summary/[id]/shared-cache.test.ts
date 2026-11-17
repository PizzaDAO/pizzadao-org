// The shared (unstable_cache) layer behind getPublicProfileSummary: only complete, viewer-independent
// summaries are stored, under a tagged key, and write paths can expire them.

import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
const cacheCalls: Array<{ key: string; opts: { revalidate?: number; tags?: string[] } }> = [];
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
    revalidateTag: (...a: unknown[]) => revalidateTag(...a),
    unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], opts: { revalidate?: number; tags?: string[] }) => async () => {
        const key = keyParts.join("|");
        cacheCalls.push({ key, opts });
        const hit = store.get(key);
        if (hit !== undefined) return JSON.parse(hit);
        const value = await fn(); // a throw propagates and nothing is stored, like the real cache
        store.set(key, JSON.stringify(value));
        return value;
    },
}));

vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberById: vi.fn(), fetchMemberIdByDiscordId: vi.fn(), MEMBERS_CACHE_TAG: "members" }));
vi.mock("@/app/lib/missions", () => ({ getUserProgressSummary: vi.fn(async () => null) }));
vi.mock("@/app/lib/mafia-points", () => ({ getMafiaRank: vi.fn(async () => null) }));
vi.mock("@/app/lib/vouches", () => ({ getVouchCounts: vi.fn(async () => ({ followers: 2 })) }));
vi.mock("@/app/lib/crew-mappings", () => ({ getCrewMappings: vi.fn(async () => ({ crews: [], cached: false })) }));
vi.mock("@/app/lib/db", () => ({ prisma: { xAccount: { findFirst: vi.fn(async () => null) } } }));
vi.mock("@/app/lib/discord-activity-public", () => ({ getPublicDiscordActivity: vi.fn(async () => null) }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/app/api/profile-extras/[id]/route", () => ({ getMemberTagline: vi.fn(async () => null) }));
vi.mock("@/app/lib/pfp", () => ({ resolvePfpUrlAsync: vi.fn(async () => null) }));
vi.mock("@/app/lib/member-since", () => ({ resolveMemberSince: vi.fn(async () => null), monthPrecisionIso: () => null }));

import { getPublicProfileSummary } from "./route";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { getPublicDiscordActivity } from "@/app/lib/discord-activity-public";
import { invalidateProfileSummary, profileL1, PROFILE_MEMBERS_TAG } from "@/app/lib/profile-summary-cache";
import { MEMBERS_CACHE_TAG } from "@/app/lib/sheets/member-repository";

const member = { discordId: "d1", Name: "Pat", City: "Rome", Crews: "Tech, Community Call", email: "leak@example.com", wallet: "0xLEAK" };

beforeEach(() => {
    store.clear();
    cacheCalls.length = 0;
    profileL1.clear();
    vi.clearAllMocks();
    vi.mocked(fetchMemberById).mockResolvedValue(member as never);
    vi.mocked(getPublicDiscordActivity).mockResolvedValue(null);
});

describe("getPublicProfileSummary shared cache", () => {
    it("uses the members tag and a per-profile tag, with a 5 minute revalidate", async () => {
        await getPublicProfileSummary("7");
        expect(cacheCalls[0].key).toBe("profile-summary-v1|7");
        expect(cacheCalls[0].opts).toEqual({ revalidate: 300, tags: ["members", "profile:7"] });
        expect(PROFILE_MEMBERS_TAG).toBe(MEMBERS_CACHE_TAG);
    });

    it("stores a complete summary once: a second instance does not recompose", async () => {
        const first = await getPublicProfileSummary("7");
        expect(first!.hero.name).toBe("Pat");
        expect(fetchMemberById).toHaveBeenCalledTimes(1);
        profileL1.clear(); // a different instance: empty memory, same shared cache
        const second = await getPublicProfileSummary("7");
        expect(second).toEqual(first);
        expect(fetchMemberById).toHaveBeenCalledTimes(1);
    });

    it("stores only public, viewer-independent data", async () => {
        await getPublicProfileSummary("7");
        const raw = [...store.values()][0];
        expect(raw).not.toMatch(/leak@example|0xLEAK|d1/);
        const parsed = JSON.parse(raw);
        expect(parsed.viewerId).toBeNull();
        expect(parsed.isOwner).toBe(false);
        expect(parsed.partial).toBeUndefined();
        expect(parsed.crewIds).toEqual(["Tech"]); // Community Call is not a crew
    });

    it("does not store a summary that missed a deadline, but still returns it", async () => {
        vi.useFakeTimers();
        try {
            vi.mocked(getPublicDiscordActivity).mockReturnValueOnce(new Promise(() => {}));
            const p = getPublicProfileSummary("8");
            await vi.advanceTimersByTimeAsync(2000);
            const summary = await p;
            expect(summary!.hero.name).toBe("Pat");
            expect(store.size).toBe(0);
            expect(profileL1.size).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not store a missing member", async () => {
        vi.mocked(fetchMemberById).mockResolvedValue(null as never);
        expect(await getPublicProfileSummary("404")).toBeNull();
        expect(store.size).toBe(0);
    });
});

describe("invalidateProfileSummary", () => {
    it("expires the profile tag immediately and drops this instance's memory copy", async () => {
        await getPublicProfileSummary("7");
        expect(profileL1.has("7")).toBe(true);
        invalidateProfileSummary("7");
        expect(profileL1.has("7")).toBe(false);
        expect(revalidateTag).toHaveBeenCalledWith("profile:7", { expire: 0 });
    });

    it("ignores an empty id", () => {
        invalidateProfileSummary("");
        invalidateProfileSummary(null);
        expect(revalidateTag).not.toHaveBeenCalled();
    });
});
