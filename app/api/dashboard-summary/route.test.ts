import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchGuildMember = vi.fn();
const getGuildRoles = vi.fn();
let vouchCounts = { total: 0, pizzadao: 0, farcaster: 0, twitter: 0, followers: 0, pizzadaoFollowers: 0 };
const resolveNextAction = vi.fn((_input: unknown) => ({ kind: "join_crew" }));

vi.mock("@/app/lib/session", () => ({ getSession: async () => ({ discordId: "d1" }) }));
vi.mock("@/app/lib/db", () => ({
    prisma: { memberWallet: { findMany: async () => [] }, xAccount: { findFirst: async () => null } },
}));
vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberById: async () => ({ Name: "Test" }),
    fetchMemberIdByDiscordId: async () => "m1",
}));
vi.mock("@/app/lib/economy", () => ({ getBalance: async () => ({ balance: 1 }) }));
vi.mock("@/app/lib/missions", () => ({
    getMissionsByLevel: async () => ({}),
    getUserMissionProgress: async () => [],
    getCurrentLevel: async () => 1,
    getLevelTitle: async () => null,
}));
vi.mock("@/app/lib/vouches", () => ({
    getVouchCounts: async () => vouchCounts,
}));
vi.mock("@/app/lib/notifications", () => ({ getNotifications: async () => [], getUnreadCount: async () => 0 }));
vi.mock("@/app/lib/crew-mappings", () => ({ getCrewMappings: async () => ({ crews: [], cached: false }) }));
vi.mock("@/app/lib/my-tasks", () => ({ fetchMyTasksForCrew: async () => ({ active: [], doneCount: 0 }) }));
vi.mock("@/app/lib/pfp", () => ({ resolvePfpUrlAsync: async () => null }));
vi.mock("@/app/dashboard/[id]/lib/next-action", () => ({ resolveNextAction: (i: unknown) => resolveNextAction(i) }));
vi.mock("@/app/lib/discord", () => ({ fetchGuildMember: (...a: unknown[]) => fetchGuildMember(...a) }));
vi.mock("@/app/lib/discord-interactions/guild-roles", () => ({
    getGuildRoles: (...a: unknown[]) => getGuildRoles(...a),
}));
vi.mock("@/app/ui/constants", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/ui/constants")>()), MISSION_REVIEWER_ROLE_IDS: ["900001", "900002"] }));

async function call(search: Record<string, string> = {}, headers: Record<string, string> = {}) {
    // Fresh import per call to bypass the route's 60s in-memory cache.
    vi.resetModules();
    const { GET: fresh } = await import("./route");
    return (await fresh(makeReq(search, headers))).json();
}

function makeReq(search: Record<string, string> = {}, headers: Record<string, string> = {}) {
    const h = new Headers(headers);
    return { nextUrl: { searchParams: new URLSearchParams({ memberId: "m1", ...search }) }, headers: h } as any;
}

describe("GET /api/dashboard-summary reviewer + Box Mafia", () => {
    beforeEach(() => {
        fetchGuildMember.mockReset();
        getGuildRoles.mockReset();
        resolveNextAction.mockClear();
        process.env.DISCORD_GUILD_ID = "g1";
        getGuildRoles.mockResolvedValue([{ id: "222222", name: "Box Mafia" }]);
    });
    afterEach(() => {
        delete process.env.DISCORD_GUILD_ID;
    });

    it("reviewer true + has_role", async () => {
        fetchGuildMember.mockResolvedValue({ roles: ["900002", "222222"] });
        const body = await call();
        expect(resolveNextAction).toHaveBeenCalledWith(expect.objectContaining({ isReviewer: true }));
        expect(body.boxMafia.status).toBe("has_role");
        expect(body.boxMafia.dailyPep).toBe(42);
        expect(fetchGuildMember).toHaveBeenCalledTimes(1);
    });

    it("reviewer false + missing", async () => {
        fetchGuildMember.mockResolvedValue({ roles: ["111111"] });
        const body = await call();
        expect(resolveNextAction).toHaveBeenCalledWith(expect.objectContaining({ isReviewer: false }));
        expect(body.boxMafia.status).toBe("missing");
    });

    it("null member -> not reviewer, unknown", async () => {
        fetchGuildMember.mockResolvedValue(null);
        const body = await call();
        expect(resolveNextAction).toHaveBeenCalledWith(expect.objectContaining({ isReviewer: false }));
        expect(body.boxMafia.status).toBe("unknown");
    });

    it("unknown when the role cannot be found", async () => {
        fetchGuildMember.mockResolvedValue({ roles: ["111111"] });
        getGuildRoles.mockResolvedValue(null);
        const body = await call();
        expect(body.boxMafia.status).toBe("unknown");
    });
});

describe("GET /api/dashboard-summary startHere vouches", () => {
    afterEach(() => {
        vouchCounts = { total: 0, pizzadao: 0, farcaster: 0, twitter: 0, followers: 0, pizzadaoFollowers: 0 };
    });
    it("counts vouches received, not the ones the member gave", async () => {
        vouchCounts = { ...vouchCounts, total: 4, followers: 0 };
        expect((await call()).startHere.vouchesReceived).toBe(0);
        vouchCounts = { ...vouchCounts, total: 0, followers: 2 };
        expect((await call()).startHere.vouchesReceived).toBe(2);
    });
});

describe("GET /api/dashboard-summary freshness", () => {
    afterEach(() => {
        vouchCounts = { total: 0, pizzadao: 0, farcaster: 0, twitter: 0, followers: 0, pizzadaoFollowers: 0 };
    });
    async function twoCalls(search: Record<string, string>, headers: Record<string, string>) {
        vi.resetModules();
        const { GET } = await import("./route");
        vouchCounts = { ...vouchCounts, followers: 1 };
        const first = await GET(makeReq());
        vouchCounts = { ...vouchCounts, followers: 5 };
        const second = await GET(makeReq(search, headers));
        return { first, second, secondBody: await second.json(), firstBody: await first.json(), GET };
    }
    it("serves the cached summary with max-age by default", async () => {
        const r = await twoCalls({}, {});
        expect(r.firstBody.startHere.vouchesReceived).toBe(1);
        expect(r.secondBody.startHere.vouchesReceived).toBe(1);
        expect(r.second.headers.get("Cache-Control")).toContain("max-age=60");
    });
    it("?fresh=1 bypasses and refreshes the cache and answers no-store", async () => {
        const r = await twoCalls({ fresh: "1" }, {});
        expect(r.secondBody.startHere.vouchesReceived).toBe(5);
        expect(r.second.headers.get("Cache-Control")).toBe("private, no-store");
        vouchCounts = { ...vouchCounts, followers: 9 };
        const later = await r.GET(makeReq());
        expect((await later.json()).startHere.vouchesReceived).toBe(5);
    });
    it("a Cache-Control: no-cache request header does the same", async () => {
        const r = await twoCalls({}, { "Cache-Control": "no-cache" });
        expect(r.secondBody.startHere.vouchesReceived).toBe(5);
        expect(r.second.headers.get("Cache-Control")).toBe("private, no-store");
    });
});
