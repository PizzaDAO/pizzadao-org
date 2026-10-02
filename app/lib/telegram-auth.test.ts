import { describe, it, expect, afterEach } from "vitest";
import { createHash, createHmac } from "crypto";
import {
    buildDataCheckString,
    computeTelegramHash,
    verifyTelegramAuth,
    telegramConfig,
    TELEGRAM_AUTH_MAX_AGE_SECONDS,
} from "./telegram-auth";

const BOT_TOKEN = "123456:TEST-bot-token_abcdef";
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const NOW_SEC = Math.floor(NOW / 1000);

/** Independent re-implementation of Telegram's documented algorithm. */
function referenceSign(fields: Record<string, string | number>, token = BOT_TOKEN): string {
    const dcs = Object.keys(fields)
        .sort()
        .map((k) => `${k}=${fields[k]}`)
        .join("\n");
    const key = createHash("sha256").update(token).digest();
    return createHmac("sha256", key).update(dcs).digest("hex");
}

function signed(fields: Record<string, string | number>, token = BOT_TOKEN) {
    return { ...fields, hash: referenceSign(fields, token) };
}

const BASE = {
    id: 987654321,
    first_name: "Tony",
    last_name: "Pepperoni",
    username: "tonypep",
    photo_url: "https://t.me/i/userpic/320/tonypep.jpg",
    auth_date: NOW_SEC - 60,
};

describe("buildDataCheckString", () => {
    it("sorts keys, excludes hash, joins with newlines", () => {
        expect(
            buildDataCheckString({ username: "a", id: 1, hash: "zzz", auth_date: 5, first_name: "B" }),
        ).toBe("auth_date=5\nfirst_name=B\nid=1\nusername=a");
    });

    it("skips null/undefined fields", () => {
        expect(buildDataCheckString({ id: 1, username: undefined, last_name: null })).toBe("id=1");
    });
});

describe("computeTelegramHash", () => {
    it("matches the documented HMAC-SHA256(SHA256(token), dcs) construction", () => {
        const { hash, ...fields } = signed(BASE);
        expect(computeTelegramHash(fields, BOT_TOKEN)).toBe(hash);
    });
});

describe("verifyTelegramAuth", () => {
    it("accepts a valid payload and normalizes the user", () => {
        const r = verifyTelegramAuth(signed(BASE), BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.user).toEqual({
            id: "987654321",
            username: "tonypep",
            firstName: "Tony",
            lastName: "Pepperoni",
            photoUrl: "https://t.me/i/userpic/320/tonypep.jpg",
            authDate: new Date(BASE.auth_date * 1000),
        });
    });

    it("accepts string-typed numbers (query-string style payload)", () => {
        const fields = { id: "42", first_name: "A", auth_date: String(NOW_SEC) };
        const r = verifyTelegramAuth(signed(fields), BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(true);
    });

    it("accepts an uppercase hex hash", () => {
        const p = signed(BASE);
        const r = verifyTelegramAuth({ ...p, hash: p.hash.toUpperCase() }, BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(true);
    });

    it("accepts a minimal payload without optional fields", () => {
        const r = verifyTelegramAuth(signed({ id: 1, first_name: "X", auth_date: NOW_SEC }), BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.user.username).toBeNull();
            expect(r.user.photoUrl).toBeNull();
        }
    });

    it("rejects a payload signed with a different bot token", () => {
        const r = verifyTelegramAuth(signed(BASE, "999:other"), BOT_TOKEN, { now: NOW });
        expect(r).toEqual({ ok: false, reason: "Hash verification failed" });
    });

    it("rejects a tampered field", () => {
        const p = signed(BASE);
        const r = verifyTelegramAuth({ ...p, username: "attacker" }, BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(false);
    });

    it("rejects a tampered id", () => {
        const p = signed(BASE);
        const r = verifyTelegramAuth({ ...p, id: 1 }, BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(false);
    });

    it("rejects an injected extra field", () => {
        const p = signed(BASE);
        const r = verifyTelegramAuth({ ...p, is_admin: "true" }, BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(false);
    });

    it("rejects missing or malformed hash", () => {
        const { hash: _h, ...noHash } = signed(BASE);
        void _h;
        expect(verifyTelegramAuth(noHash, BOT_TOKEN, { now: NOW }).ok).toBe(false);
        expect(verifyTelegramAuth({ ...BASE, hash: "abc" }, BOT_TOKEN, { now: NOW }).ok).toBe(false);
        expect(verifyTelegramAuth({ ...BASE, hash: "g".repeat(64) }, BOT_TOKEN, { now: NOW }).ok).toBe(false);
    });

    it("rejects auth_date older than 24h", () => {
        const old = { ...BASE, auth_date: NOW_SEC - TELEGRAM_AUTH_MAX_AGE_SECONDS - 1 };
        const r = verifyTelegramAuth(signed(old), BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/expired/);
    });

    it("accepts auth_date exactly at the 24h boundary", () => {
        const edge = { ...BASE, auth_date: NOW_SEC - TELEGRAM_AUTH_MAX_AGE_SECONDS };
        expect(verifyTelegramAuth(signed(edge), BOT_TOKEN, { now: NOW }).ok).toBe(true);
    });

    it("rejects auth_date far in the future", () => {
        const future = { ...BASE, auth_date: NOW_SEC + 3600 };
        expect(verifyTelegramAuth(signed(future), BOT_TOKEN, { now: NOW }).ok).toBe(false);
    });

    it("rejects missing/invalid auth_date and id", () => {
        expect(verifyTelegramAuth(signed({ id: 1, first_name: "X" }), BOT_TOKEN, { now: NOW }).ok).toBe(false);
        expect(
            verifyTelegramAuth(signed({ id: "abc", auth_date: NOW_SEC }), BOT_TOKEN, { now: NOW }).ok,
        ).toBe(false);
    });

    it("rejects non-object payloads and nested values", () => {
        expect(verifyTelegramAuth(null, BOT_TOKEN).ok).toBe(false);
        expect(verifyTelegramAuth("x", BOT_TOKEN).ok).toBe(false);
        expect(verifyTelegramAuth([1], BOT_TOKEN).ok).toBe(false);
        expect(
            verifyTelegramAuth({ ...signed(BASE), first_name: { toString: () => "Tony" } }, BOT_TOKEN, { now: NOW }).ok,
        ).toBe(false);
    });

    it("rejects when the bot token is empty", () => {
        expect(verifyTelegramAuth(signed(BASE), "", { now: NOW }).ok).toBe(false);
    });

    it("drops non-https photo URLs", () => {
        const p = signed({ ...BASE, photo_url: "javascript:alert(1)" });
        const r = verifyTelegramAuth(p, BOT_TOKEN, { now: NOW });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.user.photoUrl).toBeNull();
    });
});

describe("telegramConfig", () => {
    const saved = { ...process.env };
    afterEach(() => {
        process.env = { ...saved };
    });

    it("returns null unless both env vars are set", () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
        expect(telegramConfig()).toBeNull();
        process.env.TELEGRAM_BOT_TOKEN = "t";
        expect(telegramConfig()).toBeNull();
        process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "@PizzaDAOBot";
        expect(telegramConfig()).toEqual({ botToken: "t", botUsername: "PizzaDAOBot" });
    });
});
