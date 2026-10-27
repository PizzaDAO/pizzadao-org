// POAP claims: members who attended a crew call claim one mint link from an
// admin-uploaded pool (PoapMintLink). Deliberately manual (no auto-mint) so
// members visit the app. One claim per member per call.
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/db";

export const POAP_LINK_HOSTS = ["poap.xyz", "poap.delivery", "poap.website", "poap.in"];

export type PoapClaimItem = {
  crewId: string;
  crewLabel: string;
  /** UTC day, YYYY-MM-DD */
  callDay: string;
  status: "claimed" | "claimable" | "unavailable";
  /** Present only when status is "claimed" */
  link?: string;
};

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidDayKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function isAllowedMintLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    return POAP_LINK_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Split pasted text (newlines, commas, spaces) into unique links, flagging the invalid ones. */
export function parseMintLinks(text: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const tok of text.split(/[\s,]+/).filter(Boolean)) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    (isAllowedMintLink(tok) && tok.length <= 300 ? valid : invalid).push(tok);
  }
  return { valid, invalid };
}

/** Attended calls (newest first) with their claim status. */
export async function listPoapClaims(discordId: string): Promise<PoapClaimItem[]> {
  const attended = await prisma.callAttendance.findMany({
    where: { discordId },
    orderBy: { callDate: "desc" },
    take: 300,
    select: { crewId: true, crewLabel: true, callDate: true },
  });
  if (attended.length === 0) return [];

  const mine = await prisma.poapMintLink.findMany({
    where: { claimedBy: discordId },
    select: { crewId: true, callDay: true, link: true },
  });
  const claimedMap = new Map(mine.map((m) => [`${m.crewId}|${dayKey(m.callDay)}`, m.link]));

  const crewIds = [...new Set(attended.map((a) => a.crewId))];
  const pools = await prisma.poapMintLink.groupBy({
    by: ["crewId", "callDay"],
    where: { crewId: { in: crewIds }, claimedBy: null },
    _count: { _all: true },
  });
  const available = new Set(pools.filter((p) => p._count._all > 0).map((p) => `${p.crewId}|${dayKey(p.callDay)}`));

  const out: PoapClaimItem[] = [];
  const seen = new Set<string>();
  for (const a of attended) {
    const day = dayKey(a.callDate);
    const key = `${a.crewId}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const link = claimedMap.get(key);
    const status = link ? "claimed" : available.has(key) ? "claimable" : "unavailable";
    out.push({ crewId: a.crewId, crewLabel: a.crewLabel, callDay: day, status, ...(link ? { link } : {}) });
  }
  return out;
}

export type ClaimResult =
  | { ok: true; link: string; alreadyClaimed: boolean }
  | { ok: false; reason: "not_attended" | "none_left" | "invalid" };

/** Hand the member one unused link for a call they attended; idempotent per member per call. */
export async function claimPoap(discordId: string, crewId: string, callDay: string): Promise<ClaimResult> {
  if (!isValidDayKey(callDay) || !crewId || crewId.length > 80) return { ok: false, reason: "invalid" };
  const day = new Date(`${callDay}T00:00:00Z`);
  const next = new Date(day.getTime() + 86400000);

  const attended = await prisma.callAttendance.findFirst({
    where: { discordId, crewId, callDate: { gte: day, lt: next } },
    select: { id: true },
  });
  if (!attended) return { ok: false, reason: "not_attended" };

  const existing = await prisma.poapMintLink.findFirst({ where: { crewId, callDay: day, claimedBy: discordId }, select: { link: true } });
  if (existing) return { ok: true, link: existing.link, alreadyClaimed: true };

  // A few tries: another member may win the same row between our read and write.
  for (let i = 0; i < 5; i++) {
    const candidate = await prisma.poapMintLink.findFirst({ where: { crewId, callDay: day, claimedBy: null }, orderBy: { id: "asc" }, select: { id: true, link: true } });
    if (!candidate) return { ok: false, reason: "none_left" };
    try {
      const res = await prisma.poapMintLink.updateMany({
        where: { id: candidate.id, claimedBy: null },
        data: { claimedBy: discordId, claimedAt: new Date() },
      });
      if (res.count === 1) return { ok: true, link: candidate.link, alreadyClaimed: false };
    } catch (e) {
      // Unique (crewId, callDay, claimedBy): a parallel request from this member already claimed one.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const mineNow = await prisma.poapMintLink.findFirst({ where: { crewId, callDay: day, claimedBy: discordId }, select: { link: true } });
        if (mineNow) return { ok: true, link: mineNow.link, alreadyClaimed: true };
      }
      throw e;
    }
  }
  return { ok: false, reason: "none_left" };
}

/** Activation code for the poap_claimed event (matches /^[a-z0-9_]{1,48}$/). */
export function claimActivationCode(crewId: string, callDay: string): string {
  return `${crewId.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${callDay.replace(/-/g, "")}`.slice(-48);
}
