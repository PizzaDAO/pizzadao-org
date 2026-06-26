// app/dashboard/[id]/components/YourCrews.tsx
//
// tomato-30368 — Editorial restyle. Crew cards now read like index cards:
// paper-soft surface, dashed-circle crew emoji medallion, handwritten margin
// note for closed-tasks count, pill chip for "your tasks" vs "top tasks",
// btn-pill view-link footer. Logic, data flow, and HydratedCrew/CrewOption
// props are untouched.
"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export type CrewOption = {
    id: string;
    label: string;
    turtles?: string[] | string;
    role?: string;
    channel?: string;
    event?: string;
    emoji?: string;
    sheet?: string;
    callTime?: string;
    callTimeUrl?: string;
    callLength?: string;
    tasks?: { label: string; url?: string }[];
};

export type CrewTask = { label: string; url?: string };

export type HydratedCrew = {
    id: string;
    label: string;
    emoji?: string;
    callTime?: string;
    callTimeUrl?: string;
    callLength?: string;
    claimedTaskCount: number;
    doneCount: number;
};

export type YourCrewsProps = {
    crewOptions: CrewOption[];
    userCrews: string[];
    myTasks: Record<string, CrewTask[]>;
    doneCounts: Record<string, number>;
    /** Reserved for future per-member behavior; not currently used. */
    currentMemberId?: string;
    /**
     * Optional pre-hydrated crews array from `/api/dashboard-summary`.
     * When provided, takes precedence over computing the crew list from
     * `crewOptions + userCrews`. The myTasks/doneCounts props remain the
     * source of truth for the in-card "Your Tasks" / "Closed: N" detail
     * until the summary endpoint exposes per-task labels (PR3+).
     */
    hydratedCrews?: HydratedCrew[];
};

