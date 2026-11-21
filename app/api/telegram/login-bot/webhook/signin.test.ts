import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";

const fetchMember = vi.fn();
vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42"),
    fetchMemberById: (...a: unknown[]) => fetchMember(...a),
}));
vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramLinkCode: { findUnique: vi.fn(), updateMany: vi.fn() },
        telegramAccount: { findUnique: vi.fn() },
    },
}));
const signin = vi.hoisted(() => ({ cfg: vi.fn(), claim: vi.fn(), answer: vi.fn() }));
vi.mock("@/app/lib/telegram/signin-settings", () => ({
    signinConfig: () => signin.cfg(),
    signinAllowed: (c: { enabled: boolean; allowlist: string[] }, id: string) => c.enabled && (c.allowlist.length === 0 || c.allowlist.includes(id)),
}));
vi.mock("@/app/lib/telegram/signin-code", async (orig) => ({
    ...(await orig<typeof import("@/app/lib/telegram/signin-code")>()),
    claimSignin: (...a: unknown[]) => signin.claim(...a),
    answerSignin: (...a: unknown[]) => signin.answer(...a),
}));

import { POST } from "./route";
import { prisma } from "@/app/lib/db";

const db = prisma as unknown as {
    telegramLinkCode: { updateMany: ReturnType<typeof vi.fn> };
    telegramAccount: { findUnique: ReturnType<typeof vi.fn> };
};

const SECRET = "s3cret";
const CODE = randomBytes(32).toString("base64url");
const SIREF = randomBytes(16).toString("base64url");
const SI = `si_${CODE}`;
const savedEnv = { ...process.env };
const fetchMock = vi.fn();

const hook = (body: unknown) =>
    new Request("http://localhost/api/telegram/login-bot/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
        body: JSON.stringify(body),
    });
const startMsg = (text: string, over: Record<string, unknown> = {}) => ({
    message: {
        text,
        chat: { id: 777, type: "private" },
        from: { id: 777, is_bot: false, username: "pizza", first_name: "Pia" },
        ...over,
    },
});
const cb = (data: string, fromId = 777) => ({
    callback_query: { id: "q1", from: { id: fromId, is_bot: false }, data, message: { message_id: 5, chat: { id: 777, type: "private" } } },
});
const calls = () => fetchMock.mock.calls.map((c) => ({ method: String(c[0]).split("/").pop(), body: JSON.parse(String(c[1].body)) }));

