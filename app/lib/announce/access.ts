/**
 * Who may fire the /announce Community Call announcement.
 *
 * Role-based: the user must hold one of the Discord roles in ANNOUNCE_ROLE_IDS
 * (comma-separated), falling back to ADMIN_ROLE_IDS. If neither env var is set,
 * the legacy hard-coded Discord user allowlist is used so a deploy without the
 * new env var keeps working. Remove LEGACY_ANNOUNCE_DISCORD_IDS once
 * ANNOUNCE_ROLE_IDS is set in production.
 *
 * Server-side only (the client page asks GET /api/announce instead of shipping
 * the list).
 */

import { NextResponse } from "next/server";
import { hasAnyRoleSafe, requireSession, type GuardResult } from "@/app/lib/auth-guards";

/** TEMPORARY fallback (pre-role-check allowlist from PR #116). */
export const LEGACY_ANNOUNCE_DISCORD_IDS: readonly string[] = [
  "581986678923853836", // shaun@sparkable.com
];

export type AnnounceAccessConfig =
  | { mode: "roles"; source: "ANNOUNCE_ROLE_IDS" | "ADMIN_ROLE_IDS"; roleIds: string[] }
  | { mode: "legacy-users"; source: "legacy"; discordIds: readonly string[] };

export function parseIdList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{5,25}$/.test(s));
}

export function getAnnounceAccessConfig(env: Record<string, string | undefined> = process.env): AnnounceAccessConfig {
  const announceRoles = parseIdList(env.ANNOUNCE_ROLE_IDS);
  if (announceRoles.length) return { mode: "roles", source: "ANNOUNCE_ROLE_IDS", roleIds: announceRoles };
  const adminRoles = parseIdList(env.ADMIN_ROLE_IDS);
  if (adminRoles.length) return { mode: "roles", source: "ADMIN_ROLE_IDS", roleIds: adminRoles };
  return { mode: "legacy-users", source: "legacy", discordIds: LEGACY_ANNOUNCE_DISCORD_IDS };
}

export async function canAnnounce(
  discordId: string,
  config: AnnounceAccessConfig = getAnnounceAccessConfig(),
): Promise<boolean> {
  if (!discordId) return false;
  if (config.mode === "legacy-users") return config.discordIds.includes(discordId);
  return hasAnyRoleSafe(discordId, config.roleIds);
}

/** Route guard: 401 without a session, 403 without an announce role. */
export async function requireAnnouncer(): Promise<GuardResult> {
  const auth = await requireSession();
  if (!auth.ok) return auth;
  if (!(await canAnnounce(auth.session.discordId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: you do not have access to fire announcements" },
        { status: 403 },
      ),
    };
  }
  return auth;
}
