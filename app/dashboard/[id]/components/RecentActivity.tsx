// app/dashboard/[id]/components/RecentActivity.tsx
//
// Vertical "what changed since last visit" feed for /dashboard/[id]. Fed by
// /api/activity/[memberId] via useActivity(); the page passes the top 5.
//
// tomato-30368 — Editorial restyle. Renders as a ledger column on cream paper:
// section overline + display headline, icon medallion per row, hairline rule
// between entries, handwritten relative-time annotation. Logic and event
// shapes (ActivityEvent + ActivityKind ICONS map) are unchanged.
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
        <section className="rule-warm relative pt-6">
            <p className="overline text-tomato">§ 05 · the ledger</p>
            <h3
                className="font-[family-name:var(--font-display)] mt-2 font-black tracking-[-0.015em] text-foreground"
                style={{
                    margin: 0,
                    fontSize: "clamp(1.5rem, 3vw, 2rem)",
                    lineHeight: 1,
                }}
            >
                What changed since you stepped out
            </h3>

            {events.length === 0 ? (
                <div
                    className="paper-soft mt-5 rounded-2xl border px-5 py-6 text-center"
                    style={{
                        borderColor: "hsl(var(--rule-warm) / 0.45)",
                        background: "hsl(var(--cream) / 0.5)",
                    }}
                >
                    <span
                        className="handwritten text-tomato"
                        style={{ fontSize: 17 }}
                    >
                        — quiet for now —
                    </span>
                    <p
                        className="ui mt-2"
                        style={{
                            margin: 0,
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.22em",
                            color: "hsl(var(--foreground) / 0.55)",
                        }}
                    >
                        Activity will show up here as you participate.
                    </p>
                </div>
            ) : (
                <ul
                    style={{
                        listStyle: "none",
                        padding: 0,
                        margin: "20px 0 0 0",
                        display: "grid",
                        gap: 2,
                    }}
                >
                    {events.map((event, idx) => {
                        const Icon = ICONS[event.kind] ?? Bell;
                        const titleNode = event.href ? (
                            <Link
                                href={event.href}
                                style={{
                                    color: "hsl(var(--foreground))",
                                    textDecoration: "none",
                                    fontWeight: 600,
                                }}
                                onMouseEnter={(e) =>
                                    (e.currentTarget.style.color =
                                        "hsl(var(--tomato))")
                                }
                                onMouseLeave={(e) =>
                                    (e.currentTarget.style.color =
                                        "hsl(var(--foreground))")
                                }
                            >
                                {event.title}
                            </Link>
                        ) : (
                            <span
                                style={{
                                    color: "hsl(var(--foreground))",
                                    fontWeight: 600,
                                }}
                            >
                                {event.title}
                            </span>
                        );

                        return (
                            <li
                                key={event.id}
                                className={idx === 0 ? "" : "rule-warm"}
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 12,
                                    paddingTop: idx === 0 ? 0 : 12,
                                    paddingBottom: 12,
                                    fontSize: 14,
                                    lineHeight: 1.4,
                                }}
                            >
                                <span
                                    aria-hidden
                                    className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full"
                                    style={{
                                        border:
                                            "1px solid hsl(var(--rule-warm) / 0.55)",
                                        background: "hsl(var(--cream) / 0.6)",
                                        color: "hsl(var(--tomato))",
                                        marginTop: 1,
                                    }}
                                >
                                    <Icon size={14} aria-hidden />
                                </span>
                                <div
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        display: "flex",
                                        alignItems: "baseline",
                                        gap: 10,
                                        flexWrap: "wrap",
                                    }}
                                >
                                    {titleNode}
                                    <span
                                        className="handwritten"
                                        style={{
                                            fontSize: 13,
                                            color: "hsl(var(--foreground) / 0.55)",
                                            whiteSpace: "nowrap",
                                            transform: "rotate(-1deg)",
                                            transformOrigin: "left center",
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
        </section>
    );
}
