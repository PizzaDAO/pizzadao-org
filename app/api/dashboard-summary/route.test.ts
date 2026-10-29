import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchGuildMember = vi.fn();
const getGuildRoles = vi.fn();
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
    getVouchCounts: async () => ({ total: 0, pizzadao: 0, farcaster: 0, twitter: 0, followers: 0, pizzadaoFollowers: 0 }),
}));
vi.mock("@/app/lib/notifications", () => ({ getNotifications: async () => [], getUnreadCount: async () => 0 }));
vi.mock("@/app/lib/crew-mappings", () => ({ getCrewMappings: async () => ({ crews: [], cached: false }) }));
vi.mock("@/app/lib/my-tasks", () => ({ fetchMyTasksForCrew: async () => ({ active: [], doneCount: 0 }) }));
vi.mock("@/app/lib/pfp", () => ({ resolvePfpUrl: () => null }));
vi.mock("@/app/dashboard/[id]/lib/next-action", () => ({ resolveNextAction: (i: unknown) => resolveNextAction(i) }));
vi.mock("@/app/lib/discord", () => ({ fetchGuildMember: (...a: unknown[]) => fetchGuildMember(...a) }));
vi.mock("@/app/lib/discord-interactions/guild-roles", () => ({
    getGuildRoles: (...a: unknown[]) => getGuildRoles(...a),
}));
vi.mock("@/app/ui/constants", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/ui/constants")>()), MISSION_REVIEWER_ROLE_IDS: ["900001", "900002"] }));

async function call() {
    // Fresh import per call to bypass the route's 60s in-memory cache.
    vi.resetModules();
    const { GET: fresh } = await import("./route");
    const req = { nextUrl: { searchParams: new URLSearchParams({ memberId: "m1" }) } } as any;
    return (await fresh(req)).json();
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
