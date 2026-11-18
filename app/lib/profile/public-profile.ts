/**
 * Public member profile projection. Only allowlisted sheet columns are ever
 * served; any other or newly added column stays private by default.
 * Keys are the fields the public clients read (/api/profile/[id] consumers).
 */
export const PUBLIC_PROFILE_FIELDS = [
  "Status", "Name", "City", "Orgs", "Crews", "Skills", "Turtles", "Region", "Notes",
] as const;

// Alternate source columns folded into a public field when the primary is empty.
const ALIAS_SOURCES: Record<string, string> = {
  frequency: "Status",
  affiliation: "Orgs",
  specialties: "Skills",
};

export function buildPublicProfile(
  headers: string[],
  getValue: (idx: number) => unknown,
): Record<string, unknown> {
  const allowed = new Map<string, string>(PUBLIC_PROFILE_FIELDS.map((f) => [f.toLowerCase(), f]));
  const data: Record<string, unknown> = {};
  const aliasValues: Record<string, unknown> = {};

  headers.forEach((rawKey, idx) => {
    if (!rawKey) return;
    const key = rawKey.trim().toLowerCase();
    const field = allowed.get(key);
    if (field) data[field] = getValue(idx);
    else if (ALIAS_SOURCES[key]) aliasValues[ALIAS_SOURCES[key]] = getValue(idx);
  });

  for (const [field, val] of Object.entries(aliasValues)) {
    if (!data[field]) data[field] = val;
  }
  return data;
}
