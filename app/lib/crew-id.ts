/**
 * Crew ID helpers shared by the roster audit and the roster write-back.
 *
 * Attendance records use crew IDs produced by `slugify` in
 * app/lib/crew-mappings.ts (lowercase, runs of non-alphanumerics -> "_",
 * leading/trailing "_" trimmed). Roster cells in the Crew sheet hold
 * free-text labels ("Biz Dev", "Design & Art"), so both sides must be
 * normalized the same way before comparing.
 */

/** Normalize a crew label or ID to the crew-mappings slug format. */
export function normalizeCrewId(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Split a roster "Crews" cell the same way members-list.ts does. */
export function splitCrewList(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[,/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Crew IDs that are never treated as roster crews. */
export const NON_ROSTER_CREW_IDS: ReadonlySet<string> = new Set([
  "community_call",
  "community",
]);

/** Valid shape for a crew ID coming from a request body. */
export const CREW_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Attendance crew id of the weekly Community Call (the call, not a crew). */
export const COMMUNITY_CALL_ATTENDANCE_ID = "community_call";

/**
 * Whether a crew registry entry is a real crew. The registry also holds entries that are calls,
 * not crews (the Community Call has `type: "community"`): those keep working as calls (recorder,
 * schedules, attendance) but are never listed or picked as a crew. An entry without a type counts
 * as a crew, except the ids in NON_ROSTER_CREW_IDS.
 */
export function isRealCrew(crew: { id?: string | null; type?: string | null } | null | undefined): boolean {
  if (!crew) return false;
  const id = normalizeCrewId(crew.id);
  if (!id || NON_ROSTER_CREW_IDS.has(id)) return false;
  const type = String(crew.type ?? "").trim().toLowerCase();
  return !type || type === "crew";
}

/** Only the real crews (see isRealCrew), order kept. */
export function realCrews<T extends { id?: string | null; type?: string | null }>(crews: readonly T[]): T[] {
  return crews.filter((c) => isRealCrew(c));
}

/**
 * Whether a crew id names something that is not a crew: one of NON_ROSTER_CREW_IDS, or a registry
 * entry that is not a real crew. An id the registry does not know is not flagged.
 */
export function isNonCrewId(id: string | null | undefined, crews: ReadonlyArray<{ id: string; type?: string | null }>): boolean {
  const n = normalizeCrewId(id);
  if (!n) return false;
  if (NON_ROSTER_CREW_IDS.has(n)) return true;
  const c = crews.find((x) => normalizeCrewId(x.id) === n);
  return !!c && !isRealCrew(c);
}

/**
 * A member's crew ids (or labels) without the entries that are not crews. An id the registry does
 * not know is kept (it may be an old crew), unless it is one of NON_ROSTER_CREW_IDS.
 */
export function withoutNonCrewIds(ids: readonly string[], crews: ReadonlyArray<{ id: string; label?: string; type?: string | null }>): string[] {
  const nonCrew = new Set<string>(NON_ROSTER_CREW_IDS);
  for (const c of crews) {
    if (isRealCrew(c)) continue;
    nonCrew.add(normalizeCrewId(c.id));
    if (c.label) nonCrew.add(normalizeCrewId(c.label));
  }
  return ids.filter((id) => !nonCrew.has(normalizeCrewId(id)));
}
