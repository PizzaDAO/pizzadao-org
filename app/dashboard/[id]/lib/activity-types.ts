// app/dashboard/[id]/lib/activity-types.ts
//
// Shared types for the dashboard "Recent Activity" feed. Consumed by:
// - /api/activity/[memberId] (server)
// - useActivity() in app/lib/hooks/use-api.ts (client)
// - RecentActivity.tsx (client)
//
// Plan: plans/garlic-96648-dashboard-redesign.md §6.3, PR3.

export type ActivityKind =
    | "vouch_received"
    | "mission_approved"
    | "mission_rejected"
    | "task_claimed"
    | "poap_received"
    | "ticket_added"
    | "role_granted"
    | "notification";

export interface ActivityEvent {
    /** Stable, kind-prefixed id (e.g. "vouch:42-7"). Safe to use as React key. */
    id: string;
    kind: ActivityKind;
    title: string;
    href: string | null;
    /** ISO timestamp. Sortable descending. */
    at: string;
}
