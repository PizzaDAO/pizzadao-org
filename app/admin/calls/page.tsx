// app/admin/calls/page.tsx
//
// Call recordings (calzone-30418): reviewer list. Dread Pizza Roberts only,
// the same check as L8 mission review. The API routes enforce it too.

import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { canReviewCalls } from "@/app/lib/calls/access";
import { listRecordings } from "@/app/lib/calls/recordings";
import { loadPostFilter } from "@/app/lib/calls/post-filters";
import AgendaPreview from "./AgendaPreview";
import { PostFilters } from "./PostFilters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("adminCalls");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

export default async function AdminCallsPage() {
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

    const rows = await listRecordings();
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

                {rows.length === 0 ? (
                    <p className="text-foreground/60">{t("empty")}</p>
                ) : (
                    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-foreground/60">
                                    <th className="p-3">{t("colWhen")}</th>
                                    <th className="p-3">{t("colCall")}</th>
                                    <th className="p-3">{t("colCrew")}</th>
                                    <th className="p-3">{t("colDuration")}</th>
                                    <th className="p-3">{t("colSpeakers")}</th>
                                    <th className="p-3">{t("colStatus")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-t" style={{ borderColor: "hsl(var(--rule-warm) / 0.35)" }}>
                                        <td className="p-3 whitespace-nowrap">
                                            <Link href={`/admin/calls/${r.id}`} className="underline">
                                                {when.format(r.startedAt)}
                                            </Link>
                                        </td>
                                        <td className="p-3">
                                            {r.eventName ?? "-"}
                                            {r.partial && <span className="ml-2 text-tomato">{t("partial")}</span>}
                                        </td>
                                        <td className="p-3">{r.crewLabel ?? <span className="text-foreground/50">{t("noCrew")}</span>}</td>
                                        <td className="p-3 whitespace-nowrap">{t("minutes", { count: Math.max(1, Math.round(r.durationSec / 60)) })}</td>
                                        <td className="p-3">{r._count.speakers}</td>
                                        <td className="p-3">{t(`status.${r.status}`)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </main>
    );
}
