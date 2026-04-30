// Canonical crew ID -> pretty label mapping
// Sourced from the same data as app/ui/constants.ts CREWS, but server-safe
const CREW_LABELS: Record<string, string> = {
  ops: "Ops",
  tech: "Tech",
  comms: "Comms",
  events: "Events",
  design: "Design",
  biz_dev: "Biz Dev",
  education: "Education",
  creative: "Creative",
  africa: "Africa",
  latam: "LATAM",
  music: "Music",
  governance: "Governance",
  real_estate: "Real Estate",
  community: "Community",
};

// Build reverse map: lowercase label -> crew ID
const LABEL_TO_ID: Record<string, string> = {};
for (const [id, label] of Object.entries(CREW_LABELS)) {
  LABEL_TO_ID[label.toLowerCase()] = id;
}

/** Map crew slug to pretty label. Unknown IDs pass through unchanged. */
export function crewIdToLabel(id: string): string {
  return CREW_LABELS[id] ?? id;
}

/** Normalize any crew string (slug or label) back to canonical crew ID. */
export function normalizeCrewId(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  // Direct match on known IDs
  if (CREW_LABELS[lower]) return lower;
  // Match by label (case-insensitive)
  if (LABEL_TO_ID[lower]) return LABEL_TO_ID[lower];
  // Underscore->space normalization: "biz_dev" -> "biz dev" -> look up
  const spaced = lower.replace(/_/g, " ");
  if (LABEL_TO_ID[spaced]) return LABEL_TO_ID[spaced];
  // Space->underscore: "biz dev" -> "biz_dev" -> look up
  const underscored = lower.replace(/\s+/g, "_");
  if (CREW_LABELS[underscored]) return underscored;
  // Unknown - return lowercase trimmed
  return lower;
}
