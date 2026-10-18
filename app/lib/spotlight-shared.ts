// app/lib/spotlight-shared.ts
//
// Client-safe constants for Mafia Spotlight submissions (blackolive-55617).

export const PITCH_MAX_LEN = 2000;
export const NAME_MAX_LEN = 100;
export const CITY_MAX_LEN = 100;
export const MAX_LINKS = 3;
export const LINK_MAX_LEN = 500;
export const ADMIN_NOTES_MAX_LEN = 5000;

export type SpotlightStatus = "NEW" | "SHORTLISTED" | "FEATURED" | "DECLINED";

export const SPOTLIGHT_STATUSES: readonly SpotlightStatus[] = ["NEW", "SHORTLISTED", "FEATURED", "DECLINED"];

/** English labels for the admin UI (members get translated labels). */
export const SPOTLIGHT_STATUS_LABELS: Record<SpotlightStatus, string> = {
    NEW: "New",
    SHORTLISTED: "Shortlisted",
    FEATURED: "Featured",
    DECLINED: "Declined",
};
