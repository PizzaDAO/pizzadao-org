// app/lib/session.ts
// Secure session handling with signed cookies
import { cookies } from "next/headers";
import { createHmac } from "crypto";

const COOKIE_NAME = "pizzadao_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-in-production";

export interface Session {
    discordId: string;
    username?: string;
    nick?: string;
    createdAt: number;
}

/**
 * Sign a payload with HMAC-SHA256
 */
function sign(payload: string): string {
    const hmac = createHmac("sha256", SESSION_SECRET);
    hmac.update(payload);
    return hmac.digest("base64url");
}

/**
 * Create a signed session token
 */
export function createSessionToken(session: Session): string {
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    const signature = sign(payload);
    return `${payload}.${signature}`;
}

/**
 * Verify and decode a session token
 */
export function verifySession(token: string | undefined): Session | null {
    if (!token) return null;

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payload, signature] = parts;
    const expectedSignature = sign(payload);

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) return null;
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
        mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    if (mismatch !== 0) return null;

    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
        if (!decoded.discordId) return null;
        return decoded as Session;
    } catch {
        return null;
    }
}

/**
 * Get the current session from cookies (async for Next.js 15+)
 */
export async function getSession(): Promise<Session | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    return verifySession(token);
}

/**
 * Cookie options for setting the session
 */
export function getSessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
    };
}

export { COOKIE_NAME };
