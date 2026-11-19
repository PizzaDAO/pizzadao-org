/**
 * Profile-picture lookup against the static files in public/pfp.
 * Server-side only (uses fs).
 *
 * Resolution order (sync): /pfp/<id>.jpg, /pfp/<id>.png, /pfp/default.jpg,
 * /pfp/default.png, else the built-in default URL. Never a Discord avatar and never null.
 * The async version adds the composed PFP first and the member's assigned dough ball before the
 * shared default.
 */

import { existsSync } from "fs";
import path from "path";
import { DEFAULT_PFP_URL } from "@/app/lib/pfp-default";

/** Member IDs are numeric; anything outside this set never maps to a file. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function pfpDir(): string {
  return path.join(process.cwd(), "public", "pfp");
}

function defaultPfpUrl(dir: string): string {
  if (existsSync(path.join(dir, "default.jpg"))) return "/pfp/default.jpg";
  return DEFAULT_PFP_URL;
}

/** True when this member has their own static art in public/pfp (never the shared default). */
export function hasStaticPfp(memberId: string | number): boolean {
  try {
    const id = String(memberId ?? "").trim();
    if (!id || !SAFE_ID.test(id)) return false;
    const dir = pfpDir();
    return existsSync(path.join(dir, `${id}.jpg`)) || existsSync(path.join(dir, `${id}.png`));
  } catch {
    return false;
  }
}

/** Resolve one member's profile-picture URL. Never throws. */
export function resolvePfpUrl(memberId: string | number): string {
  try {
    const id = String(memberId ?? "").trim();
    const dir = pfpDir();
    if (id && SAFE_ID.test(id)) {
      if (existsSync(path.join(dir, `${id}.jpg`))) return `/pfp/${id}.jpg`;
      if (existsSync(path.join(dir, `${id}.png`))) return `/pfp/${id}.png`;
    }
    return defaultPfpUrl(dir);
  } catch {
    return DEFAULT_PFP_URL;
  }
}

/**
 * Async resolution that honours composed PFPs: MemberPfp.composedUrl, then the static file, then
 * the member's assigned dough ball, then the shared default. One indexed findMany for the whole batch. A database failure (or a preview without
 * the migration) degrades to the static lookup. Never throws.
 */
export async function resolvePfpUrlsAsync(
  memberIds: Iterable<string | number>,
): Promise<Record<string, string>> {
  const base = resolvePfpUrls(memberIds);
  const ids = Object.keys(base).filter((id) => SAFE_ID.test(id));
  if (ids.length === 0) return base;
  try {
    const { prisma } = await import("@/app/lib/db");
    const rows = await prisma.memberPfp.findMany({
      where: { memberId: { in: ids } },
      select: { memberId: true, composedUrl: true },
    });
    const composed = new Set<string>();
    for (const row of rows) {
      if (row.composedUrl) {
        base[row.memberId] = row.composedUrl;
        composed.add(row.memberId);
      }
    }
    // Members with no composed PFP and no static art get their own assigned dough ball (if any).
    const needy = ids.filter((id) => !composed.has(id) && !hasStaticPfp(id));
    if (needy.length > 0) {
      try {
        const assigned = await prisma.defaultPfpAssignment.findMany({
          where: { memberId: { in: needy } },
          select: { memberId: true, candidate: { select: { imageUrl: true, votes: { select: { vote: true } } } } },
        });
        let margin = 1;
        try {
          const { getSetting } = await import("@/app/lib/settings");
          margin = Math.max(1, Number(await getSetting("defaultPfp.votedDownMargin")) || 1);
        } catch {
          // default margin
        }
        const needySet = new Set(needy);
        for (const a of assigned) {
          if (!needySet.has(a.memberId) || !a.candidate?.imageUrl) continue;
          // A voted-down image disappears at once (the job then gives the member another).
          const votes = a.candidate.votes ?? [];
          const yes = votes.filter((v) => v.vote === "YES").length;
          if (votes.length - yes - yes >= margin) continue;
          base[a.memberId] = a.candidate.imageUrl;
        }
      } catch {
        // table missing or database hiccup: the shared default stands
      }
    }
  } catch {
    // keep the static answers
  }
  return base;
}

/** Single-member version of resolvePfpUrlsAsync. */
export async function resolvePfpUrlAsync(memberId: string | number): Promise<string> {
  const id = String(memberId ?? "").trim();
  const out = await resolvePfpUrlsAsync([id]);
  return out[id] ?? DEFAULT_PFP_URL;
}

/** Resolve profile-picture URLs for many members in one pass. */
export function resolvePfpUrls(memberIds: Iterable<string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of memberIds) {
    const id = String(raw ?? "").trim();
    if (!id || id in out) continue;
    out[id] = resolvePfpUrl(id);
  }
  return out;
}
