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
// tomato-30368 — Editorial restyle. Now an ink-bottom CTA dock: dark slab,
// cream type, butter overline, paper grain, pill CTAs. The headline still
// renders as <h2>, the primary CTA still uses primaryCta.label / .href, the
// secondary link is unchanged, and the snooze button's aria-label still
// matches /Snooze next action/i for tests.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §4–§6, PR3.

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { NextAction, NextActionKind } from "../lib/next-action";

type Translator = ReturnType<typeof useTranslations<"dashboard">>;

/**
 * The server (/api/dashboard-summary → resolveNextAction) returns English
 * copy. Re-render it in the viewer's locale from the `dashboard` catalog,
 * keyed by `kind`. Data-derived text (mission titles, notification titles)
 * and anything we can't parameterize (no `level` on older payloads) falls
 * back to the server string.
 */
export function localizeNextAction(a: NextAction, t: Translator): NextAction {
    const level = a.level;
    const hasLevel = typeof level === "number";
    switch (a.kind) {
        case "join_crew":
            return {
                ...a,
                headline: t("steps.join_crew.headline"),
                body: t("steps.join_crew.body"),
                primaryCta: { ...a.primaryCta, label: t("steps.join_crew.cta") },
            };
        case "connect_wallet":
        case "connect_x":
            return {
                ...a,
                headline: t(`steps.${a.kind}.headline`),
                primaryCta: { ...a.primaryCta, label: t(`steps.${a.kind}.cta`) },
            };
        case "submit_mission":
            // body = the mission's title (data) — left as-is.
            return {
                ...a,
                headline: t("nextAction.submit_mission.headline"),
                primaryCta: hasLevel
                    ? { ...a.primaryCta, label: t("nextAction.submit_mission.cta", { level }) }
                    : a.primaryCta,
            };
        case "awaiting_review":
            return {
                ...a,
                headline: t("nextAction.awaiting_review.headline"),
                ...(hasLevel
                    ? {
                          body: t("nextAction.awaiting_review.body", { level }),
                          primaryCta: {
                              ...a.primaryCta,
                              label: t("nextAction.awaiting_review.cta", { level }),
                          },
                      }
                    : {}),
            };
        case "get_vouches":
            return {
                ...a,
                headline: t("nextAction.get_vouches.headline"),
                primaryCta: { ...a.primaryCta, label: t("nextAction.get_vouches.cta") },
            };
        case "review_notification":
            // headline = the notification's own title (data) — left as-is.
            return {
                ...a,
                primaryCta: { ...a.primaryCta, label: t("nextAction.review_notification.cta") },
            };
        case "power_user_review":
            return {
                ...a,
                headline: t("nextAction.power_user_review.headline"),
                body: t("nextAction.power_user_review.body"),
                primaryCta: { ...a.primaryCta, label: t("nextAction.power_user_review.cta") },
            };
        case "power_user_discover":
            return {
                ...a,
                headline: t("nextAction.power_user_discover.headline"),
                primaryCta: { ...a.primaryCta, label: t("nextAction.power_user_discover.cta") },
            };
        default:
            return a;
    }
}

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
    const t = useTranslations("dashboard");

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
                className="rule-warm"
                style={{
                    paddingTop: 12,
                    textAlign: "right",
                }}
            >
                <button
                    onClick={() => {
                        clearSnooze(nextAction.kind);
                        setSnoozedUntil(null);
                    }}
                    className="ui text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
                    style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        textDecoration: "underline",
                        textUnderlineOffset: 3,
                        padding: 0,
                    }}
                >
                    {t("nextAction.showAgain")}
                </button>
            </div>
        );
    }

    const { headline, body, primaryCta, secondary, kind } = localizeNextAction(nextAction, t);

    return (
        <section
            data-testid="next-action-panel"
            data-kind={kind}
            className="fade-up relative my-2 overflow-hidden rounded-[28px]"
            style={{
                background: "hsl(var(--ink) / 0.96)",
                color: "hsl(var(--cream))",
                border: "1px solid hsl(var(--cream) / 0.10)",
                boxShadow:
                    "0 28px 56px -28px hsl(0 93% 60% / 0.30), var(--shadow-lifted)",
            }}
        >
            {/* Dark-paper grain */}
            <span
                aria-hidden
                className="paper-soft-dark pointer-events-none absolute inset-0 rounded-[28px]"
            />
            {/* Radial spotlight */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-80"
                style={{
                    background:
                        "radial-gradient(60% 80% at 20% 0%, hsl(46 100% 62% / 0.18), transparent 70%), radial-gradient(60% 80% at 100% 100%, hsl(0 93% 60% / 0.16), transparent 70%)",
                }}
            />

            <div className="relative grid gap-5 p-6 md:p-8">
                <p
                    className="overline"
                    style={{ color: "hsl(var(--butter))" }}
                >
                    {t("nextAction.overline")}
                </p>

                <div className="grid gap-3">
                    <h2
                        className="font-[family-name:var(--font-display)] m-0 font-black tracking-[-0.015em]"
                        style={{
                            fontSize: "clamp(1.5rem, 3.2vw, 2.1rem)",
                            lineHeight: 1,
                            textWrap: "balance",
                            color: "hsl(var(--cream))",
                        }}
                    >
                        {headline}
                    </h2>
                    {body && (
                        <p
                            className="m-0 max-w-prose"
                            style={{
                                fontSize: 15,
                                lineHeight: 1.5,
                                color: "hsl(var(--cream) / 0.78)",
                            }}
                        >
                            {body}
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <Link
                        href={primaryCta.href}
                        className="btn-pill group"
                        style={{
                            background: "hsl(var(--tomato))",
                            color: "hsl(var(--cream))",
                            boxShadow: "var(--shadow-soft)",
                            textDecoration: "none",
                        }}
                    >
                        {primaryCta.label}
                        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </Link>
                    {secondary && (
                        <Link
                            href={secondary.href}
                            className="ui inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.22em] transition-colors"
                            style={{
                                color: "hsl(var(--cream) / 0.75)",
                                textDecoration: "underline",
                                textUnderlineOffset: 3,
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
                        className="ui text-[11px] uppercase tracking-[0.22em] transition-colors hover:text-tomato"
                        style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "hsl(var(--cream) / 0.55)",
                            textDecoration: "underline",
                            textUnderlineOffset: 3,
                            padding: 0,
                            marginLeft: "auto",
                        }}
                        title={t("nextAction.snoozeTitle")}
                        aria-label={t("nextAction.snoozeAriaLabel")}
                    >
                        {t("nextAction.notNow")}
                    </button>
                </div>
            </div>
        </section>
    );
}
