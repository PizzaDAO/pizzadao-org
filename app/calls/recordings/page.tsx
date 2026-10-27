// app/calls/recordings/page.tsx
//
// Members-only list of published calls. Signed-out visitors are sent to login
// before anything is loaded; the page is noindex. Full transcripts are gated
// separately on each call's page (level 6+ or Dread Pizza Roberts). Audio is
// never published.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { listPublishedRecordings } from "@/app/lib/calls/recordings";
import { getSession } from "@/app/lib/session";
import { EditorialMasthead, EditorialPage, EmptyState, paperCard } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("callsPage.recording");
    return { title: t("listTitle"), description: t("listDescription"), robots: { index: false, follow: false } };
}

export default async function PublishedCallsPage() {
    const session = await getSession().catch(() => null);
    if (!session?.discordId) redirect(`/login?returnTo=${encodeURIComponent("/calls/recordings")}`);
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
