// Per-crew feature flags. Client-safe (no server imports).
// To turn a feature on for another crew, add its crew-mappings slug here.
export type CrewFeature = 'drafts'

const CREW_FEATURES: Record<string, readonly CrewFeature[]> = {
  comms: ['drafts'],
}

export function crewHasFeature(crewId: string | null | undefined, feature: CrewFeature): boolean {
  const id = String(crewId ?? '').trim().toLowerCase()
  return (CREW_FEATURES[id] ?? []).includes(feature)
}
