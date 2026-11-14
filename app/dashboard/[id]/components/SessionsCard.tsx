// app/dashboard/[id]/components/SessionsCard.tsx
//
// "Next session" on /dashboard/[id]: the next public session, a link to the public list and, for leads,
// a Schedule / Manage link. Reads /api/learn/next, which only returns a session while the setting
// education.dashboardCardEnabled is on; with it off (or while loading) this renders nothing.

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

interface NextSessionData {
    enabled: boolean;
    listing?: boolean;
    scheduleCrewId?: string | null;
    next?: { id: string; title: string; presenter: string | null; startsAt: string; timeZone: string } | null;
}

export function SessionsCard() {
    const t = useTranslations("dashboard.sessionsCard");
    const { data } = useQuery<NextSessionData>({
        queryKey: ["learn-next"],
        queryFn: async () => {
            const res = await fetch("/api/learn/next", { cache: "no-store" });
            if (!res.ok) throw new Error("failed");
            return res.json();
        },
        staleTime: 60_000,
    });
    if (!data?.enabled) return null;
    const when = data.next
        ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(data.next.startsAt))
        : null;
    return (
        <section data-testid="sessions-card" className="my-5 rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5" aria-label={t("overline")}>
            <p className="overline">{t("overline")}</p>
            {data.next ? (
                <>
                    <h2 className="font-display mt-1 text-2xl font-bold">{data.next.title}</h2>
                    <p className="mt-1 text-sm text-foreground/70">
                        {when}
                        {data.next.presenter ? ` · ${t("by", { presenter: data.next.presenter })}` : ""}
                    </p>
                </>
            ) : (
                <p className="mt-2 text-sm text-foreground/80">{t("none")}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-5 text-sm">
                {data.listing && (
                    <Link href="/learn" className="inline-block min-h-11 py-2 underline">
                        {t("viewAll")}
                    </Link>
                )}
                {data.scheduleCrewId && (
                    <>
                        <Link href={`/crew/${data.scheduleCrewId}/sessions/new`} className="inline-block min-h-11 py-2 underline">
                            {t("schedule")}
                        </Link>
                        <Link href={`/crew/${data.scheduleCrewId}/sessions`} className="inline-block min-h-11 py-2 underline">
                            {t("manage")}
                        </Link>
                    </>
                )}
            </div>
        </section>
    );
}
