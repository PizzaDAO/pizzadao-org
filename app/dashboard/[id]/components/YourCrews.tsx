// app/dashboard/[id]/components/YourCrews.tsx
"use client";

import Link from "next/link";

// Tokens: see app/globals.css.
const FONT_DISPLAY = "var(--font-display), var(--font-sans), system-ui, sans-serif";

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

// Local crewCard helper — kept identical to the original dashboard helper.
function crewCard(): React.CSSProperties {
    return {
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: 12,
        borderRadius: "var(--radius)",
        border: '1px solid hsl(var(--rule) / 0.12)',
        background: 'hsl(var(--cream-warm))',
        color: 'hsl(var(--foreground))',
        transition: "border-color 150ms ease, box-shadow 150ms ease",
    };
}

export type YourCrewsProps = {
    crewOptions: CrewOption[];
    userCrews: string[];
    myTasks: Record<string, CrewTask[]>;
    doneCounts: Record<string, number>;
    /** Reserved for future per-member behavior; not currently used. */
    currentMemberId?: string;
};

export function YourCrews({ crewOptions, userCrews, myTasks, doneCounts }: YourCrewsProps) {
    // Normalize userCrews to IDs where possible
    const userCrewIds = userCrews.map(name => {
        const found = crewOptions.find(opt => opt.label.toLowerCase() === name.toLowerCase() || opt.id.toLowerCase() === name.toLowerCase());
        return found ? found.id : name;
    });

    // Combine with IDs from myTasks
    const taskCrewIds = Object.keys(myTasks);
    const allDisplayIds = Array.from(new Set([...userCrewIds, ...taskCrewIds]));

    if (allDisplayIds.length === 0) return null;

    return (
        <div style={{ paddingTop: 10, borderTop: '1px solid hsl(var(--rule) / 0.12)' }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 20, fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: "-0.01em" }}>Your Crews</h3>
                <Link
                    href="/crew"
                    style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "hsl(var(--tomato))",
                        textDecorationColor: "hsl(var(--tomato))",
                        textDecoration: "none",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                >
                    View all crews →
                </Link>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                {allDisplayIds.map((cid) => {
                    // Find rich crew definition
                    const c = crewOptions.find(opt => opt.id.toLowerCase() === cid.toLowerCase() || opt.label.toLowerCase() === cid.toLowerCase());

                    // If not found, use a basic fallback
                    const label = c?.label || cid;
                    const emoji = c?.emoji || "🍕";

                    return (
                        <div key={cid} style={crewCard()}>
                            <div style={{ display: "grid", gap: 4 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                                    <span style={{ fontWeight: 700 }}>
                                        {emoji ? `${emoji} ` : ""}
                                        {label}
                                    </span>
                                </div>

                                {(c?.callTime || c?.callLength) && (
                                    <div style={{ opacity: 0.7, fontSize: 13 }}>
                                        {c.callTime ? (
                                            c.callTimeUrl ? (
                                                <a href={c.callTimeUrl} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
                                                    {c.callTime}
                                                </a>
                                            ) : c.callTime
                                        ) : ""}
                                        {c.callTime && c.callLength ? " • " : ""}
                                        {c.callLength ? c.callLength : ""}
                                    </div>
                                )}

                                {(() => {
                                    const currentCid = String(c?.id || cid).toLowerCase();
                                    const doneCount = doneCounts[currentCid] || 0;
                                    const personalTasks = myTasks[currentCid] || [];
                                    const topTasks = c?.tasks || [];
                                    const hasPersonal = personalTasks && personalTasks.length > 0;

                                    // Merge: Personal first, then Top Tasks to fill up to 3
                                    let displayTasks = [...personalTasks];
                                    if (displayTasks.length < 3) {
                                        const remaining = 3 - displayTasks.length;
                                        // Filter out top tasks that are already in personal tasks (by label)
                                        const personalLabels = new Set(displayTasks.map(t => t.label.toLowerCase()));
                                        const additional = topTasks
                                            .filter(t => !personalLabels.has(t.label.toLowerCase()))
                                            .slice(0, remaining);
                                        displayTasks = [...displayTasks, ...additional];
                                    }
                                    if (displayTasks.length === 0 && doneCount === 0) return null;

                                    return (
                                        <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                                            {doneCount > 0 && (
                                                <div style={{
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    fontFamily: FONT_DISPLAY,
                                                    textTransform: "uppercase",
                                                    letterSpacing: 0.5,
                                                    color: "hsl(142 60% 32%)",
                                                    marginBottom: 2
                                                }}>
                                                    Closed: {doneCount}
                                                </div>
                                            )}
                                            {displayTasks.length > 0 && (
                                                <>
                                                    <div style={{
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        fontFamily: FONT_DISPLAY,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.5,
                                                        color: hasPersonal ? "hsl(var(--tomato))" : "hsl(var(--muted-foreground))"
                                                    }}>
                                                        {hasPersonal ? "Your Tasks" : "Top Tasks"}
                                                    </div>
                                                    {displayTasks.map((t, idx) => {
                                                        const isPersonal = personalTasks?.some((pt: { label: string }) => pt.label === t.label);
                                                        return (
                                                            <div key={idx} style={{
                                                                fontSize: 12,
                                                                color: isPersonal ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                                                                fontWeight: isPersonal ? 600 : 400,
                                                                display: "flex",
                                                                alignItems: "baseline",
                                                                gap: 4,
                                                                minWidth: 0
                                                            }}>
                                                                <span style={{ flexShrink: 0, color: isPersonal ? "hsl(var(--tomato))" : "inherit" }}>•</span>
                                                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                                    {t.url ? (
                                                                        <a
                                                                            href={t.url}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
                                                                        >
                                                                            {t.label}
                                                                        </a>
                                                                    ) : (
                                                                        <span>{t.label}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </>
                                            )}
                                        </div>
                                    );
                                })()}

                                <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                                    <Link
                                        href={`/crew/${c?.id || cid}`}
                                        style={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: "hsl(var(--tomato))",
                                            textDecoration: "none",
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                                    >
                                        View crew page →
                                    </Link>
                                    {c?.sheet && (
                                        <a
                                            href={c.sheet}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: "hsl(var(--muted-foreground))",
                                                textDecoration: "none",
                                            }}
                                            title={c.sheet}
                                        >
                                            Open sheet ↗
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
