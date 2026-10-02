// app/lib/support-tickets-shared.ts
//
// Client-safe constants for support tickets (no server imports).

export const SUBJECT_MAX_LEN = 150;
export const BODY_MAX_LEN = 5000;
export const ADMIN_NOTES_MAX_LEN = 5000;

export type SupportStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";

export const SUPPORT_STATUSES: readonly SupportStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED"];

export const STATUS_LABELS: Record<SupportStatus, string> = {
    OPEN: "Open",
    IN_PROGRESS: "In progress",
    CLOSED: "Closed",
};
