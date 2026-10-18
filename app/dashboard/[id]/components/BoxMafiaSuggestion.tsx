// app/dashboard/[id]/components/BoxMafiaSuggestion.tsx
//
// woodfired-65373 — small dismissible card suggesting a Rare Pizzas Box to
// members who definitely lack the Box Mafia Discord role. Status comes from
// /api/dashboard-summary (`boxMafia`); "unknown" never renders. "Not now"
// snoozes for 30 days via localStorage.

"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

export type BoxMafiaSummary = {
    status: "has_role" | "missing" | "unknown";
    purchaseUrl: string;
    dailyPep: number;
};

export const BOX_MAFIA_DISMISS_KEY = "pizzadao:box-mafia-suggestion:dismissedUntil";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function readDismissedUntil(): number | null {
    try {
        const raw = window.localStorage.getItem(BOX_MAFIA_DISMISS_KEY);
        if (!raw) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

function writeDismissedUntil(untilMs: number): void {
    try {
        window.localStorage.setItem(BOX_MAFIA_DISMISS_KEY, String(untilMs));
    } catch {
        // localStorage may be disabled; soft-fail.
    }
}

export function BoxMafiaSuggestion({ boxMafia }: { boxMafia?: BoxMafiaSummary | null }) {
    const t = useTranslations("dashboard.boxMafia");
    const [dismissed, setDismissed] = useState(false);

    // Read storage after mount to avoid a hydration mismatch.
    useEffect(() => {
        const until = readDismissedUntil();
        if (until !== null && until > Date.now()) setDismissed(true);
    }, []);

    if (!boxMafia || boxMafia.status !== "missing" || !boxMafia.purchaseUrl || dismissed) {
        return null;
    }

    return (
        <section
            data-testid="box-mafia-suggestion"
            className="my-5 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5"
            aria-label={t("ariaLabel")}
        >
            <p className="overline">{t("overline")}</p>
            <h2 className="font-display mt-1 text-2xl font-bold">{t("headline")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-foreground/80">
                {t("body", { amount: boxMafia.dailyPep })}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                    href={boxMafia.purchaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-pill min-h-11 bg-foreground text-background no-underline"
                >
                    {t("cta")}
                    <ArrowUpRight className="h-4 w-4" />
                </a>
                <button
                    type="button"
                    onClick={() => {
                        writeDismissedUntil(Date.now() + SNOOZE_MS);
                        setDismissed(true);
                    }}
                    className="ui min-h-11 px-2 text-[13px] uppercase tracking-[0.08em] text-foreground/70 underline underline-offset-4 transition-colors hover:text-tomato-readable"
                >
                    {t("notNow")}
                </button>
            </div>
        </section>
    );
}
