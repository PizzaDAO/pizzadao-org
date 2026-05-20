// app/dashboard/[id]/components/NextActionPanel.tsx
//
// Renders the single "next action" prompt above the fold on /dashboard/[id].
// Reads the precomputed `summary.nextAction` from /api/dashboard-summary; the
// resolution rules live in app/dashboard/[id]/lib/next-action.ts (PR2).
//
// Snooze: per-kind localStorage entry stores an ISO timestamp until which the
// panel renders nothing. Default snooze is 24h. While snoozed, a tiny "Show
// again" link replaces the panel and clears the snooze on click. Snooze state
// is keyed by `kind` so each personalization rule can be dismissed
// independently — escalations (e.g. join_crew → connect_wallet) are not
// suppressed by an unrelated snooze.
//
// Visual treatment is intentionally minimal: existing tokens + the shared
// `btn("accent")` primitive. PR6 (designer port-back) replaces these styles
// with the Lovable mocks.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §4–§6, PR3.

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { btn } from "../../../ui/shared-styles";
import type { NextAction, NextActionKind } from "../lib/next-action";

const FONT_DISPLAY =
    "var(--font-display), var(--font-sans), system-ui, sans-serif";
const SNOOZE_KEY_PREFIX = "dashboard-next-action-snooze-";
const DEFAULT_SNOOZE_MS = 24 * 60 * 60 * 1000; // 24h

export type NextActionPanelProps = {
    nextAction: NextAction;
    /** Override the default 24h snooze window. */
    snoozeDurationMs?: number;
};

function snoozeKey(kind: NextActionKind): string {
    return `${SNOOZE_KEY_PREFIX}${kind}`;
}

function readSnooze(kind: NextActionKind): number | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(snoozeKey(kind));
        if (!raw) return null;
        const t = Date.parse(raw);
        if (Number.isNaN(t)) return null;
        return t;
    } catch {
        return null;
    }
}

function writeSnooze(kind: NextActionKind, untilMs: number): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            snoozeKey(kind),
            new Date(untilMs).toISOString(),
        );
    } catch {
        // localStorage may be disabled (private mode, quota). Soft-fail.
    }
}

function clearSnooze(kind: NextActionKind): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(snoozeKey(kind));
    } catch {
        // soft-fail
    }
}

export function NextActionPanel({
    nextAction,
    snoozeDurationMs = DEFAULT_SNOOZE_MS,
}: NextActionPanelProps) {
    // Snoozed-until timestamp in epoch ms. `null` = no snooze. Initialized
    // from localStorage in effect (SSR-safe; first paint shows the panel,
    // then a follow-up render hides it if snoozed — acceptable for an
    // owner-only logged-in page).
    const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        setSnoozedUntil(readSnooze(nextAction.kind));
        setHydrated(true);
    }, [nextAction.kind]);

    const isSnoozed = snoozedUntil !== null && snoozedUntil > Date.now();

    // While snoozed, render a tiny "Show again" link so users can recover
    // without clearing localStorage by hand.
    if (hydrated && isSnoozed) {
        return (
            <div
                style={{
                    paddingTop: 10,
                    borderTop: "1px solid hsl(var(--rule) / 0.12)",
                    textAlign: "right",
                }}
            >
                <button
                    onClick={() => {
                        clearSnooze(nextAction.kind);
                        setSnoozedUntil(null);
                    }}
                    style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 12,
                        fontFamily: "inherit",
                        color: "hsl(var(--muted-foreground))",
                        textDecoration: "underline",
                        padding: 0,
                    }}
                >
                    Show next action again
                </button>
            </div>
        );
    }

    const { headline, body, primaryCta, secondary, kind } = nextAction;

    return (
        <div
            data-testid="next-action-panel"
            data-kind={kind}
            style={{
                paddingTop: 12,
                paddingBottom: 12,
                borderTop: "1px solid hsl(var(--rule) / 0.12)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
            }}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <h2
                    style={{
                        margin: 0,
                        fontSize: 22,
                        fontFamily: FONT_DISPLAY,
                        fontWeight: 800,
                        letterSpacing: "-0.01em",
                        color: "hsl(var(--foreground))",
                    }}
                >
                    {headline}
                </h2>
                {body && (
                    <p
                        style={{
                            margin: 0,
                            fontSize: 14,
                            color: "hsl(var(--muted-foreground))",
                            lineHeight: 1.4,
                        }}
                    >
                        {body}
                    </p>
                )}
            </div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                }}
            >
                <Link
                    href={primaryCta.href}
                    style={{
                        ...btn("accent"),
                        fontSize: 14,
                        padding: "8px 16px",
                    }}
                >
                    {primaryCta.label}
                </Link>
                {secondary && (
                    <Link
                        href={secondary.href}
                        style={{
                            fontSize: 13,
                            color: "hsl(var(--muted-foreground))",
                            textDecoration: "underline",
                        }}
                    >
                        {secondary.label}
                    </Link>
                )}
                <button
                    onClick={() => {
                        const until = Date.now() + snoozeDurationMs;
                        writeSnooze(kind, until);
                        setSnoozedUntil(until);
                    }}
                    style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 12,
                        fontFamily: "inherit",
                        color: "hsl(var(--muted-foreground))",
                        textDecoration: "underline",
                        padding: 0,
                        marginLeft: "auto",
                    }}
                    title="Hide for 24 hours"
                    aria-label="Snooze next action"
                >
                    Not now
                </button>
            </div>
        </div>
    );
}
