// app/dashboard/[id]/components/HeroBlock.tsx
"use client";

import Link from "next/link";
import { PepAmount } from "../../../ui/economy";
import { NotificationBell } from "../../../ui/notifications";
import { ThemeToggle } from "../../../ui/ThemeToggle";

// Tokens: see app/globals.css.
const FONT_DISPLAY = "var(--font-display), var(--font-sans), system-ui, sans-serif";

// Local btn helper kept identical to the dashboard's previous local helper to
// preserve pixel parity with main.
function btn(kind: "primary" | "secondary" | "accent"): React.CSSProperties {
    const base: React.CSSProperties = {
        display: "inline-block",
        padding: "10px 16px",
        borderRadius: "var(--radius)",
        border: '1px solid transparent',
        fontWeight: 600,
        fontFamily: FONT_DISPLAY,
        cursor: "pointer",
        textDecoration: "none",
        textAlign: "center",
        transition: "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
    };
    if (kind === "primary") {
        return {
            ...base,
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            borderColor: 'hsl(var(--primary))',
        };
    }
    if (kind === "accent") {
        return {
            ...base,
            background: 'hsl(var(--tomato))',
            color: 'hsl(var(--cream))',
            borderColor: 'hsl(var(--tomato))',
        };
    }
    return {
        ...base,
        background: 'hsl(var(--secondary))',
        color: 'hsl(var(--secondary-foreground))',
        borderColor: 'hsl(var(--rule) / 0.22)',
    };
}

export type HeroBlockProps = {
    name: string;
    pfpUrl: string | null;
    /** Optional mission-level badge data. Equivalent to the original `missionLevel`. */
    levelBadge?: { level: number; title: string } | null;
    pepBalance: number | null;
    city: string;
    idValue: string;
    /** Alias retained for the plan's prop name; behaves the same as `levelBadge`. */
    missionLevel?: { level: number; title: string } | null;
    onSendPep: () => void;
    /** Optional override for the Edit Profile click. When omitted, the rendered Link
     * navigates to `/?edit=1&memberId={idValue}` (the original behavior). */
    onOpenEditProfile?: () => void;
};

export function HeroBlock({
    name,
    pfpUrl,
    levelBadge,
    pepBalance,
    city,
    idValue,
    missionLevel,
    onSendPep,
}: HeroBlockProps) {
    // Either prop name works; prefer levelBadge if both supplied.
    const badge = levelBadge ?? missionLevel ?? null;

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            {pfpUrl && (
                <img
                    src={pfpUrl}
                    alt={`${name}'s profile`}
                    style={{
                        width: 80,
                        height: 80,
                        borderRadius: "50%",
                        objectFit: "cover",
                        objectPosition: "top",
                        border: "3px solid hsl(var(--cream))",
                        boxShadow: "0 2px 12px hsl(var(--ink) / 0.12)",
                        imageRendering: "crisp-edges",
                        flexShrink: 0,
                    }}
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                    }}
                />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <Link
                        href={`/profile/${idValue}`}
                        style={{
                            fontSize: "clamp(1.75rem, 4vw, 2.25rem)",
                            lineHeight: 1.05,
                            fontWeight: 800,
                            fontFamily: FONT_DISPLAY,
                            letterSpacing: "-0.02em",
                            color: "hsl(var(--foreground))",
                            textDecoration: "none",
                            textWrap: "balance",
                        } as React.CSSProperties}
                        onMouseEnter={(e) => e.currentTarget.style.color = "hsl(var(--tomato))"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "hsl(var(--foreground))"}
                    >
                        {name}
                    </Link>
                    {badge && (
                        <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 12,
                            fontWeight: 700,
                            fontFamily: FONT_DISPLAY,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "hsl(var(--butter) / 0.25)",
                            color: "hsl(var(--ink))",
                            border: "1px solid hsl(var(--butter) / 0.55)",
                            whiteSpace: "nowrap",
                        }}>
                            Lv.{badge.level} {badge.title}
                        </span>
                    )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, color: "hsl(var(--muted-foreground))" }}>{city}</span>
                    <span style={{ color: "hsl(var(--muted-foreground))", opacity: 0.5 }}>·</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--tomato))", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {pepBalance !== null ? <PepAmount amount={pepBalance} size={14} /> : "—"}
                    </span>
                    <button
                        onClick={onSendPep}
                        style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 2,
                            display: "flex",
                            alignItems: "center",
                            color: "hsl(var(--muted-foreground))",
                        }}
                        title="Send PEP"
                    >
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 2L11 13" />
                            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                        </svg>
                    </button>
                </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <Link href={`/?edit=1&memberId=${idValue}`} style={{
                    ...btn("primary"),
                    fontSize: 13,
                    padding: "6px 12px",
                    textDecoration: "none",
                }}>
                    Edit Profile
                </Link>
                <ThemeToggle />
                <NotificationBell />
            </div>
        </div>
    );
}
