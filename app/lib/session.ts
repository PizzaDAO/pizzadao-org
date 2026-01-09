// app/lib/session.ts
import crypto from "crypto";
import type { CookieSerializeOptions } from "cookie";
import { cookies } from "next/headers";

type Session = {
    discordId: string;
    username?: string;
    nick?: string;
    iat: number; // issued-at epoch seconds
    exp: number; // expiry epoch seconds
};

export const COOKIE_NAME = "pizzadao_session";

/**
 * Base64URL helpers (Node 18+)
 */
function b64urlEncode(buf: Buffer) {
    return buf
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}
function b64urlDecode(s: string) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4;
    if (pad) s += "=".repeat(4 - pad);
    return Buffer.from(s, "base64");
}

function hmac(secret: string, data: string) {
    return crypto.createHmac("sha256", secret).update(data).digest();
}

export function signSession(
    session: Omit<Session, "iat" | "exp">,
    ttlSeconds = 60 * 60 * 24 * 14
) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("Missing SESSION_SECRET");

    const now = Math.floor(Date.now() / 1000);
    const payload: Session = {
        ...session,
        iat: now,
        exp: now + ttlSeconds,
    };

    const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
    const sig = b64urlEncode(hmac(secret, payloadB64));
    return `${payloadB64}.${sig}`;
}

export function verifySession(token: string | undefined | null): Session | null {
    if (!token) return null;
    const secret = process.env.SESSION_SECRET;
    if (!secret) return null;

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payloadB64, sigB64] = parts;

    // Verify signature
    const expected = b64urlEncode(hmac(secret, payloadB64));
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sigB64, "utf8");
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    // Parse + expiry
    let payload: Session;
    try {
        payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
    } catch {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload?.discordId) return null;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;

    return payload;
}

/**
 * Read session from the httpOnly cookie in App Router handlers.
 * Note: In Next.js 15+, cookies() is async.
 */
export async function getSession(): Promise<Session | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    return verifySession(token);
}

/**
 * Cookie settings that work on localhost AND production.
 * - On localhost (http): secure=false, sameSite=lax
 * - On prod (https): secure=true, sameSite=lax
 */
export function getSessionCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
    const isProd = process.env.NODE_ENV === "production";

    return {
        httpOnly: true,
        secure: isProd, // IMPORTANT: must be false on http://localhost
        sameSite: "lax", // IMPORTANT: works with OAuth redirects
        path: "/",
        maxAge: maxAgeSeconds,
    };
}
