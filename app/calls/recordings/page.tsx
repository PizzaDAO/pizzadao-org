// app/calls/recordings/page.tsx
//
// Public list of published calls (calzone-30418 phase 2): summaries and
// transcripts only. Audio is never public.

import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listPublishedRecordings } from "@/app/lib/calls/recordings";
import { EditorialMasthead, EditorialPage, EmptyState, paperCard } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("callsPage.recording");
    return { title: t("listTitle"), description: t("listDescription") };
}

export default async function PublishedCallsPage() {
    const t = await getTranslations("callsPage.recording");
    const locale = await getLocale();
    const rows = await listPublishedRecordings();
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

    return (
        <EditorialPage width="max-w-[900px]">
            <EditorialMasthead overline={t("overline")} title={t("listTitle")} dek={t("listDescription")} />
            <Link href="/calls" className="mb-6 inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">
                {t("toAttendance")}
            </Link>

            {rows.length === 0 ? (
                <EmptyState title={t("empty")} />
            ) : (
                <ol className="m-0 p-0 list-none flex flex-col gap-3">
                    {rows.map((r) => (
                        <li key={r.id} className={`${paperCard} p-4`}>
                            <Link href={`/calls/${r.id}`} className="no-underline text-foreground grid gap-1">
                                <span className="overline text-tomato-readable">
                                    {r.crewLabel ?? t("overline")} · {date.format(r.startedAt)}
                                </span>
                                <span className="font-display text-lg font-black">{r.title ?? r.eventName ?? t("untitled")}</span>
                                {r.summary && <span className="text-sm text-foreground/70 line-clamp-2">{r.summary.replace(/\s+/g, " ")}</span>}
                            </Link>
                        </li>
                    ))}
                </ol>
            )}
        </EditorialPage>
    );
}