export function YourCrews({
    crewOptions,
    userCrews,
    myTasks,
    doneCounts,
    hydratedCrews,
}: YourCrewsProps) {
    // Prefer the server-hydrated crew list when available. The visual output
    // is identical — same card layout, call times, top-tasks etc. — but the
    // crew IDs come from the BFF instead of being re-derived on the client.
    // The myTasks prop continues to drive the in-card "Your Tasks" detail
    // until PR3+ exposes per-task labels through the summary.
    let allDisplayIds: string[];
    const effectiveDoneCounts: Record<string, number> = { ...(doneCounts || {}) };

    if (hydratedCrews && hydratedCrews.length > 0) {
        allDisplayIds = hydratedCrews.map((c) => c.id);
        for (const c of hydratedCrews) {
            effectiveDoneCounts[c.id.toLowerCase()] = c.doneCount;
        }
    } else {
        // Normalize userCrews to IDs where possible
        const userCrewIds = userCrews.map((name) => {
            const found = crewOptions.find(
                (opt) =>
                    opt.label.toLowerCase() === name.toLowerCase() ||
                    opt.id.toLowerCase() === name.toLowerCase(),
            );
            return found ? found.id : name;
        });

        // Combine with IDs from myTasks
        const taskCrewIds = Object.keys(myTasks);
        allDisplayIds = Array.from(new Set([...userCrewIds, ...taskCrewIds]));
    }

    if (allDisplayIds.length === 0) return null;

    return (
        <section className="rule-warm relative pt-6">
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 18,
                }}
            >
                <div>
                    <p className="overline text-tomato">§ 04 · your crews</p>
                    <h3
                        className="font-[family-name:var(--font-display)] mt-2 font-black tracking-[-0.015em] text-foreground"
                        style={{
                            margin: 0,
                            fontSize: "clamp(1.5rem, 3vw, 2rem)",
                            lineHeight: 1,
                        }}
                    >
                        The families you ride with
                    </h3>
                </div>
                <Link
                    href="/crew"
                    className="ui inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
                    style={{ textDecoration: "none", fontWeight: 600 }}
                >
                    View all crews
                    <ArrowUpRight className="h-3 w-3" />
                </Link>
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns:
                        "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
                    gap: 14,
                }}
            >
                {allDisplayIds.map((cid) => {
                    const c = crewOptions.find(
                        (opt) =>
                            opt.id.toLowerCase() === cid.toLowerCase() ||
                            opt.label.toLowerCase() === cid.toLowerCase(),
                    );

                    const label = c?.label || cid;
                    const emoji = c?.emoji || "🍕";
                    const currentCid = String(c?.id || cid).toLowerCase();
                    const doneCount = effectiveDoneCounts[currentCid] || 0;
                    const personalTasks = myTasks[currentCid] || [];
                    const topTasks = c?.tasks || [];
                    const hasPersonal =
                        personalTasks && personalTasks.length > 0;

                    let displayTasks = [...personalTasks];
                    if (displayTasks.length < 3) {
                        const remaining = 3 - displayTasks.length;
                        const personalLabels = new Set(
                            displayTasks.map((t) => t.label.toLowerCase()),
                        );
                        const additional = topTasks
                            .filter(
                                (t) =>
                                    !personalLabels.has(t.label.toLowerCase()),
                            )
                            .slice(0, remaining);
                        displayTasks = [...displayTasks, ...additional];
                    }

                    return (
                        <article
                            key={cid}
                            className="paper-soft relative overflow-hidden rounded-2xl"
                            style={{
                                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                                background: "hsl(var(--cream))",
                                boxShadow: "var(--shadow-soft)",
                                padding: 16,
                                display: "grid",
                                gap: 10,
                                color: "hsl(var(--foreground))",
                            }}
                        >
                            {/* Header row: medallion + label */}
                            <div className="relative flex items-start gap-3">
                                <span
                                    aria-hidden
                                    className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full"
                                    style={{
                                        border:
                                            "1.5px dashed hsl(var(--foreground) / 0.3)",
                                        background: "hsl(var(--cream) / 0.6)",
                                        fontSize: 20,
                                        transform: "rotate(-4deg)",
                                    }}
                                >
                                    {emoji}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <h4
                                        className="font-[family-name:var(--font-display)] m-0 font-black tracking-[-0.01em]"
                                        style={{
                                            fontSize: 18,
                                            lineHeight: 1.1,
                                            color: "hsl(var(--foreground))",
                                        }}
                                    >
                                        {label}
                                    </h4>
                                    {(c?.callTime || c?.callLength) && (
                                        <div
                                            className="ui mt-1"
                                            style={{
                                                fontSize: 10,
                                                textTransform: "uppercase",
                                                letterSpacing: "0.22em",
                                                color: "hsl(var(--foreground) / 0.55)",
                                            }}
                                        >
                                            {c?.callTime
                                                ? c.callTimeUrl
                                                    ? (
                                                        <a
                                                            href={c.callTimeUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            style={{
                                                                color: "inherit",
                                                                textDecoration:
                                                                    "underline",
                                                                textUnderlineOffset: 2,
                                                            }}
                                                        >
                                                            {c.callTime}
                                                        </a>
                                                    )
                                                    : c.callTime
                                                : ""}
                                            {c?.callTime && c?.callLength
                                                ? " · "
                                                : ""}
                                            {c?.callLength ? c.callLength : ""}
                                        </div>
                                    )}
                                </div>
                                {doneCount > 0 && (
                                    <span
                                        aria-hidden
                                        className="handwritten absolute -top-1 right-0 rotate-[6deg]"
                                        style={{
                                            color: "hsl(142 60% 32%)",
                                            fontSize: 14,
                                        }}
                                    >
                                        {doneCount} closed
                                    </span>
                                )}
                            </div>

                            {displayTasks.length > 0 && (
                                <div className="grid gap-1.5">
                                    <p
                                        className="overline m-0"
                                        style={{
                                            color: hasPersonal
                                                ? "hsl(var(--tomato))"
                                                : "hsl(var(--foreground) / 0.4)",
                                            fontSize: 10,
                                            letterSpacing: "0.22em",
                                        }}
                                    >
                                        {hasPersonal
                                            ? "§ your tasks"
                                            : "§ top tasks"}
                                    </p>
                                    <ul
                                        style={{
                                            listStyle: "none",
                                            margin: 0,
                                            padding: 0,
                                            display: "grid",
                                            gap: 4,
                                        }}
                                    >
                                        {displayTasks.map((t, idx) => {
                                            const isPersonal = personalTasks?.some(
                                                (pt: { label: string }) =>
                                                    pt.label === t.label,
                                            );
                                            return (
                                                <li
                                                    key={idx}
                                                    style={{
                                                        fontSize: 12,
                                                        color: isPersonal
                                                            ? "hsl(var(--foreground))"
                                                            : "hsl(var(--foreground) / 0.6)",
                                                        fontWeight: isPersonal
                                                            ? 600
                                                            : 400,
                                                        display: "flex",
                                                        alignItems: "baseline",
                                                        gap: 6,
                                                        minWidth: 0,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            flexShrink: 0,
                                                            color: isPersonal
                                                                ? "hsl(var(--tomato))"
                                                                : "hsl(var(--foreground) / 0.35)",
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        ›
                                                    </span>
                                                    <span
                                                        style={{
                                                            overflow: "hidden",
                                                            textOverflow:
                                                                "ellipsis",
                                                            whiteSpace: "nowrap",
                                                            minWidth: 0,
                                                            flex: 1,
                                                        }}
                                                    >
                                                        {t.url ? (
                                                            <a
                                                                href={t.url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                onClick={(e) =>
                                                                    e.stopPropagation()
                                                                }
                                                                style={{
                                                                    color: "inherit",
                                                                    textDecoration:
                                                                        "underline",
                                                                    textUnderlineOffset: 2,
                                                                }}
                                                            >
                                                                {t.label}
                                                            </a>
                                                        ) : (
                                                            <span>{t.label}</span>
                                                        )}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )}

                            {/* Footer actions */}
                            <div
                                className="rule-warm"
                                style={{
                                    paddingTop: 10,
                                    marginTop: "auto",
                                    display: "flex",
                                    gap: 12,
                                    flexWrap: "wrap",
                                }}
                            >
                                <Link
                                    href={`/crew/${c?.id || cid}`}
                                    className="ui inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.22em] text-tomato transition-colors hover:text-tomato/80"
                                    style={{
                                        fontWeight: 700,
                                        textDecoration: "none",
                                    }}
                                >
                                    Open crew
                                    <ArrowUpRight className="h-3 w-3" />
                                </Link>
                                {c?.sheet && (
                                    <a
                                        href={c.sheet}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="ui inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
                                        style={{
                                            fontWeight: 600,
                                            textDecoration: "none",
                                        }}
                                        title={c.sheet}
                                    >
                                        Open sheet
                                        <ArrowUpRight className="h-3 w-3" />
                                    </a>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
