import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramLinkCode: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    },
}));

import { prisma } from "@/app/lib/db";
import { claimLinkCode, createLinkCode, spendByTelegram, LINK_CODE_TTL_MS } from "./link-code";

const t = (prisma as unknown as { telegramLinkCode: Record<"findUnique" | "updateMany" | "create" | "deleteMany", ReturnType<typeof vi.fn>> }).telegramLinkCode;
const tg = { id: "777", username: "pizza", firstName: "Pia", lastName: null };
const code = "A".repeat(43);
const free = (over = {}) => ({ discordId: "d1", tgId: null, ref: null, usedAt: null, expiresAt: new Date(10_000), ...over });

describe("link codes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        t.findUnique.mockResolvedValue(free());
        t.updateMany.mockResolvedValue({ count: 1 });
    });

    it("creates 43-char url-safe codes that expire in 10 minutes", async () => {
        const now = 1_000_000;
        expect(await createLinkCode("d1", now)).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(t.create.mock.calls[0][0].data.expiresAt.getTime()).toBe(now + LINK_CODE_TTL_MS);
    });

    it("claims once: the conditional update requires an unclaimed, unused, unexpired code", async () => {
        const r = await claimLinkCode(code, tg, 5000);
        expect(r?.discordId).toBe("d1");
        expect(r?.ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
        const where = t.updateMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ usedAt: null, tgId: null });
        expect(where.expiresAt.gt.getTime()).toBe(5000);
        t.updateMany.mockResolvedValue({ count: 0 });
        expect(await claimLinkCode(code, tg, 5000)).toBeNull();
    });

    it("refuses expired, used and malformed codes; a claimed code only answers its claimant", async () => {
        expect(await claimLinkCode(code, tg, 20_000)).toBeNull();
        t.findUnique.mockResolvedValue(free({ usedAt: new Date() }));
        expect(await claimLinkCode(code, tg, 5000)).toBeNull();
        t.findUnique.mockResolvedValue(free({ tgId: "999", ref: "R".repeat(22) }));
        expect(await claimLinkCode(code, tg, 5000)).toBeNull();
        expect((await claimLinkCode(code, { ...tg, id: "999" }, 5000))?.ref).toBe("R".repeat(22));
        expect(await claimLinkCode("bad code", tg)).toBeNull();
        expect(t.updateMany).not.toHaveBeenCalled();
    });

    it("spendByTelegram spends once for the claimant, and ignores other users, spent and malformed refs", async () => {
        const ref = "R".repeat(22);
        const row = (over = {}) => ({ codeHash: "h", discordId: "d1", tgId: "777", tgUsername: "pizza", tgFirstName: "Pia", tgLastName: null, usedAt: null, expiresAt: new Date(10_000), ...over });
        t.findUnique.mockResolvedValue(row());
        const ok = await spendByTelegram(ref, "777", 5000);
        expect(ok).toMatchObject({ result: "spent", link: { discordId: "d1", claimant: { id: "777", username: "pizza" } } });
        expect(t.updateMany.mock.calls[0][0].where).toMatchObject({ ref, tgId: "777", usedAt: null });
        t.updateMany.mockResolvedValue({ count: 0 });
        expect(await spendByTelegram(ref, "777", 5000)).toEqual({ result: "ignore" });
        t.updateMany.mockClear();
        expect(await spendByTelegram(ref, "555", 5000)).toEqual({ result: "ignore" });
        t.findUnique.mockResolvedValue(row({ usedAt: new Date() }));
        expect(await spendByTelegram(ref, "777", 5000)).toEqual({ result: "ignore" });
        t.findUnique.mockResolvedValue(row());
        expect(await spendByTelegram(ref, "777", 20_000)).toEqual({ result: "expired" });
        expect(await spendByTelegram("short", "777")).toEqual({ result: "ignore" });
        expect(t.updateMany).not.toHaveBeenCalled();
    });
});
