// jalapeno-82565 — the one rule for "is this roster Status a crew lead?".
// Shared by the server permission check (crew-leads.ts) and the crew page UI
// (CrewGettingStarted) so they can't drift. Client-safe: no server imports.

/**
 * Roster Status that counts as a crew lead: exactly "lead", "crew lead" or "capo"
 * (any case, trimmed). Anything else ("Former lead", "Ex-lead", "Not lead",
 * "Iced lead", "Inactive capo") is not a lead.
 */
export function isLeadStatus(status: string | null | undefined): boolean {
  return /^(crew\s+)?(lead|capo)$/i.test((status ?? '').trim())
}
