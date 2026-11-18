// app/lib/auth-hint.ts
// A non-httpOnly "hint" cookie that tells the browser whether a session MAY exist, so logged-out
// visitors can skip /api/session. It holds "1" or "0", never a token or an identifier, and grants
// nothing: server auth reads only the httpOnly session cookie. Safe to import from client code.

export const AUTH_HINT_COOKIE = "pizzadao_auth";

export type AuthHint = "1" | "0" | null;

/** Reads the hint from a `document.cookie`-style string. Missing or unrecognised means unknown (null). */
export function parseAuthHint(cookieHeader: string | null | undefined): AuthHint {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() !== AUTH_HINT_COOKIE) continue;
        const v = part.slice(eq + 1).trim();
        return v === "1" || v === "0" ? v : null;
    }
    return null;
}

/** Reads the hint in the browser. Unknown (null) on the server or when cookies are unavailable. */
export function readAuthHint(): AuthHint {
    if (typeof document === "undefined") return null;
    try {
        return parseAuthHint(document.cookie);
    } catch {
        return null;
    }
}

/** True only when the browser knows there is no session ("0"). Unknown always does the real check. */
export function knownLoggedOut(): boolean {
    return readAuthHint() === "0";
}

/** Client side: after a 401 from /api/session, record the logged-out state (the server also sets it). */
export function markHintLoggedOut(): void {
    if (typeof document === "undefined") return;
    try {
        document.cookie = `${AUTH_HINT_COOKIE}=0; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`;
    } catch {
        /* cookies unavailable */
    }
}

export interface CookieJar {
    cookies: {
        set(name: string, value: string, opts: Record<string, unknown>): unknown;
    };
}

/** Sets the hint on a response. `base` is the session cookie options (secure/sameSite/path/maxAge are shared). */
export function setAuthHint(
    res: CookieJar,
    value: "0" | "1",
    base: { secure: boolean; sameSite: "lax"; path: string; maxAge: number },
) {
    res.cookies.set(AUTH_HINT_COOKIE, value, {
        httpOnly: false,
        secure: base.secure,
        sameSite: base.sameSite,
        path: base.path,
        maxAge: base.maxAge,
    });
}
