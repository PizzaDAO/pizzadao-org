// app/dashboard/[id]/components/Discover.tsx
//
// "Discover" section on /dashboard/[id] — replaces the slim 5-link nav row
// (PR4 of plans/garlic-96648-dashboard-redesign.md). Surfaces up to 3
// preview items from each of four content sources (bounties, jobs,
// articles, calls) inside a tabbed/chip-filtered panel, each item linking
// to its detail page and each tab footer linking to its listing page.
//
// Data is fed in by the parent via the `useDiscover()` hook in use-api.ts —
// this component is presentational only.
//
// tomato-30368 — Editorial restyle. Section overline, paper-soft preview
// tiles, pill chip filters, hand-drawn ink pills for status. Test-visible
// strings ("Open" / "Claimed" / "Done", reward labels like "420 PEP",
// empty-state copy, "View all", "Article: <title>") are unchanged.

"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

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
        gap: 6,
        minHeight: 36,
        padding: "8px 14px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "var(--font-sans), system-ui, sans-serif",
        textTransform: "uppercase",
        letterSpacing: "0.18em",
        cursor: "pointer",
        border: active
            ? "1px solid hsl(var(--tomato))"
            : "1px solid hsl(var(--rule-warm) / 0.55)",
        background: active
            ? "hsl(var(--tomato) / 0.10)"
            : "hsl(var(--cream))",
        color: active ? "hsl(var(--tomato))" : "hsl(var(--foreground) / 0.7)",
        transition: "all var(--dur-fast) var(--ease-editorial)",
    };
}

function previewCard(): React.CSSProperties {
    return {
        display: "grid",
        gap: 8,
        padding: 16,
        borderRadius: 16,
        border: "1px solid hsl(var(--rule-warm) / 0.45)",
        background: "hsl(var(--cream))",
        boxShadow: "var(--shadow-soft)",
        color: "hsl(var(--foreground))",
        textDecoration: "none",
        transition: "transform var(--dur-fast) var(--ease-editorial), box-shadow var(--dur-fast) var(--ease-editorial)",
    };
}

function pill(kind: "open" | "claimed"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: "var(--font-sans), system-ui, sans-serif",
        textTransform: "uppercase",
        letterSpacing: "0.22em",
        whiteSpace: "nowrap",
    };
    if (kind === "open") {
        return {
            ...base,
            background: "hsl(142 71% 35% / 0.12)",
            color: "hsl(142 71% 28%)",
            border: "1px solid hsl(142 71% 35% / 0.35)",
        };
    }
    return {
        ...base,
        background: "hsl(var(--butter) / 0.25)",
        color: "hsl(38 90% 28%)",
        border: "1px solid hsl(var(--butter) / 0.55)",
    };
}

// ── Item renderers ───────────────────────────────────────────────────────

function BountyItem({ b }: { b: DiscoverBounty }) {
    const isOpen = b.status === "OPEN";
    const pillStyle = isOpen ? pill("open") : pill("claimed");
    const pillLabel = isOpen ? "Open" : "Claimed";
    return (
        <Link
            href={`/pep`}
            style={previewCard()}
            aria-label={`Bounty: ${b.description}`}
            className="paper-soft group"
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                }}
            >
                <span
                    style={{
                        fontSize: 14,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        flex: 1,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                    }}
                >
                    {b.description}
                </span>
                <span style={pillStyle}>{pillLabel}</span>
            </div>
            <div
                className="font-[family-name:var(--font-display)]"
                style={{
                    fontSize: 14,
                    color: "hsl(var(--tomato))",
                    fontWeight: 800,
                    letterSpacing: "-0.01em",
                }}
            >
                {b.reward.toLocaleString()} PEP
            </div>
        </Link>
    );
}

