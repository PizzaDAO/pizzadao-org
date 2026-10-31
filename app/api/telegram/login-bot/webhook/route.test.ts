import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, randomBytes } from "crypto";

const fetchMember = vi.fn();
vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42"),
    fetchMemberById: (...a: unknown[]) => fetchMember(...a),
}));
vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramLinkCode: { findUnique: vi.fn(), updateMany: vi.fn() },
        telegramAccount: { findUnique: vi.fn(), upsert: vi.fn() },
        telegramHostMatch: { deleteMany: vi.fn() },
    },
}));

import { POST } from "./route";
import { prisma } from "@/app/lib/db";

const db = prisma as unknown as {
    telegramLinkCode: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    telegramAccount: { upsert: ReturnType<typeof vi.fn> };
};

const SECRET = "s3cret";
const CODE = randomBytes(32).toString("base64url");
const REF = randomBytes(16).toString("base64url");
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
const cb = (data: string, fromId = 777) => ({
    callback_query: { id: "q1", from: { id: fromId, is_bot: false }, data, message: { message_id: 5, chat: { id: 777, type: "private" } } },
});

const calls = () => fetchMock.mock.calls.map((c) => ({ method: String(c[0]).split("/").pop(), body: JSON.parse(String(c[1].body)) }));

describe("/api/telegram/login-bot/webhook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET = SECRET;
        process.env.TELEGRAM_LOGIN_BOT_TOKEN = "123:abc";
        process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "pizzadao_login_bot";
        process.env.VERCEL_ENV = "production";
        fetchMock.mockResolvedValue(new Response("{}"));
        vi.stubGlobal("fetch", fetchMock);
        fetchMember.mockResolvedValue({ Name: "Tony" });
        db.telegramLinkCode.findUnique.mockResolvedValue({ discordId: "d1", tgId: null, ref: null, usedAt: null, expiresAt: new Date(Date.now() + 60000) });
        db.telegramLinkCode.updateMany.mockResolvedValue({ count: 1 });
    });
    afterEach(() => {
        process.env = { ...savedEnv };
        vi.unstubAllGlobals();
    });

    it("503 when the secret is not configured; 401 on missing or wrong secret", async () => {
        expect((await POST(hook(startMsg(`/start ${CODE}`), "nope"))).status).toBe(401);
        expect((await POST(hook(startMsg(`/start ${CODE}`), null))).status).toBe(401);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
        delete process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET;
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(503);
    });

    it("is a 200 no-op outside production and when login-bot env is missing", async () => {
        process.env.VERCEL_ENV = "preview";
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(200);
        process.env.VERCEL_ENV = "production";
        delete process.env.TELEGRAM_LOGIN_BOT_TOKEN;
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(200);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("/start <code> claims the code and asks for confirmation, but links nothing", async () => {
        expect((await POST(hook(startMsg(`/start ${CODE}`)))).status).toBe(200);
        const hash = createHash("sha256").update(CODE).digest("hex");
        const upd = db.telegramLinkCode.updateMany.mock.calls[0][0];
        expect(upd.where).toMatchObject({ codeHash: hash, usedAt: null, tgId: null });
        expect(upd.data).toMatchObject({ tgId: "777", tgUsername: "pizza", tgFirstName: "Pia" });
        expect(db.telegramAccount.upsert).not.toHaveBeenCalled();
        const [send] = calls();
        expect(send.method).toBe("sendMessage");
        expect(send.body.text).toContain("Connect this Telegram to the PizzaDAO member Tony");
        expect(send.body.reply_markup.inline_keyboard[0][0].text).toBe("Yes, connect");
        const data = send.body.reply_markup.inline_keyboard[0][0].callback_data as string;
        expect(data).toMatch(/^ok:[A-Za-z0-9_-]{22}$/);
        expect(data).not.toContain(CODE);
    });

    it("falls back to the member number, and sends no button when the member isn't found", async () => {
        fetchMember.mockResolvedValue({ Name: "  " });
        await POST(hook(startMsg(`/start ${CODE}`)));
        expect(calls()[0].body.text).toContain("member #42?");
        expect(calls()[0].body.reply_markup).toBeDefined();
        fetchMock.mockClear();
        fetchMember.mockResolvedValue(null);
        await POST(hook(startMsg(`/start ${CODE}`)));
        expect(calls()[0].body.text).toMatch(/can't be used/);
        expect(calls()[0].body.reply_markup).toBeUndefined();
    });

    it("answers the callback query even when the message is not a private chat", async () => {
        const q = cb(`ok:${REF}`);
        q.callback_query.message.chat.type = "group";
        await POST(hook(q));
        expect(calls().map((c) => c.method)).toEqual(["answerCallbackQuery"]);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
    });

    it("a second presser cannot claim an already claimed code", async () => {
        db.telegramLinkCode.findUnique.mockResolvedValue({ discordId: "d1", tgId: "999", ref: REF, usedAt: null, expiresAt: new Date(Date.now() + 60000) });
        await POST(hook(startMsg(`/start ${CODE}`)));
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
        expect(calls()[0].body.text).toMatch(/expired/);
    });

    it("loses a claim race without replying with a button", async () => {
        db.telegramLinkCode.updateMany.mockResolvedValue({ count: 0 });
        await POST(hook(startMsg(`/start ${CODE}`)));
        expect(calls()[0].body.text).toMatch(/expired/);
        expect(calls()[0].body.reply_markup).toBeUndefined();
    });

    it("expired, used, unknown or malformed codes get the expired reply", async () => {
        db.telegramLinkCode.findUnique.mockResolvedValue({ discordId: "d1", tgId: null, ref: null, usedAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
        await POST(hook(startMsg(`/start ${CODE}`)));
        db.telegramLinkCode.findUnique.mockResolvedValue(null);
        await POST(hook(startMsg(`/start ${CODE}`)));
        await POST(hook(startMsg("/start short")));
        expect(calls().map((c) => c.body.text)).toEqual([expect.stringMatching(/expired/), expect.stringMatching(/expired/), expect.stringMatching(/expired/)]);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
    });

    it("ignores forwarded messages, non-private chats, other text and other updates", async () => {
        await POST(hook(startMsg(`/start ${CODE}`, { forward_origin: { type: "user" } })));
        await POST(hook(startMsg(`/start ${CODE}`, { forward_date: 1 })));
        await POST(hook(startMsg(`/start ${CODE}`, { chat: { id: -100, type: "group" } })));
        await POST(hook(startMsg("hello there")));
        await POST(hook({ edited_message: {} }));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
    });

    it("a bare /start points to the profile", async () => {
        await POST(hook(startMsg("/start")));
        expect(calls()[0].body.text).toMatch(/profile/);
    });

    it("tapping Yes confirms for the claimant only, then edits the message", async () => {
        await POST(hook(cb(`ok:${REF}`)));
        const upd = db.telegramLinkCode.updateMany.mock.calls[0][0];
        expect(upd.where).toMatchObject({ ref: REF, tgId: "777", usedAt: null });
        expect(calls().map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
        expect(calls()[1].body.text).toMatch(/confirm on the website/);
        expect(db.telegramAccount.upsert).not.toHaveBeenCalled();
    });

    it("a different user tapping Yes confirms nothing", async () => {
        db.telegramLinkCode.updateMany.mockResolvedValue({ count: 0 });
        await POST(hook(cb(`ok:${REF}`, 555)));
        expect(db.telegramLinkCode.updateMany.mock.calls[0][0].where.tgId).toBe("555");
        expect(calls()[1].body.text).toMatch(/expired/);
    });

    it("if the work throws, still 200 with a start-again reply", async () => {
        db.telegramLinkCode.findUnique.mockRejectedValue(new Error("db down"));
        const res = await POST(hook(startMsg(`/start ${CODE}`)));
        expect(res.status).toBe(200);
        expect(calls()[0].body.text).toMatch(/Something went wrong/);
    });
});
