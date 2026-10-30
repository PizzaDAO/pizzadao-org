import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramLinkCode: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    },
}));

import { prisma } from "@/app/lib/db";
import { consumeLinkCode, createLinkCode, LINK_CODE_TTL_MS } from "./link-code";

const t = (prisma as unknown as { telegramLinkCode: Record<"findUnique" | "updateMany" | "create" | "deleteMany", ReturnType<typeof vi.fn>> }).telegramLinkCode;

describe("link codes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        t.findUnique.mockResolvedValue({ discordId: "d1" });
        t.updateMany.mockResolvedValue({ count: 1 });
    });

    it("creates 43-char url-safe codes that expire in 10 minutes", async () => {
        const now = 1_000_000;
        const code = await createLinkCode("d1", now);
        expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(t.create.mock.calls[0][0].data.expiresAt.getTime()).toBe(now + LINK_CODE_TTL_MS);
    });

    it("spends a code once: the conditional update decides", async () => {
        const code = "A".repeat(43);
        expect(await consumeLinkCode(code, 5000)).toBe("d1");
        const where = t.updateMany.mock.calls[0][0].where;
        expect(where.usedAt).toBeNull();
        expect(where.expiresAt.gt.getTime()).toBe(5000);
        t.updateMany.mockResolvedValue({ count: 0 });
        expect(await consumeLinkCode(code, 5000)).toBeNull();
    });

    it("rejects malformed codes without a query", async () => {
        expect(await consumeLinkCode("bad code")).toBeNull();
        expect(t.findUnique).not.toHaveBeenCalled();
    });
});
