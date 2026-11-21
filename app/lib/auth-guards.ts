// app/lib/auth-guards.ts
// Shared route guards. Usage:
//
//   const auth = await requireSession()
//   if (!auth.ok) return auth.response
//   const { session } = auth
//
//   const admin = await requireAdmin()
//   if (!admin.ok) return admin.response
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSession, type Session } from "./session";
import { hasAnyRole } from "./discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";

export type GuardResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

/** Require a valid session cookie. Returns 401 otherwise. */
export async function requireSession(): Promise<GuardResult> {
  const session = await getSession();
  if (!session?.discordId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

/** Whether the given Discord user holds an admin role in the guild. */
export async function isAdminDiscordId(discordId: string): Promise<boolean> {
  return hasAnyRoleSafe(discordId, ADMIN_ROLE_IDS);
}

/** Whether the Discord user holds any of `roleIds` in the guild (false on lookup errors). */
export async function hasAnyRoleSafe(discordId: string, roleIds: readonly string[]): Promise<boolean> {
  if (roleIds.length === 0) return false;
  try {
    return await hasAnyRole(discordId, roleIds);
  } catch {
    return false;
  }
}

/**
 * Require a session whose user holds one of `roleIds` (fails closed on lookup
 * errors). 401 if no session, 403 otherwise.
 */
export async function requireAnyRole(
  roleIds: readonly string[],
  forbiddenMessage = "Forbidden",
): Promise<GuardResult> {
  const auth = await requireSession();
  if (!auth.ok) return auth;
  if (!(await hasAnyRoleSafe(auth.session.discordId, roleIds))) {
    return {
      ok: false,
      response: NextResponse.json({ error: forbiddenMessage }, { status: 403 }),
    };
  }
  return auth;
}

/** True when the request has a session that belongs to a guild admin (never throws). */
export async function isAdminSession(): Promise<boolean> {
  try {
    return (await requireAdmin()).ok;
  } catch {
    return false;
  }
}

/**
 * True when this session was started with "Sign in with Telegram" and admin powers over it are not allowed
 * (the default: admin and DPR checks need a Discord or magic-link session). Fails closed on read errors.
 */
export async function telegramSessionBlocked(session: Pick<Session, "authMethod">): Promise<boolean> {
  if (session.authMethod !== "telegram") return false;
  try {
    // Loaded only for Telegram sessions, so ordinary admin checks never pull in the settings store.
    const { toggleEnabled } = await import("@/app/lib/settings/toggles");
    return !(await toggleEnabled("auth.telegramSignInAdminAllowed"));
  } catch {
    return true;
  }
}

/** Require a session belonging to a guild admin. 401 if no session, 403 if not admin (or Telegram-started). */
export async function requireAdmin(): Promise<GuardResult> {
  const auth = await requireSession();
  if (!auth.ok) return auth;
  if (await telegramSessionBlocked(auth.session)) {
    return { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return requireAnyRole(ADMIN_ROLE_IDS, "Admin access required");
}

/** Constant-time string comparison (false on any length mismatch or missing value). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Check a shared-secret header/bearer against an env var.
 * Returns a 503 response if the secret is not configured (fail closed),
 * a 401 if it doesn't match, or null if authorized.
 */
export function checkSecret(provided: string | null | undefined, envName: string): NextResponse | null {
  const expected = process.env[envName]?.trim();
  if (!expected) {
    return NextResponse.json({ error: `${envName} is not configured` }, { status: 503 });
  }
  if (!safeEqual(provided?.trim(), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
