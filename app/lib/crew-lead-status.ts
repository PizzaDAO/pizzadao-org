// jalapeno-82565 — the one rule for "is this roster Status a crew lead?".
// Shared by the server permission check (crew-leads.ts) and the crew page UI
// (CrewGettingStarted) so they can't drift. Client-safe: no server imports.

/** Roster Status that counts as a crew lead: "lead" / "capo", but not iced/inactive. */
export function isLeadStatus(status: string | null | undefined): boolean {
  const s = status ?? ''
  return /lead|capo/i.test(s) && !/iced|inactive/i.test(s)
}
