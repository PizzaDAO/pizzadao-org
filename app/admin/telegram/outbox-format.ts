// Small pure helpers for the Telegram outbox page, kept apart so they can be unit tested.

const BADGE_BASE = "rounded px-1.5 py-0.5 text-xs font-bold";

/** Tinted badge classes per queue status, so Failed, Sent and "May have been sent" read differently. */
export function statusBadgeClass(status: string): string {
    switch (status) {
        case "FAILED":
            return `${BADGE_BASE} bg-tomato/15 text-tomato-readable`;
        case "UNCERTAIN":
            return `${BADGE_BASE} bg-butter/40 text-foreground`;
        case "SENT":
            return `${BADGE_BASE} bg-green-600/20 text-foreground`;
        case "PENDING":
            return `${BADGE_BASE} bg-foreground/10 text-foreground`;
        default:
            return `${BADGE_BASE} bg-foreground/5 text-foreground/70`;
    }
}

/** Label key for the host-matching mode: 1 is profile only, 2 and up adds the Telegram invitation. */
export function hostMatchModeKey(mode: number): "modeProfile" | "modeInvite" {
    return mode >= 2 ? "modeInvite" : "modeProfile";
}
