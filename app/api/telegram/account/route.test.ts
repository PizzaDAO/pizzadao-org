import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, createHmac } from "crypto";

const getSession = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/discord", () => ({ hasAnyRole: vi.fn() }));
vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn().mockResolvedValue("42"),
}));
vi.mock("@/app/lib/db", () => ({
    prisma: {
        telegramAccount: {
            findUnique: vi.fn(),
            upsert: vi.fn(),
            deleteMany: vi.fn(),
        },
    },
}));

import { GET, POST, DELETE } from "./route";
import { prisma } from "@/app/lib/db";

const tg = (prisma as unknown as {
    telegramAccount: Record<"findUnique" | "upsert" | "deleteMany", ReturnType<typeof vi.fn>>;
}).telegramAccount;

const TOKEN = "123:abc";

function sign(fields: Record<string, string | number>) {
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
    const key = createHash("sha256").update(TOKEN).digest();
    return { ...fields, hash: createHmac("sha256", key).update(dcs).digest("hex") };
}

function post(body: unknown) {
    return new Request("http://localhost/api/telegram/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

const savedEnv = { ...process.env };

describe("/api/telegram/account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSession.mockResolvedValue({ discordId: "d1", createdAt: Date.now() });
        process.env.TELEGRAM_BOT_TOKEN = TOKEN;
        process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "PizzaDAOBot";
    });
    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it("requires a session", async () => {
        getSession.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        expect((await POST(post({}))).status).toBe(401);
        expect((await DELETE()).status).toBe(401);
    });

    it("GET reports disabled when env is unset", async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        const res = await GET();
        expect(await res.json()).toEqual({ enabled: false, connected: false });
        expect(tg.findUnique).not.toHaveBeenCalled();
    });

    it("GET returns link status", async () => {
        tg.findUnique.mockResolvedValue({ username: "tony", firstName: "Tony", lastName: null, photoUrl: null });
        const json = await (await GET()).json();
        expect(json).toMatchObject({ enabled: true, botUsername: "PizzaDAOBot", connected: true, username: "tony" });
    });

    it("POST returns 503 when not configured", async () => {
        delete process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
        expect((await POST(post({}))).status).toBe(503);
    });

    it("POST rejects an invalid signature", async () => {
        const p = sign({ id: 7, first_name: "T", auth_date: Math.floor(Date.now() / 1000) });
        const res = await POST(post({ ...p, first_name: "Evil" }));
        expect(res.status).toBe(400);
        expect(tg.upsert).not.toHaveBeenCalled();
    });

    it("POST links a verified account", async () => {
        tg.findUnique.mockResolvedValue(null);
        tg.upsert.mockResolvedValue({});
        const p = sign({ id: 7, first_name: "T", username: "tee", auth_date: Math.floor(Date.now() / 1000) });
        const res = await POST(post(p));
        expect(res.status).toBe(200);
        expect(tg.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { discordId: "d1" },
                create: expect.objectContaining({ discordId: "d1", telegramId: "7", username: "tee", memberId: "42" }),
            }),
        );
    });

    it("POST refuses a Telegram account linked to another member", async () => {
        tg.findUnique.mockResolvedValue({ discordId: "someone-else" });
        const p = sign({ id: 7, first_name: "T", auth_date: Math.floor(Date.now() / 1000) });
        expect((await POST(post(p))).status).toBe(409);
        expect(tg.upsert).not.toHaveBeenCalled();
    });

    it("DELETE unlinks only the caller's row", async () => {
        tg.deleteMany.mockResolvedValue({ count: 1 });
        expect((await DELETE()).status).toBe(200);
        expect(tg.deleteMany).toHaveBeenCalledWith({ where: { discordId: "d1" } });
    });
});
