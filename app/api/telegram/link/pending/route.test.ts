import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSession = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: vi.fn() }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42") }));
vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramLinkCode: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
        telegramAccount: { findUnique: vi.fn(), upsert: vi.fn() },
        telegramHostMatch: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    },
}));

import { GET, POST } from "./route";
import { prisma } from "@/app/lib/db";

const db = prisma as unknown as {
    telegramLinkCode: Record<"findFirst" | "updateMany" | "deleteMany", ReturnType<typeof vi.fn>>;
    telegramAccount: Record<"findUnique" | "upsert", ReturnType<typeof vi.fn>>;
};
const savedEnv = { ...process.env };
const fetchMock = vi.fn();

const post = (body: unknown) =>
    new Request("http://localhost/api/telegram/link/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "localhost", origin: "http://localhost" },
        body: JSON.stringify(body),
    });
const row = { codeHash: "h", tgId: "777", tgUsername: "pizza", tgFirstName: "Pia", tgLastName: null };

describe("/api/telegram/link/pending", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSession.mockResolvedValue({ discordId: "d1", createdAt: Date.now() });
        process.env.TELEGRAM_LOGIN_BOT_TOKEN = "123:abc";
        process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "pizzadao_login_bot";
        fetchMock.mockResolvedValue(new Response("{}"));
        vi.stubGlobal("fetch", fetchMock);
        db.telegramLinkCode.findFirst.mockResolvedValue(row);
        db.telegramLinkCode.updateMany.mockResolvedValue({ count: 1 });
        db.telegramAccount.findUnique.mockResolvedValue(null);
        db.telegramAccount.upsert.mockResolvedValue({});
    });
    afterEach(() => {
        process.env = { ...savedEnv };
        vi.unstubAllGlobals();
    });

    it("requires a session", async () => {
        getSession.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        expect((await POST(post({ action: "confirm" }))).status).toBe(401);
    });

    it("GET shows who wants to link, never the id, only for a bot-confirmed claim", async () => {
        const body = await (await GET()).json();
        expect(body).toEqual({ pending: { username: "pizza", name: "Pia" } });
        expect(db.telegramLinkCode.findFirst.mock.calls[0][0].where).toMatchObject({ discordId: "d1", usedAt: null, tgConfirmedAt: { not: null } });
        db.telegramLinkCode.findFirst.mockResolvedValue(null);
        expect(await (await GET()).json()).toEqual({ pending: null });
    });

    it("confirm links the claimant, spends the code and sends the final message", async () => {
        const res = await POST(post({ action: "confirm" }));
        expect(res.status).toBe(200);
        expect(db.telegramAccount.upsert.mock.calls[0][0].create).toMatchObject({ discordId: "d1", telegramId: "777" });
        expect(db.telegramLinkCode.updateMany.mock.calls[0][0].where).toMatchObject({ codeHash: "h", usedAt: null });
        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).text).toMatch(/^Linked/);
    });

    it("confirm with nothing pending is a 404 and links nothing", async () => {
        db.telegramLinkCode.findFirst.mockResolvedValue(null);
        expect((await POST(post({ action: "confirm" }))).status).toBe(404);
        expect(db.telegramAccount.upsert).not.toHaveBeenCalled();
    });

    it("confirm when that Telegram id belongs to another member is a 409 and discards the code", async () => {
        db.telegramAccount.findUnique.mockResolvedValue({ discordId: "other" });
        expect((await POST(post({ action: "confirm" }))).status).toBe(409);
        expect(db.telegramAccount.upsert).not.toHaveBeenCalled();
        expect(db.telegramLinkCode.deleteMany).toHaveBeenCalled();
    });

    it("cancel discards the member's unused codes; cross-origin and non-JSON writes are refused", async () => {
        expect((await POST(post({ action: "cancel" }))).status).toBe(200);
        expect(db.telegramLinkCode.deleteMany).toHaveBeenCalledWith({ where: { discordId: "d1", usedAt: null } });
        const cross = new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", host: "localhost", origin: "http://evil.test" }, body: "{}" });
        expect((await POST(cross)).status).toBe(403);
        const plain = new Request("http://localhost/x", { method: "POST", body: "{}" });
        expect((await POST(plain)).status).toBe(415);
    });
});
