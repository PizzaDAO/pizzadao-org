// app/dashboard/[id]/components/Discover.tsx
//
// "Discover" section on /dashboard/[id] — replaces the slim 5-link nav row
// (PR4 of plans/garlic-96648-dashboard-redesign.md). Surfaces up to 3
// preview items from each of four content sources (bounties, jobs,
// articles, calls) inside a tabbed/chip-filtered panel, each item linking
// to its detail page and each tab footer linking to its listing page.
//
// Data is fed in by the parent via the `useDiscover()` hook in use-api.ts —
// this component is presentational only. Visual treatment stays on existing
// cream/ink/tomato/butter + Asap tokens; PR6 designer port-back will reskin.

"use client";

import Link from "next/link";
import { useState } from "react";
import { badge, card as cardBase } from "../../../ui/shared-styles";

const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";

// ── Item shapes ──────────────────────────────────────────────────────────

export type DiscoverBounty = {
    id: number;
    description: string;
    reward: number;
    status: "OPEN" | "CLAIMED";
};

export type DiscoverJob = {
    id: number;
    description: string;
    crew?: string | null;
    completed?: boolean;
};

export type DiscoverArticle = {
    id: number;
    slug: string;
    title: string;
    authorName?: string | null;
    publishedAt?: string | null;
};

export type DiscoverCall = {
    crewId: string;
    crewLabel: string;
    date: string; // ISO date (YYYY-MM-DD)
};

export type DiscoverProps = {
    bounties?: DiscoverBounty[];
    jobs?: DiscoverJob[];
    articles?: DiscoverArticle[];
    calls?: DiscoverCall[];
};

type TabKey = "bounties" | "jobs" | "articles" | "calls";

const TABS: Array<{ key: TabKey; label: string; viewAllHref: string }> = [
    { key: "bounties", label: "Bounties", viewAllHref: "/pep" },
    { key: "jobs", label: "Jobs", viewAllHref: "/pep" },
    { key: "articles", label: "Articles", viewAllHref: "/articles" },
    { key: "calls", label: "Calls", viewAllHref: "/calls" },
];

// ── Style helpers ────────────────────────────────────────────────────────

function chip(active: boolean): React.CSSProperties {
    return {
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: FONT_DISPLAY,
        cursor: "pointer",
        border: active
            ? "1px solid hsl(var(--tomato))"
            : "1px solid hsl(var(--rule) / 0.22)",
        background: active
            ? "hsl(var(--tomato) / 0.10)"
            : "hsl(var(--card))",
        color: active
            ? "hsl(var(--tomato))"
            : "hsl(var(--foreground))",
        transition: "background-color 150ms ease, border-color 150ms ease",
    };
}

function previewCard(): React.CSSProperties {
    return {
        ...cardBase(),
        padding: 14,
        gap: 6,
        display: "block",
        textDecoration: "none",
        color: "hsl(var(--foreground))",
    };
}

function openStatusPill(): React.CSSProperties {
    return {
        ...badge("default"),
        background: "hsl(142 71% 35% / 0.12)",
        color: "hsl(142 71% 28%)",
        borderColor: "hsl(142 71% 35% / 0.35)",
    };
}

function claimedStatusPill(): React.CSSProperties {
    return {
        ...badge("default"),
        background: "hsl(var(--butter) / 0.20)",
        color: "hsl(38 90% 28%)",
        borderColor: "hsl(var(--butter) / 0.55)",
    };
}

// ── Item renderers ───────────────────────────────────────────────────────

function BountyItem({ b }: { b: DiscoverBounty }) {
    const pill = b.status === "OPEN" ? openStatusPill() : claimedStatusPill();
    const pillLabel = b.status === "OPEN" ? "Open" : "Claimed";
    return (
        <Link
            href={`/pep`}
            style={previewCard()}
            aria-label={`Bounty: ${b.description}`}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                }}
            >
                <span
                    style={{
                        fontSize: 14,
                        fontWeight: 600,
                        flex: 1,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                    }}
                >
                    {b.description}
                </span>
                <span style={pill}>{pillLabel}</span>
            </div>
            <div
                style={{
                    fontSize: 13,
                    color: "hsl(var(--tomato))",
                    fontWeight: 700,
                    fontFamily: FONT_DISPLAY,
                }}
            >
                {b.reward.toLocaleString()} PEP
            </div>
        </Link>
    );
}

function JobItem({ j }: { j: DiscoverJob }) {
    const pill = j.completed ? claimedStatusPill() : openStatusPill();
    const pillLabel = j.completed ? "Done" : "Open";
    return (
        <Link href={`/pep`} style={previewCard()} aria-label={`Job: ${j.description}`}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                }}
            >
                <span
                    style={{
                        fontSize: 14,
                        fontWeight: 600,
                        flex: 1,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                    }}
                >
                    {j.description}
                </span>
                <span style={pill}>{pillLabel}</span>
            </div>
            {j.crew && (
                <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                    {j.crew}
                </div>
            )}
        </Link>
    );
}

