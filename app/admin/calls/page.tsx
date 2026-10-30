// app/admin/calls/page.tsx
//
// Call recordings (calzone-30418): reviewer list. Dread Pizza Roberts only,
// the same check as L8 mission review. The API routes enforce it too.

import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { canReviewCalls } from "@/app/lib/calls/access";
import { listRecordingsPage, type ListRecordingsOpts, type SourceFilter } from "@/app/lib/calls/recordings";
import { bulkActionMax } from "@/app/lib/calls/bulk";
import { loadPostFilter } from "@/app/lib/calls/post-filters";
import AgendaPreview from "./AgendaPreview";
import { PostFilters } from "./PostFilters";
import { RecordingsTable } from "./RecordingsTable";

const SOURCES: SourceFilter[] = ["all", "discord", "imported"];
const STATUSES = ["RECORDED", "PROCESSING", "IN_REVIEW", "PUBLISHED", "REJECTED"] as const;
const CURSOR = /^[A-Za-z0-9_-]{8,40}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("adminCalls");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

export default async function AdminCallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const t = await getTranslations("adminCalls");
    const locale = await getLocale();
    const session = await getSession();
    const allowed = session?.discordId ? await canReviewCalls(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">{t("deniedTitle")}</h1>
                    <p className="text-foreground/60">{session ? t("denied") : t("loginPrompt")}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/calls" className="inline-block mt-4 underline">
                            {t("login")}
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const sp = await searchParams;
    const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const source = SOURCES.find((x) => x === one(sp.source)) ?? "all";
    const status = STATUSES.find((x) => x === one(sp.status));
    const cursorRaw = one(sp.cursor);
    const opts: ListRecordingsOpts = { source, status, cursor: cursorRaw && CURSOR.test(cursorRaw) ? cursorRaw : null };
    const [{ rows, nextCursor }, bulkMax] = await Promise.all([listRecordingsPage(opts), bulkActionMax()]);
    const href = (over: { source?: string; status?: string | null; cursor?: string | null }) => {
        const q = new URLSearchParams();
        const src = over.source ?? source;
        const st = over.status === undefined ? status : over.status;
        if (src !== "all") q.set("source", src);
        if (st) q.set("status", st);
        if (over.cursor) q.set("cursor", over.cursor);
        const qs = q.toString();
        return qs ? `/admin/calls?${qs}` : "/admin/calls";
    };
    const postFilter = await loadPostFilter().catch(() => null);
    const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-5xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{t("title")}</h1>
                    <p className="m-0 text-foreground/70">{t("description")}</p>
                </header>

                {postFilter ? (
                    <PostFilters
                        initial={postFilter}
                        labels={{
                            title: t("filtersTitle"),
                            description: t("filtersDescription"),
                            crewIds: t("filtersCrewIds"),
                            crewLabelTerms: t("filtersCrewLabelTerms"),
                            blockedTerms: t("filtersBlockedTerms"),
                            save: t("filtersSave"),
                            saving: t("filtersSaving"),
                            saved: t("filtersSaved"),
                            error: t("filtersError"),
                        }}
                    />
                ) : (
                    <p className="text-tomato">{t("filtersUnavailable")}</p>
                )}

                <AgendaPreview />

                <nav aria-label={t("filterSource")} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <span className="text-foreground/60">{t("filterSource")}:</span>
                    {SOURCES.map((x) => (
                        <Link key={x} href={href({ source: x, cursor: null })} aria-current={x === source ? "page" : undefined} className={x === source ? "font-bold underline" : "underline text-foreground/70"}>
                            {t(x === "all" ? "sourceAll" : x === "discord" ? "sourceDiscord" : "sourceImported")}
                        </Link>
                    ))}
                    <span className="text-foreground/60 ml-3">{t("filterStatus")}:</span>
                    <Link href={href({ status: null, cursor: null })} aria-current={!status ? "page" : undefined} className={!status ? "font-bold underline" : "underline text-foreground/70"}>
                        {t("statusAll")}
                    </Link>
                    {STATUSES.map((x) => (
                        <Link key={x} href={href({ status: x, cursor: null })} aria-current={x === status ? "page" : undefined} className={x === status ? "font-bold underline" : "underline text-foreground/70"}>
                            {t(`status.${x}`)}
                        </Link>
                    ))}
                </nav>

                {rows.length === 0 ? (
                    <p className="text-foreground/60">{t("empty")}</p>
                ) : (
                    <RecordingsTable
                        bulkMax={bulkMax}
                        rows={rows.map((r) => ({
                            id: r.id,
                            when: when.format(r.startedAt),
                            eventName: r.eventName,
                            partial: r.partial,
                            crewLabel: r.crewLabel,
                            minutes: Math.max(1, Math.round(r.durationSec / 60)),
                            speakers: r._count.speakers,
                            status: r.status,
                            imported: r.source !== "DISCORD",
                        }))}
                    />
                )}

                <div className="flex flex-wrap gap-5 text-sm">
                    {opts.cursor && (
                        <Link href={href({ cursor: null })} className="underline">
                            {t("newestCalls")}
                        </Link>
                    )}
                    {nextCursor && (
                        <Link href={href({ cursor: nextCursor })} className="underline">
                            {t("olderCalls")}
                        </Link>
                    )}
                </div>
            </div>
        </main>
    );
}
