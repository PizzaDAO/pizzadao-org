// app/dashboard/[id]/components/LevelCard.tsx
//
// "Your level" card on /dashboard/[id]: current level and title, progress through this level's
// missions, and the next one or two missions to do. Reads `summary.levelCard` from
// /api/dashboard-summary, which is only present while the setting dashboard.levelCardEnabled is on
// (env DASHBOARD_LEVEL_CARD_ENABLED), so with the setting off this renders nothing. It adds no new
// requirements: the missions are exactly the ones /missions already lists.

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export interface LevelCardData {
    enabled: boolean;
    level: number;
    title: string | null;
    isMax: boolean;
    done: number;
    total: number;
    nextTitle: string | null;
    nextMissions: Array<{ id: number; title: string }>;
    awaitingReview: boolean;
}

export function LevelCard({ card }: { card?: LevelCardData | null }) {
    const t = useTranslations("dashboard.levelCard");
    if (!card || !card.enabled) return null;

    const pct = card.total > 0 ? Math.min(100, Math.round((card.done / card.total) * 100)) : 0;

    return (
        <section
            data-testid="level-card"
            className="my-5 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5"
            aria-label={t("overline")}
        >
            <p className="overline">{t("overline")}</p>
            <h2 className="font-display mt-1 text-2xl font-bold">
                {card.isMax ? t("max") : t("level", { level: card.level })}
                {card.title && !card.isMax ? <span className="text-foreground/65">{` · ${card.title}`}</span> : null}
            </h2>

            {card.isMax ? (
                <p className="mt-2 text-sm leading-relaxed text-foreground/80">{t("maxBody")}</p>
            ) : (
                <>
                    <div
                        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-foreground/10"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={card.total}
                        aria-valuenow={card.done}
                    >
                        <div className="h-full rounded-full bg-tomato" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-[13px] text-foreground/70">{t("progress", { done: card.done, total: card.total })}</p>

                    {card.nextMissions.length > 0 ? (
                        <div className="mt-3">
                            <p className="overline">{t("next")}</p>
                            <ul className="mt-1 grid gap-1 p-0" style={{ listStyle: "none" }}>
                                {card.nextMissions.map((m) => (
                                    <li key={m.id}>
                                        <Link href="/missions" className="text-sm font-semibold text-foreground underline-offset-4 hover:underline">
                                            {m.title}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : card.awaitingReview ? (
                        <p className="mt-3 text-sm text-foreground/80">{t("allSubmitted")}</p>
                    ) : null}

                    {card.nextTitle ? <p className="mt-3 text-[13px] text-foreground/65">{t("nextLevel", { title: card.nextTitle })}</p> : null}
                </>
            )}

            <div className="mt-4">
                <Link href="/missions" className="btn-pill min-h-11 border border-foreground/20 no-underline">
                    {t("viewAll")}
                </Link>
            </div>
        </section>
    );
}
