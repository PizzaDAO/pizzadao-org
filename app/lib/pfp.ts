/**
 * Profile-picture lookup against the static files in public/pfp.
 * Server-side only (uses fs).
 *
 * Resolution order: /pfp/<id>.jpg, /pfp/<id>.png, /pfp/default.jpg,
 * /pfp/default.png, else null.
 */

import { existsSync } from "fs";
import path from "path";

/** Member IDs are numeric; anything outside this set never maps to a file. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function pfpDir(): string {
  return path.join(process.cwd(), "public", "pfp");
}

function defaultPfpUrl(dir: string): string | null {
  if (existsSync(path.join(dir, "default.jpg"))) return "/pfp/default.jpg";
  if (existsSync(path.join(dir, "default.png"))) return "/pfp/default.png";
  return null;
}

/** Resolve one member's profile-picture URL. Never throws. */
export function resolvePfpUrl(memberId: string | number): string | null {
  try {
    const id = String(memberId ?? "").trim();
    const dir = pfpDir();
    if (id && SAFE_ID.test(id)) {
      if (existsSync(path.join(dir, `${id}.jpg`))) return `/pfp/${id}.jpg`;
      if (existsSync(path.join(dir, `${id}.png`))) return `/pfp/${id}.png`;
    }
    return defaultPfpUrl(dir);
  } catch {
    return null;
  }
}

/**
 * Async resolution that honours composed PFPs: MemberPfp.composedUrl, then the static file, then
 * the default. One indexed findMany for the whole batch. A database failure (or a preview without
 * the migration) degrades to the static lookup. Never throws.
 */
export async function resolvePfpUrlsAsync(
  memberIds: Iterable<string | number>,
): Promise<Record<string, string | null>> {
  const base = resolvePfpUrls(memberIds);
  const ids = Object.keys(base).filter((id) => SAFE_ID.test(id));
  if (ids.length === 0) return base;
  try {
    const { prisma } = await import("@/app/lib/db");
    const rows = await prisma.memberPfp.findMany({
      where: { memberId: { in: ids } },
      select: { memberId: true, composedUrl: true },
    });
    for (const row of rows) if (row.composedUrl) base[row.memberId] = row.composedUrl;
  } catch {
    // keep the static answers
  }
  return base;
}

/** Single-member version of resolvePfpUrlsAsync. */
export async function resolvePfpUrlAsync(memberId: string | number): Promise<string | null> {
  const id = String(memberId ?? "").trim();
  const out = await resolvePfpUrlsAsync([id]);
  return out[id] ?? null;
}

/** Resolve profile-picture URLs for many members in one pass. */
export function resolvePfpUrls(memberIds: Iterable<string | number>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const raw of memberIds) {
    const id = String(raw ?? "").trim();
    if (!id || id in out) continue;
    out[id] = resolvePfpUrl(id);
  }
  return out;
}
