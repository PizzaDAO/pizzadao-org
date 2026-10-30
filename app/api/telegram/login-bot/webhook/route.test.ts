import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, randomBytes } from "crypto";

vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42"),
}));
vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramLinkCode: { findUnique: vi.fn(), updateMany: vi.fn() },
        telegramAccount: { findUnique: vi.fn(), upsert: vi.fn() },
        telegramHostMatch: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    },
}));

import { POST } from "./route";
import { prisma } from "@/app/lib/db";

const db = prisma as unknown as {
    telegramLinkCode: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    telegramAccount: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
    telegramHostMatch: { deleteMany: ReturnType<typeof vi.fn> };
};

const SECRET = "s3cret";
const CODE = randomBytes(32).toString("base64url");
const savedEnv = { ...process.env };
const fetchMock = vi.fn();

function hook(body: unknown, secret: string | null = SECRET) {
    return new Request("http://localhost/api/telegram/login-bot/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }) },
        body: JSON.stringify(body),
    });
}

const startMsg = (text: string, over: Record<string, unknown> = {}) => ({
    message: {
        text,
        chat: { id: 777, type: "private" },
        from: { id: 777, is_bot: false, username: "pizza", first_name: "Pia", last_name: "Zza" },
        ...over,
    },
});

const sent = () => fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body)).text as string);

describe("/api/telegram/login-bot/webhook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET = SECRET;
        process.env.TELEGRAM_LOGIN_BOT_TOKEN = "123:abc";
        process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "pizzadao_login_bot";
        process.env.VERCEL_ENV = "production";
        fetchMock.mockResolvedValue(new Response("{}"));
        vi.stubGlobal("fetch", fetchMock);
        db.telegramLinkCode.findUnique.mockResolvedValue({ discordId: "d1" });
        db.telegramLinkCode.updateMany.mockResolvedValue({ count: 1 });
        db.telegramAccount.findUnique.mockResolvedValue(null);
        db.telegramAccount.upsert.mockResolvedValue({});
    });
    afterEach(() => {
        process.env = { ...savedEnv };
        vi.unstubAllGlobals();
    });

    it("503 when the secret is not configured", async () => {
        delete process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET;
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(503);
    });

    it("401 on a missing or wrong secret, and does nothing", async () => {
        expect((await POST(hook(startMsg(`/start ${CODE}`), "nope"))).status).toBe(401);
        expect((await POST(hook(startMsg(`/start ${CODE}`), null))).status).toBe(401);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
    });

    it("is a 200 no-op outside production", async () => {
        process.env.VERCEL_ENV = "preview";
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(200);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("links the sender to the code's member, drops host matches, and replies", async () => {
        const res = await POST(hook(startMsg(`/start ${CODE}`)));
        expect(res.status).toBe(200);
        const hash = createHash("sha256").update(CODE).digest("hex");
        expect(db.telegramLinkCode.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { codeHash: hash } }));
        expect(db.telegramLinkCode.updateMany.mock.calls[0][0].where).toMatchObject({ codeHash: hash, usedAt: null });
        const up = db.telegramAccount.upsert.mock.calls[0][0];
        expect(up.where).toEqual({ discordId: "d1" });
        expect(up.create).toMatchObject({ telegramId: "777", username: "pizza", firstName: "Pia", memberId: "42", photoUrl: null });
        expect(db.telegramHostMatch.deleteMany).toHaveBeenCalledWith({ where: { OR: [{ discordId: "d1" }, { telegramId: "777" }] } });
        expect(sent()[0]).toMatch(/^Linked to your PizzaDAO account/);
    });

    it("an expired or already used code (replay) links nothing", async () => {
        db.telegramLinkCode.updateMany.mockResolvedValue({ count: 0 });
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(200);
        expect(db.telegramAccount.upsert).not.toHaveBeenCalled();
        expect(sent()[0]).toMatch(/expired/);
    });

    it("an unknown code links nothing", async () => {
        db.telegramLinkCode.findUnique.mockResolvedValue(null);
        await POST(hook(startMsg(`/start ${CODE}`)));
        expect(db.telegramAccount.upsert).not.toHaveBeenCalled();
        expect(sent()[0]).toMatch(/expired/);
    });

    it("a malformed code never touches the database", async () => {
        await POST(hook(startMsg("/start short")));
        expect(db.telegramLinkCode.findUnique).not.toHaveBeenCalled();
        expect(sent()[0]).toMatch(/expired/);
    });

    it("ignores messages that are not private chats", async () => {
        const res = await POST(hook(startMsg(`/start ${CODE}`, { chat: { id: -100, type: "group" } })));
        expect(res.status).toBe(200);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores other updates and other text without echoing it", async () => {
        expect((await POST(hook({ callback_query: { id: "1" } }))).status).toBe(200);
        expect((await POST(hook(startMsg("hello there")))).status).toBe(200);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a bare /start points to the profile", async () => {
        await POST(hook(startMsg("/start")));
        expect(sent()[0]).toMatch(/profile/);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
    });

    it("refuses when that Telegram id belongs to another member", async () => {
        db.telegramAccount.findUnique.mockResolvedValue({ discordId: "someone-else" });
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(200);
        expect(db.telegramAccount.upsert).not.toHaveBeenCalled();
        expect(db.telegramHostMatch.deleteMany).not.toHaveBeenCalled();
        expect(sent()[0]).toMatch(/already linked to another member/);
    });

    it("refuses when the race on telegramId hits the unique index", async () => {
        db.telegramAccount.upsert.mockRejectedValue({ code: "P2002" });
        await POST(hook(startMsg(`/start ${CODE}`)));
        expect(sent()[0]).toMatch(/already linked to another member/);
    });
});