describe("login bot webhook: sign in with Telegram", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET = SECRET;
        process.env.TELEGRAM_LOGIN_BOT_TOKEN = "123:abc";
        process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME = "pizzadao_login_bot";
        process.env.VERCEL_ENV = "production";
        fetchMock.mockResolvedValue(new Response("{}"));
        vi.stubGlobal("fetch", fetchMock);
        fetchMember.mockResolvedValue({ Name: "Tony" });
        signin.cfg.mockResolvedValue({ enabled: true, allowlist: [], ttlMinutes: 5, claimSeconds: 120, sessionDays: 7 });
        signin.claim.mockResolvedValue({ status: "claimed", ref: SIREF, matchNumber: 42, startedAt: new Date(Date.now() - 12_000), browserLabel: "Chrome on macOS" });
        signin.answer.mockResolvedValue("approved");
        db.telegramAccount.findUnique.mockResolvedValue({ discordId: "d1" });
    });
    afterEach(() => {
        process.env = { ...savedEnv };
        vi.unstubAllGlobals();
    });

    it("a linked account claims the request and gets three numbers, one of them right, and never a link", async () => {
        await POST(hook(startMsg(`/start ${SI}`)));
        expect(signin.claim).toHaveBeenCalledWith(CODE, "777", "d1", expect.any(Number), 120_000);
        const [send] = calls();
        expect(send.body.text).toContain("Sign in to PizzaDAO as Tony");
        expect(send.body.text).toMatch(/Started (1[1-3]) seconds ago from Chrome on macOS/);
        expect(send.body.text).toContain("Only tap a number if YOU just clicked Sign in with Telegram on pizzadao.org in this browser");
        const buttons = send.body.reply_markup.inline_keyboard[0] as Array<{ text: string; callback_data: string }>;
        expect(buttons).toHaveLength(3);
        expect(buttons.map((b) => b.text)).toContain("42");
        for (const b of buttons) expect(b.callback_data).toMatch(new RegExp(`^si:${SIREF}:\\d{2}$`));
        expect(JSON.stringify(send.body)).not.toContain(CODE);
        expect(db.telegramLinkCode.updateMany).not.toHaveBeenCalled();
    });

    it("an unlinked Telegram user is refused and the request is left alone", async () => {
        db.telegramAccount.findUnique.mockResolvedValue(null);
        await POST(hook(startMsg(`/start ${SI}`)));
        expect(signin.claim).not.toHaveBeenCalled();
        expect(calls()[0].body.text).toMatch(/isn't connected to a PizzaDAO member/);
        expect(calls()[0].body.reply_markup).toBeUndefined();
    });

    it("says it is unavailable while the switch is off, or the member is not on the tester list", async () => {
        signin.cfg.mockResolvedValue({ enabled: false, allowlist: [], ttlMinutes: 5 });
        await POST(hook(startMsg(`/start ${SI}`)));
        signin.cfg.mockResolvedValue({ enabled: true, allowlist: ["someone-else"], ttlMinutes: 5 });
        await POST(hook(startMsg(`/start ${SI}`)));
        expect(signin.claim).not.toHaveBeenCalled();
        expect(calls().map((c) => c.body.text)).toEqual([expect.stringMatching(/isn't available/), expect.stringMatching(/isn't available/)]);
    });

    it("ignores forwarded messages, group chats and a chat that is not the sender's own", async () => {
        await POST(hook(startMsg(`/start ${SI}`, { forward_origin: { type: "user" } })));
        await POST(hook(startMsg(`/start ${SI}`, { chat: { id: -100, type: "group" } })));
        await POST(hook(startMsg(`/start ${SI}`, { chat: { id: 555, type: "private" } })));
        expect(signin.claim).not.toHaveBeenCalled();
        expect(db.telegramAccount.findUnique).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("replies 'too many attempts' and 'expired' for the other claim outcomes", async () => {
        signin.claim.mockResolvedValueOnce({ status: "limited" });
        await POST(hook(startMsg(`/start ${SI}`)));
        signin.claim.mockResolvedValueOnce({ status: "expired" });
        await POST(hook(startMsg(`/start ${SI}`)));
        expect(calls().map((c) => c.body.text)).toEqual([expect.stringMatching(/Too many attempts/), expect.stringMatching(/expired/)]);
    });

    it("the right tap says signed in, a wrong tap cancels", async () => {
        await POST(hook(cb(`si:${SIREF}:42`)));
        expect(signin.answer).toHaveBeenCalledWith(SIREF, "777", 42);
        expect(calls().map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
        expect(calls()[1].body.text).toBe("Signed in. Go back to your browser.");
        fetchMock.mockClear();
        signin.answer.mockResolvedValue("cancelled");
        await POST(hook(cb(`si:${SIREF}:11`)));
        expect(calls()[1].body.text).toBe("Cancelled. Start again from the website.");
    });

    it("a tap by someone else, or a double tap, says nothing", async () => {
        signin.answer.mockResolvedValue("ignore");
        await POST(hook(cb(`si:${SIREF}:42`, 999)));
        await POST(hook(cb(`si:${SIREF}:42`)));
        expect(calls().map((c) => c.method)).toEqual(["answerCallbackQuery", "answerCallbackQuery"]);
    });

    it("rejects malformed callback data and taps outside a private chat", async () => {
        await POST(hook(cb(`si:${SIREF}:4`)));
        await POST(hook(cb("si:short:42")));
        const q = cb(`si:${SIREF}:42`);
        q.callback_query.message.chat.type = "group";
        await POST(hook(q));
        expect(signin.answer).not.toHaveBeenCalled();
    });
});