function ArticleItem({ a }: { a: DiscoverArticle }) {
    const publishedLabel = a.publishedAt
        ? new Date(a.publishedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
          })
        : null;
    return (
        <Link
            href={`/articles/${a.slug}`}
            style={previewCard()}
            aria-label={`Article: ${a.title}`}
        >
            <div
                style={{
                    fontSize: 14,
                    fontWeight: 600,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                }}
            >
                {a.title}
            </div>
            <div
                style={{
                    fontSize: 12,
                    color: "hsl(var(--muted-foreground))",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                }}
            >
                {a.authorName && <span>by {a.authorName}</span>}
                {a.authorName && publishedLabel && <span aria-hidden>·</span>}
                {publishedLabel && <span>{publishedLabel}</span>}
            </div>
        </Link>
    );
}

function CallItem({ c }: { c: DiscoverCall }) {
    const dateLabel = (() => {
        try {
            return new Date(`${c.date}T00:00:00Z`).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
            });
        } catch {
            return c.date;
        }
    })();
    return (
        <Link
            href={`/calls`}
            style={previewCard()}
            aria-label={`Call: ${c.crewLabel} on ${dateLabel}`}
        >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{c.crewLabel}</div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                {dateLabel}
            </div>
        </Link>
    );
}

// ── Empty state ──────────────────────────────────────────────────────────

function EmptyState({ kind }: { kind: TabKey }) {
    const copy: Record<TabKey, string> = {
        bounties: "No open bounties right now. Check back soon.",
        jobs: "No jobs available today. Reset is daily.",
        articles: "No published articles yet.",
        calls: "No upcoming calls this week.",
    };
    return (
        <p
            style={{
                margin: 0,
                fontSize: 14,
                color: "hsl(var(--muted-foreground))",
                padding: "8px 2px",
            }}
        >
            {copy[kind]}
        </p>
    );
}

// ── Main component ───────────────────────────────────────────────────────

export function Discover({
    bounties = [],
    jobs = [],
    articles = [],
    calls = [],
}: DiscoverProps) {
    const [active, setActive] = useState<TabKey>("bounties");

    const counts: Record<TabKey, number> = {
        bounties: bounties.length,
        jobs: jobs.length,
        articles: articles.length,
        calls: calls.length,
    };

    const viewAllHref =
        TABS.find((t) => t.key === active)?.viewAllHref ?? "/pep";

    return (
        <section
            data-testid="discover"
            data-active={active}
            style={{
                paddingTop: 10,
                borderTop: "1px solid hsl(var(--rule) / 0.12)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
            }}
            aria-label="Discover"
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                }}
            >
                <h3
                    style={{
                        margin: 0,
                        fontSize: 20,
                        fontWeight: 700,
                        fontFamily: FONT_DISPLAY,
                        letterSpacing: "-0.01em",
                        color: "hsl(var(--foreground))",
                    }}
                >
                    Discover
                </h3>
                <Link
                    href={viewAllHref}
                    style={{
                        fontSize: 13,
                        color: "hsl(var(--muted-foreground))",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontFamily: FONT_DISPLAY,
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.textDecoration = "underline")
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.textDecoration = "none")
                    }
                >
                    View all →
                </Link>
            </div>

            {/* Chips */}
            <div
                role="tablist"
                aria-label="Discover categories"
                style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
            >
                {TABS.map((t) => {
                    const isActive = active === t.key;
                    return (
                        <button
                            key={t.key}
                            role="tab"
                            aria-selected={isActive}
                            aria-controls={`discover-panel-${t.key}`}
                            onClick={() => setActive(t.key)}
                            style={chip(isActive)}
                        >
                            {t.label}
                            <span
                                style={{
                                    marginLeft: 6,
                                    opacity: 0.7,
                                    fontWeight: 500,
                                }}
                            >
                                {counts[t.key]}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Panel */}
            <div
                role="tabpanel"
                id={`discover-panel-${active}`}
                style={{ display: "grid", gap: 8 }}
            >
                {active === "bounties" &&
                    (bounties.length === 0 ? (
                        <EmptyState kind="bounties" />
                    ) : (
                        bounties.slice(0, 3).map((b) => (
                            <BountyItem key={b.id} b={b} />
                        ))
                    ))}
                {active === "jobs" &&
                    (jobs.length === 0 ? (
                        <EmptyState kind="jobs" />
                    ) : (
                        jobs.slice(0, 3).map((j) => <JobItem key={j.id} j={j} />)
                    ))}
                {active === "articles" &&
                    (articles.length === 0 ? (
                        <EmptyState kind="articles" />
                    ) : (
                        articles.slice(0, 3).map((a) => (
                            <ArticleItem key={a.id} a={a} />
                        ))
                    ))}
                {active === "calls" &&
                    (calls.length === 0 ? (
                        <EmptyState kind="calls" />
                    ) : (
                        calls.slice(0, 3).map((c) => (
                            <CallItem key={`${c.crewId}-${c.date}`} c={c} />
                        ))
                    ))}
            </div>
        </section>
    );
}
