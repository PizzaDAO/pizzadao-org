// app/dashboard/[id]/components/RecentActivity.tsx
//
// Vertical "what changed since last visit" feed for /dashboard/[id]. Fed by
// /api/activity/[memberId] via useActivity(); the page passes the top 5.
//
// Visual treatment uses current tokens only — PR6 designer port-back will
// reskin. Lucide icons map 1:1 to ActivityKind (see ICONS below).
//
// Plan: plans/garlic-96648-dashboard-redesign.md §4 + §6.2.

"use client";

import Link from "next/link";
import {
    Award,
    Bell,
    CheckCircle,
    ListTodo,
    Shield,
    Star,
    Ticket,
    XCircle,
    type LucideIcon,
} from "lucide-react";
import type { ActivityEvent, ActivityKind } from "../lib/activity-types";

const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";

const ICONS: Record<ActivityKind, LucideIcon> = {
    vouch_received: Award,
    mission_approved: CheckCircle,
    mission_rejected: XCircle,
    task_claimed: ListTodo,
    poap_received: Star,
    ticket_added: Ticket,
    role_granted: Shield,
    notification: Bell,
};

// Tiny relative-time formatter — avoids pulling in date-fns just for this.
function relativeTime(iso: string, now = Date.now()): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const delta = Math.max(0, now - t);
    const minutes = Math.floor(delta / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
}

export type RecentActivityProps = {
    events: ActivityEvent[];
};

export function RecentActivity({ events }: RecentActivityProps) {
    return (
        <div
            style={{
                paddingTop: 10,
                borderTop: "1px solid hsl(var(--rule) / 0.12)",
            }}
        >
            <h3
                style={{
                    margin: 0,
                    marginBottom: 10,
                    fontSize: 20,
                    fontWeight: 700,
                    fontFamily: FONT_DISPLAY,
                    letterSpacing: "-0.01em",
                    color: "hsl(var(--foreground))",
                }}
            >
                Recent Activity
            </h3>
            {events.length === 0 ? (
                <p
                    style={{
                        margin: 0,
                        fontSize: 14,
                        color: "hsl(var(--muted-foreground))",
                    }}
                >
                    Activity will show up here as you participate.
                </p>
            ) : (
                <ul
                    style={{
                        listStyle: "none",
                        padding: 0,
                        margin: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {events.map((event) => {
                        const Icon = ICONS[event.kind] ?? Bell;
                        const titleNode = event.href ? (
                            <Link
                                href={event.href}
                                style={{
                                    color: "hsl(var(--foreground))",
                                    textDecoration: "none",
                                    fontWeight: 500,
                                }}
                                onMouseEnter={(e) =>
                                    (e.currentTarget.style.textDecoration = "underline")
                                }
                                onMouseLeave={(e) =>
                                    (e.currentTarget.style.textDecoration = "none")
                                }
                            >
                                {event.title}
                            </Link>
                        ) : (
                            <span
                                style={{
                                    color: "hsl(var(--foreground))",
                                    fontWeight: 500,
                                }}
                            >
                                {event.title}
                            </span>
                        );

                        return (
                            <li
                                key={event.id}
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 10,
                                    fontSize: 14,
                                    lineHeight: 1.4,
                                }}
                            >
                                <Icon
                                    size={16}
                                    style={{
                                        flexShrink: 0,
                                        marginTop: 2,
                                        color: "hsl(var(--muted-foreground))",
                                    }}
                                    aria-hidden
                                />
                                <div
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        display: "flex",
                                        alignItems: "baseline",
                                        gap: 8,
                                        flexWrap: "wrap",
                                    }}
                                >
                                    {titleNode}
                                    <span
                                        style={{
                                            fontSize: 12,
                                            color: "hsl(var(--muted-foreground))",
                                            whiteSpace: "nowrap",
                                        }}
                                        title={event.at}
                                    >
                                        {relativeTime(event.at)}
                                    </span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
