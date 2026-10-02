// app/lib/telegram-auth.ts
//
// Server-side verification of Telegram Login Widget payloads.
// Spec: https://core.telegram.org/widgets/login#checking-authorization
//
//   data_check_string = every received field except `hash`, as `key=value`,
//                       sorted by key, joined with "\n"
//   secret_key        = SHA256(bot_token)
//   valid             = hex(HMAC_SHA256(secret_key, data_check_string)) == hash
//
// We also reject payloads whose auth_date is older than 24h (replay window) or
// meaningfully in the future.
//
// Plan: calzone-93434 (link Telegram; login is a follow-up, see
// plans/calzone-93434-telegram-login.md).

import { createHash, createHmac, timingSafeEqual } from "crypto";

/** Max age of a widget payload before we refuse it. */
export const TELEGRAM_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
/** Tolerated clock skew for auth_date "from the future". */
const MAX_FUTURE_SKEW_SECONDS = 5 * 60;
/** Defensive caps on the untrusted payload shape. */
const MAX_FIELDS = 16;
const MAX_VALUE_LENGTH = 1024;

export interface TelegramUser {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    authDate: Date;
}

export type TelegramVerifyResult =
    | { ok: true; user: TelegramUser }
    | { ok: false; reason: string };

/** Whether Telegram linking is configured (both env vars present). */
export function telegramConfig(): { botToken: string; botUsername: string } | null {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
    if (!botToken || !botUsername) return null;
    return { botToken, botUsername };
}

/**
 * Build Telegram's data-check-string from a payload: all fields except `hash`
 * (and except null/undefined values, which the widget never sends), sorted by
 * key, `key=value`, newline-joined.
 */
export function buildDataCheckString(data: Record<string, unknown>): string {
    return Object.keys(data)
        .filter((k) => k !== "hash" && data[k] !== undefined && data[k] !== null)
        .sort()
        .map((k) => `${k}=${String(data[k])}`)
        .join("\n");
}

/** Hex HMAC-SHA256 of the data-check-string keyed by SHA256(botToken). */
export function computeTelegramHash(data: Record<string, unknown>, botToken: string): string {
    const secretKey = createHash("sha256").update(botToken).digest();
    return createHmac("sha256", secretKey).update(buildDataCheckString(data)).digest("hex");
}

function optString(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
}

/**
 * Verify a Telegram Login Widget payload (the `user` object passed to the
 * widget's data-onauth callback, or the query params of a data-auth-url
 * redirect).
 */
export function verifyTelegramAuth(
    payload: unknown,
    botToken: string,
    opts: { now?: number; maxAgeSeconds?: number } = {},
): TelegramVerifyResult {
    if (!botToken) return { ok: false, reason: "Telegram is not configured" };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { ok: false, reason: "Invalid payload" };
    }
    const data = payload as Record<string, unknown>;
    const keys = Object.keys(data);
    if (keys.length > MAX_FIELDS) return { ok: false, reason: "Invalid payload" };
    for (const k of keys) {
        const v = data[k];
        if (v === null || v === undefined) continue;
        if (typeof v !== "string" && typeof v !== "number") {
            return { ok: false, reason: "Invalid payload" };
        }
        if (String(v).length > MAX_VALUE_LENGTH) return { ok: false, reason: "Invalid payload" };
    }

    const hash = data.hash;
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash)) {
        return { ok: false, reason: "Missing or malformed hash" };
    }

    const id = String(data.id ?? "");
    if (!/^\d{1,20}$/.test(id)) return { ok: false, reason: "Invalid Telegram id" };

    const authDateSec = Number(data.auth_date);
    if (!Number.isInteger(authDateSec) || authDateSec <= 0) {
        return { ok: false, reason: "Invalid auth_date" };
    }

    const expected = Buffer.from(computeTelegramHash(data, botToken), "hex");
    const received = Buffer.from(hash.toLowerCase(), "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        return { ok: false, reason: "Hash verification failed" };
    }

    const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
    const maxAge = opts.maxAgeSeconds ?? TELEGRAM_AUTH_MAX_AGE_SECONDS;
    if (nowSec - authDateSec > maxAge) {
        return { ok: false, reason: "Telegram login expired, please try again" };
    }
    if (authDateSec - nowSec > MAX_FUTURE_SKEW_SECONDS) {
        return { ok: false, reason: "Invalid auth_date" };
    }

    const photoUrl = optString(data.photo_url);
    return {
        ok: true,
        user: {
            id,
            username: optString(data.username),
            firstName: optString(data.first_name),
            lastName: optString(data.last_name),
            // Only keep https photo URLs (rendered as <img src>).
            photoUrl: photoUrl && photoUrl.startsWith("https://") ? photoUrl : null,
            authDate: new Date(authDateSec * 1000),
        },
    };
}
