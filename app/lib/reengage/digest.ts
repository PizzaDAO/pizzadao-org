// app/lib/reengage/digest.ts
//
// What goes into one member's weekly digest: their next mission, how far they
// are from the next level, and their crews' calls in the next 7 days.
// `computeDigest` is pure; `loadDigestData` does the (batched) reads.
//
// Not included: unclaimed POAPs / items. The app has no table of "POAPs waiting
// to be claimed" (PoapFirstSeen only records first sightings), so there is
// nothing truthful to say yet.
import { prisma } from "@/app/lib/db";
import { computeCurrentLevel, maxMissionLevel, paidLevelOf } from "@/app/lib/missions";
import { nextCrewCall } from "@/app/lib/crew-next-call";
import { getCrewMappings, type CrewOption } from "@/app/lib/crew-mappings";
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from "@/app/lib/i18n/locales";

export const CALL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface DigestMission {
  id: number;
  level: number;
  index: number;
  title: string;
  levelTitle: string | null;
}

export interface DigestInput {
  memberId: string;
  name: string;
  locale: SupportedLocale;
  timezone: string | null;
  crewNames: string[];
  missions: DigestMission[];
  approvedIds: ReadonlySet<number>;
  pendingIds: ReadonlySet<number>;
  paidLevels: ReadonlySet<number>;
  crews: CrewOption[];
  now: Date;
  /** How far ahead a crew call is listed (default CALL_WINDOW_MS; setting reengage.callWindowDays). */
  callWindowMs?: number;
}

export interface Digest {
  memberId: string;
  name: string;
  locale: SupportedLocale;
  timezone: string;
  level: number;
  /** First open mission of the current level that is not already awaiting review. */
  nextMission: { level: number; title: string } | null;
  /** Missions left in the current level (including ones awaiting review). 0 when none. */
  remaining: number;
  /** The level reached by finishing the current one, when there is one. */
  nextLevel: number | null;
  nextLevelTitle: string | null;
  /** Every mission available is approved. */
  allDone: boolean;
  calls: { crew: string; at: Date }[];
  /** False when there is nothing worth emailing about (no mission, no calls). */
  hasContent: boolean;
}

export function computeDigest(input: DigestInput): Digest {
  const { missions, approvedIds, pendingIds, paidLevels } = input;
  const level = computeCurrentLevel(missions, approvedIds, paidLevels);
  const maxLevel = maxMissionLevel(missions);
  const inLevel = missions.filter((m) => m.level === level).sort((a, b) => a.index - b.index);
  const open = inLevel.filter((m) => !approvedIds.has(m.id));
  const first = open.find((m) => !pendingIds.has(m.id)) ?? null;
  const allDone = level > maxLevel;
  const hasNext = !allDone && level < maxLevel;
  const nextLevel = hasNext ? level + 1 : null;
  const nextLevelTitle = nextLevel
    ? (missions.find((m) => m.level === nextLevel && m.levelTitle)?.levelTitle ?? null)
    : null;

  const timezone = input.timezone || "UTC";
  const seen = new Set<string>();
  const calls: Digest["calls"] = [];
  for (const raw of input.crewNames) {
    const key = raw.trim().toLowerCase();
    const crew = input.crews.find((c) => c.label.toLowerCase() === key || c.id.toLowerCase() === key);
    if (!crew || seen.has(crew.id)) continue;
    seen.add(crew.id);
    const at = nextCrewCall(crew.callTime, input.now);
    if (at && at.getTime() - input.now.getTime() <= (input.callWindowMs ?? CALL_WINDOW_MS)) calls.push({ crew: crew.label, at });
  }
  calls.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    memberId: input.memberId,
    name: input.name,
    locale: input.locale,
    timezone,
    level,
    nextMission: first ? { level: first.level, title: first.title } : null,
    remaining: open.length,
    nextLevel,
    nextLevelTitle,
    allDone,
    calls,
    hasContent: !!first || calls.length > 0 || allDone || (hasNext && open.length > 0),
  };
}

export interface DigestCandidate {
  memberId: string;
  discordId: string;
  name: string;
  crewNames: string[];
}

export function parseCrewNames(raw: unknown): string[] {
  const s = String(raw ?? "").trim();
  if (!s || s.toLowerCase() === "none") return [];
  return s.split(",").map((c) => c.trim()).filter(Boolean);
}

/** Batched reads for a set of candidates, then one `computeDigest` each. */
export async function loadDigests(candidates: DigestCandidate[], now = new Date(), callWindowMs: number = CALL_WINDOW_MS): Promise<Digest[]> {
  if (candidates.length === 0) return [];
  const discordIds = candidates.map((c) => c.discordId).filter(Boolean);
  const memberIds = candidates.map((c) => c.memberId);

  const [missions, completions, rewards, extras, crewsRes] = await Promise.all([
    prisma.mission.findMany({
      where: { isActive: true },
      select: { id: true, level: true, index: true, title: true, levelTitle: true },
    }),
    discordIds.length
      ? prisma.missionCompletion.findMany({
          where: { discordId: { in: discordIds }, status: { in: ["APPROVED", "PENDING"] } },
          select: { discordId: true, missionId: true, status: true },
        })
      : Promise.resolve([]),
    discordIds.length
      ? prisma.transaction.findMany({
          where: { userId: { in: discordIds }, type: "MISSION_REWARD" },
          select: { userId: true, metadata: true, description: true },
        })
      : Promise.resolve([]),
    prisma.memberProfileExtras.findMany({
      where: { memberId: { in: memberIds } },
      select: { memberId: true, locale: true, timezone: true },
    }),
    getCrewMappings().catch(() => ({ crews: [] as CrewOption[] })),
  ]);

  const approved = new Map<string, Set<number>>();
  const pending = new Map<string, Set<number>>();
  for (const c of completions) {
    const target = c.status === "APPROVED" ? approved : pending;
    if (!target.has(c.discordId)) target.set(c.discordId, new Set());
    target.get(c.discordId)!.add(c.missionId);
  }
  const paid = new Map<string, Set<number>>();
  for (const r of rewards) {
    const lvl = paidLevelOf(r as { metadata?: unknown; description?: string | null });
    if (lvl === null) continue;
    if (!paid.has(r.userId)) paid.set(r.userId, new Set());
    paid.get(r.userId)!.add(lvl);
  }
  const extrasById = new Map(extras.map((e) => [e.memberId, e]));
  const none = new Set<number>();

  return candidates.map((c) => {
    const ex = extrasById.get(c.memberId);
    return computeDigest({
      memberId: c.memberId,
      name: c.name,
      locale: isSupportedLocale(ex?.locale) ? ex!.locale : DEFAULT_LOCALE,
      timezone: ex?.timezone ?? null,
      crewNames: c.crewNames,
      missions,
      approvedIds: approved.get(c.discordId) ?? none,
      pendingIds: pending.get(c.discordId) ?? none,
      paidLevels: paid.get(c.discordId) ?? new Set<number>(),
      crews: crewsRes.crews,
      now,
      callWindowMs,
    });
  });
}
