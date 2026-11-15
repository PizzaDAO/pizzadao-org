// app/dashboard/[id]/components/LaneCard.tsx
//
// "Your lane" card on /dashboard/[id] (plans/lane-cards-mission-onboarding.md): the pinned lane with
// its progress and a Continue link, or a prompt to pick one. Reads `summary.lane` from
// /api/dashboard-summary, which says `enabled: false` while the setting onboarding.laneCardsEnabled
// is off, so with the setting off this renders nothing.

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export interface LaneCardData {
    enabled: boolean;
    pinned: { slug: string; tag: string; title: string; done: number; total: number; href: string } | null;
}

export function LaneCard({ lane }: { lane?: LaneCardData | null }) {
    const t = useTranslations("laneCard");
    if (!lane || !lane.enabled) return null;
    const pinned = lane.pinned;
    const pct = pinned && pinned.total > 0 ? Math.min(100, Math.round((pinned.done / pinned.total) * 100)) : 0;

    return (
        <section data-testid="lane-card" className="my-5 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5" aria-label={t("overline")}>
            <p className="overline">{t("overline")}</p>
            {pinned ? (
                <>
                    <h2 className="font-display mt-1 text-2xl font-bold">
                        {pinned.tag}
                        <span className="text-foreground/65">{` · ${pinned.title}`}</span>
                    </h2>
                    <div
                        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-foreground/10"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={pinned.total}
                        aria-valuenow={pinned.done}
                        aria-label={t("progress", { done: pinned.done, total: pinned.total })}
                    >
                        <div className="h-full bg-tomato" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-sm text-foreground/80">{t("progress", { done: pinned.done, total: pinned.total })}</p>
                    <Link href={pinned.href} className="btn-pill mt-3 min-h-11 bg-foreground text-background no-underline">
                        {t("continue")}
                    </Link>
                </>
            ) : (
                <>
                    <h2 className="font-display mt-1 text-2xl font-bold">{t("pickTitle")}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/80">{t("pickBody")}</p>
                    <Link href="/community#ways-in" className="btn-pill mt-3 min-h-11 border border-foreground/20 no-underline">
                        {t("pickCta")}
                    </Link>
                </>
            )}
        </section>
    );
}
