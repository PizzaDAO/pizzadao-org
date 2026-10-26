// Per-crew feature flags. Client-safe, and plain .mjs so scripts/ can import it too.
// To turn a feature on for another crew, add its crew-mappings slug here.

/** @type {Record<string, readonly string[]>} */
const CREW_FEATURES = {
  comms: ['drafts'],
}

// Other spellings of a crew (normalized slugs) that mean the same crew.
/** @type {Record<string, readonly string[]>} */
const CREW_ALIASES = {
  comms: ['communications', 'comms_crew', 'communications_crew'],
}

/** @param {unknown} raw */
export function crewSlug(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Canonical crew slug ("Communications" -> "comms"); unknown crews pass through normalized.
 * @param {unknown} raw
 * @returns {string}
 */
export function canonicalCrewId(raw) {
  const id = crewSlug(raw)
  for (const [canon, aliases] of Object.entries(CREW_ALIASES)) {
    if (id === canon || aliases.includes(id)) return canon
  }
  return id
}

/**
 * @param {string | null | undefined} crewId
 * @param {'drafts'} feature
 * @returns {boolean}
 */
export function crewHasFeature(crewId, feature) {
  return (CREW_FEATURES[canonicalCrewId(crewId)] ?? []).includes(feature)
}
