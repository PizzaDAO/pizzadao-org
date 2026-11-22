import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: {} as Record<string, unknown>, fail: new Set<string>() }));
vi.mock("@/app/lib/settings", () => ({
    getSetting: async (key: string) => {
        if (settings.fail.has(key)) throw new Error("unreadable");
        return settings.values[key];
    },
}));
vi.mock("@/app/lib/settings/roles", () => ({ articleAuthorRoleIds: async () => ["900000000000000001"] }));
vi.mock("@/app/lib/auth-guards", () => ({ hasAnyRoleSafe: vi.fn(), requireSession: vi.fn() }));

import { holdsPrivilegedRole, privilegedRoleIds, legacyPrivilegedUserIds } from "./signin-privileged";
import { ADMIN_ROLE_IDS, CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID } from "@/app/ui/constants";
import { LEGACY_ANNOUNCE_DISCORD_IDS } from "@/app/lib/announce/access";

const saved = { ...process.env };

beforeEach(() => {
    delete process.env.ANNOUNCE_ROLE_IDS;
    delete process.env.ADMIN_ROLE_IDS;
    settings.fail.clear();
    settings.values = {
        "missions.reviewerRoleIds": ["800000000000000001"],
        "newsletter.approverRoleIds": ["800000000000000002"],
        "announce.roleIds": [],
        "calls.liveHostRoleIds": "810000000000000001\n\n not-an-id \n810000000000000002",
    };
});
afterEach(() => {
    process.env = { ...saved };
});

describe("privileged roles for Telegram sign-in", () => {
    it("covers the pinned roles and every saved list", async () => {
        const ids = await privilegedRoleIds();
        for (const id of [...ADMIN_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, ...CALL_CAPO_ROLE_IDS]) expect(ids.has(id)).toBe(true);
        for (const id of ["800000000000000001", "800000000000000002", "810000000000000001", "810000000000000002", "900000000000000001"]) {
            expect(ids.has(id)).toBe(true);
        }
        expect(ids.has("not-an-id")).toBe(false);
    });

    it("follows the same announce chain canAnnounce uses: saved, then env roles, then env admin roles", async () => {
        process.env.ANNOUNCE_ROLE_IDS = "820000000000000001";
        expect((await privilegedRoleIds()).has("820000000000000001")).toBe(true);
        delete process.env.ANNOUNCE_ROLE_IDS;
        process.env.ADMIN_ROLE_IDS = "820000000000000002";
        expect((await privilegedRoleIds()).has("820000000000000002")).toBe(true);
        settings.values["announce.roleIds"] = ["820000000000000003"];
        expect((await privilegedRoleIds()).has("820000000000000003")).toBe(true);
    });

    it("treats the legacy announce user ids as privileged only while they are the active fallback", async () => {
        const legacy = LEGACY_ANNOUNCE_DISCORD_IDS[0];
        expect(legacyPrivilegedUserIds()).toContain(legacy);
        expect(await holdsPrivilegedRole([], legacy)).toBe(true);
        process.env.ANNOUNCE_ROLE_IDS = "820000000000000001";
        expect(legacyPrivilegedUserIds()).toEqual([]);
        expect(await holdsPrivilegedRole([], legacy)).toBe(false);
    });

    it("an ordinary member is not privileged, a holder of any listed role is", async () => {
        expect(await holdsPrivilegedRole(["700000000000000001"], "1")).toBe(false);
        expect(await holdsPrivilegedRole(["700000000000000001", "810000000000000002"], "1")).toBe(true);
    });

    it("throws when a saved list cannot be read, so the caller retries", async () => {
        settings.fail.add("calls.liveHostRoleIds");
        await expect(privilegedRoleIds()).rejects.toThrow();
    });
});
