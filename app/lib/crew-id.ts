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