function JobItem({ j }: { j: DiscoverJob }) {
    const pillStyle = j.completed ? pill("claimed") : pill("open");
    const pillLabel = j.completed ? "Done" : "Open";
    return (
        <Link
            href={`/pep`}
            style={previewCard()}
            aria-label={`Job: ${j.description}`}
            className="paper-soft group"
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                }}
            >
                <span
                    style={{
                        fontSize: 14,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        flex: 1,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                    }}
                >
                    {j.description}
                </span>
                <span style={pillStyle}>{pillLabel}</span>
            </div>
            {j.crew && (
                <div
                    className="ui"
                    style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.22em",
                        color: "hsl(var(--muted-foreground))",
                    }}
                >
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
            className="paper-soft group"
        >
            <div
                className="font-[family-name:var(--font-display)]"
                style={{
                    fontSize: 16,
                    fontWeight: 800,
                    letterSpacing: "-0.01em",
                    lineHeight: 1.15,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                }}
            >
                {a.title}
            </div>
            <div
                className="ui"
                style={{
                    fontSize: 10,
                    color: "hsl(var(--muted-foreground))",
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    flexWrap: "wrap",
                    textTransform: "uppercase",
                    letterSpacing: "0.22em",
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
            className="paper-soft group"
        >
            <div
                className="font-[family-name:var(--font-display)]"
                style={{
                    fontSize: 16,
                    fontWeight: 800,
                    letterSpacing: "-0.01em",
                    lineHeight: 1.1,
                }}
            >
                {c.crewLabel}
            </div>
            <div
                className="ui"
                style={{
                    fontSize: 10,
                    color: "hsl(var(--muted-foreground))",
                    textTransform: "uppercase",
                    letterSpacing: "0.22em",
                }}
            >
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
        <div
            className="paper-soft relative rounded-2xl border px-5 py-6 text-center"
            style={{
                borderColor: "hsl(var(--rule-warm) / 0.45)",
                background: "hsl(var(--cream) / 0.5)",
                color: "hsl(var(--foreground) / 0.6)",
            }}
        >
            <span className="handwritten text-tomato" style={{ fontSize: 17 }}>
                — empty —
            </span>
            <p
                className="ui relative mt-2 text-[11px] uppercase tracking-[0.22em]"
                style={{ margin: 0, color: "hsl(var(--foreground) / 0.55)" }}
            >
                {copy[kind]}
            </p>
        </div>
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
            aria-label="Discover"
            className="rule-warm relative pt-6"
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                }}
            >
                <div>
                    <p className="overline text-tomato">§ 03 · discover</p>
                    <h3
                        className="font-[family-name:var(--font-display)] mt-2 font-black tracking-[-0.015em] text-foreground"
                        style={{
                            margin: 0,
                            fontSize: "clamp(1.5rem, 3vw, 2rem)",
                            lineHeight: 1,
                        }}
                    >
                        What&apos;s on the wall
                    </h3>
                </div>
                <Link
                    href={viewAllHref}
                    className="ui inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
                    style={{ textDecoration: "none", fontWeight: 600 }}
                >
                    View all
                    <ArrowUpRight className="h-3 w-3" />
                </Link>
            </div>

            {/* Chips */}
            <div
                role="tablist"
                aria-label="Discover categories"
                style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
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
                                    opacity: 0.7,
                                    fontWeight: 500,
                                    letterSpacing: "normal",
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
                style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns:
                        "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
                }}
            >
                {active === "bounties" &&
                    (bounties.length === 0 ? (
                        <EmptyState kind="bounties" />
                    ) : (
                        bounties
                            .slice(0, 3)
                            .map((b) => <BountyItem key={b.id} b={b} />)
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
                        articles
                            .slice(0, 3)
                            .map((a) => <ArticleItem key={a.id} a={a} />)
                    ))}
                {active === "calls" &&
                    (calls.length === 0 ? (
                        <EmptyState kind="calls" />
                    ) : (
                        calls
                            .slice(0, 3)
                            .map((c) => (
                                <CallItem key={`${c.crewId}-${c.date}`} c={c} />
                            ))
                    ))}
            </div>
        </section>
    );
}
