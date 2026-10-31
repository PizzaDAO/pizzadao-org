import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";

const getSession = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: vi.fn() }));
vi.mock("@/app/lib/db", () => ({
    prisma: { telegramLinkCode: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn().mockResolvedValue({}) } },
}));

import { DELETE, POST } from "./route";
import { prisma } from "@/app/lib/db";
import { __resetMemoryRateLimits } from "@/app/lib/rate-limit";

const codes = (prisma as unknown as { telegramLinkCode: { deleteMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } }).telegramLinkCode;
const savedEnv = { ...process.env };

function req() {
    return new Request("http://localhost/api/telegram/link/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "localhost", origin: "http://localhost" },
        body: "{}",
    });
}

describe("/api/telegram/link/start", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        __resetMemoryRateLimits();
        getSession.mockResolvedValue({ discordId: "d1", createdAt: Date.now() });
        process.env.TELEGRAM_LOGIN_BOT_TOKEN = "123:abc";
        process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "pizzadao_login_bot";
        delete process.env.UPSTASH_REDIS_REST_URL;
    });
    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it("401 without a session", async () => {
        getSession.mockResolvedValue(null);
        expect((await POST(req())).status).toBe(401);
        expect(codes.create).not.toHaveBeenCalled();
    });

    it("503 when Telegram is not configured", async () => {
        delete process.env.TELEGRAM_LOGIN_BOT_TOKEN;
        expect((await POST(req())).status).toBe(503);
    });

    it("returns a deep link whose code fits Telegram's limits and stores only its hash", async () => {
        const res = await POST(req());
        expect(res.status).toBe(200);
        const { url } = await res.json();
        const m = /^https:\/\/t\.me\/pizzadao_login_bot\?start=([A-Za-z0-9_-]{1,64})$/.exec(url);
        expect(m).not.toBeNull();
        const data = codes.create.mock.calls[0][0].data;
        expect(data.codeHash).toBe(createHash("sha256").update(m![1]).digest("hex"));
        expect(JSON.stringify(data)).not.toContain(m![1]);
        expect(data.discordId).toBe("d1");
        expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
        // Earlier unused codes of this member are dropped.
        expect(codes.deleteMany.mock.calls[0][0].where.OR[0]).toEqual({ discordId: "d1", usedAt: null });
    });

    describe("DELETE (Stop waiting)", () => {
        const del = (headers: Record<string, string> = { "Content-Type": "application/json", host: "localhost", origin: "http://localhost" }) =>
            new Request("http://localhost/api/telegram/link/start", { method: "DELETE", headers });

        it("401 without a session", async () => {
            getSession.mockResolvedValue(null);
            expect((await DELETE(del())).status).toBe(401);
            expect(codes.deleteMany).not.toHaveBeenCalled();
        });

        it("415 without a JSON content type", async () => {
            expect((await DELETE(del({ host: "localhost", origin: "http://localhost" }))).status).toBe(415);
            expect(codes.deleteMany).not.toHaveBeenCalled();
        });

        it("discards only the session member's unused codes", async () => {
            expect((await DELETE(del())).status).toBe(200);
            expect(codes.deleteMany).toHaveBeenCalledWith({ where: { discordId: "d1", usedAt: null } });
        });
    });

    it("rate limits to 5 per 10 minutes per member", async () => {
        for (let i = 0; i < 5; i++) expect((await POST(req())).status).toBe(200);
        expect((await POST(req())).status).toBe(429);
    });
});
