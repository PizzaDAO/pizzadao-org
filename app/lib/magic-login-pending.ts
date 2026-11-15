/**
 * Which browser asked for a Discord DM login link.
 *
 * Clicking the link in the Discord app often opens it somewhere else: the app's own in-app browser
 * on a phone (its own cookie jar), or the computer's default browser when the member was using a
 * different one. The login then happens in THAT browser, and the tab that asked for the link never
 * hears about it, so it looks like "the link didn't log me in".
 *
 * The request route therefore drops an httpOnly cookie in the asking browser listing the (signed) ids
 * of the links it asked for. With it:
 *   - the asking tab can poll /api/auth/magic-login/status to learn that it is now logged in (same
 *     browser, other tab) or that its link was used without logging THIS browser in (opened elsewhere);
 *   - the link's landing can tell it was opened in a browser that did not ask for it, and say so.
 *
 * This only ever reports on, or to, the browser that holds the cookie. It never moves a session from
 * one browser to another, so a link requested by someone else (an attacker typing a victim's name)
 * cannot log the requester in.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const MAGIC_PENDING_COOKIE = "pd_magic_pending";
/** Sent only to the magic-login routes (the link itself and its status endpoint). */
export const MAGIC_PENDING_PATH = "/api/auth/magic-login";
/** A little longer than the link's 10-minute lifetime. */
export const MAGIC_PENDING_MAX_AGE_SECONDS = 15 * 60;
/** Matches the per-member request limit (3 per 15 minutes). */
const MAX_IDS = 3;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function sig(id: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(`magic-pending:${id}`).digest("base64url");
}

function validEntry(entry: string): string | null {
  const [id, s, extra] = entry.split(":");
  if (extra !== undefined || !id || !s || !ID_RE.test(id)) return null;
  const want = Buffer.from(sig(id));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** The verified link ids in a pending cookie value (oldest first); [] for anything malformed. */
export function readPendingIds(value: string | undefined | null): string[] {
  if (!value || value.length > 1024) return [];
  try {
    return value.split(".").map(validEntry).filter((id): id is string => id !== null).slice(-MAX_IDS);
  } catch {
    return [];
  }
}

/** The cookie value after this browser asked for one more link (keeps the newest few). */
export function addPendingId(current: string | undefined | null, id: string): string {
  if (!ID_RE.test(id)) return readPendingIds(current).map((i) => `${i}:${sig(i)}`).join(".");
  const ids = [...readPendingIds(current).filter((i) => i !== id), id].slice(-MAX_IDS);
  return ids.map((i) => `${i}:${sig(i)}`).join(".");
}

export function pendingCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: MAGIC_PENDING_PATH,
    maxAge: MAGIC_PENDING_MAX_AGE_SECONDS,
  };
}

/** Read one cookie from a request's Cookie header. */
export function readRequestCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const raw = part.slice(i + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
}

export { OPENED_ELSEWHERE_PARAM, OPENED_ELSEWHERE_VALUE } from "./magic-login-flags";
