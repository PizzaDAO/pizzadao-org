// app/calls/[id]/page.tsx
//
// Members-only page for ONE published call: title, summary, chapters and
// action items for any signed-in member; the full transcript only for members
// at the transcript level or above (and Dread Pizza Roberts). Signed-out
// visitors are sent to login before anything is looked up. Audio is never
// published and nothing here references it. Unpublished, rejected and unknown
// ids are a 404. Metadata is generic and noindex so nothing leaks to crawlers.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { asSegments, getPublishedRecording } from "@/app/lib/calls/recordings";
import { CALL_TRANSCRIPT_MIN_LEVEL, canViewCallTranscript } from "@/app/lib/calls/transcript-access";
import { getSession } from "@/app/lib/session";
import { formatClock } from "@/app/lib/calls/summarize";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("callsPage.recording");
    return { title: t("overline"), robots: { index: false, follow: false } };
}

export default async function PublishedCallPage({ params }: Params) {
    const { id } = await params;
    // Auth first, so signed-out visitors can't tell existing ids from missing ones.
    const session = await getSession().catch(() => null);
    if (!session?.discordId) redirect(`/login?returnTo=${encodeURIComponent(`/calls/${id}`)}`);
    const rec = await getPublishedRecording(id);
    if (!rec) notFound();
    const showTranscript = await canViewCallTranscript(session.discordId).catch(() => false);

    const t = await getTranslations("callsPage.recording");
    const locale = await getLocale();
    const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(rec.startedAt);
    const names = new Map(rec.speakers.map((s) => [s.discordId, s.displayName ?? t("unknownSpeaker")]));
    const segments = showTranscript ? asSegments(rec.transcript) : [];
    const actionItems = (Array.isArray(rec.actionItems) ? rec.actionItems : []) as Array<{ text?: string; owner?: string }>;
    const chapters = (Array.isArray(rec.chapters) ? rec.chapters : []) as Array<{ startMs?: number; title?: string }>;

    return (
        <EditorialPage width="max-w-[820px]">
            <Link href="/calls/recordings" className="mb-6 inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">
                {t("back")}
            </Link>
            <EditorialMasthead
                overline={rec.crewLabel ?? t("overline")}
                title={rec.title ?? rec.eventName ?? t("untitled")}
                dek={`${when} · ${t("minutes", { count: Math.max(1, Math.round(rec.durationSec / 60)) })}`}
            />

            <article className="grid gap-8">
                {rec.summary && (
                    <section className={`${paperCard} p-5 grid gap-3`}>
                        <h2 className="font-display text-xl font-black m-0">{t("summary")}</h2>
                        <div className="whitespace-pre-wrap leading-relaxed">{rec.summary}</div>
                    </section>
                )}

                {actionItems.length > 0 && (
                    <section className="grid gap-2">
                        <h2 className="font-display text-xl font-black m-0">{t("actionItems")}</h2>
                        <ul className="m-0 pl-5 grid gap-1">
                            {actionItems.map((item, i) => (
                                <li key={i}>
                                    {item.text}
                                    {item.owner ? <span className="text-foreground/60"> ({item.owner})</span> : null}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {chapters.length > 0 && (
                    <section className="grid gap-2">
                        <h2 className="font-display text-xl font-black m-0">{t("chapters")}</h2>
                        <ul className="m-0 pl-5 grid gap-1">
                            {chapters.map((c, i) => (
                                <li key={i}>
                                    <span className="tabular-nums text-foreground/60">{formatClock(c.startMs ?? 0)}</span> {c.title}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className="grid gap-3">
                    <h2 className="font-display text-xl font-black m-0">{t("transcript")}</h2>
                    {!showTranscript ? (
                        <p className="m-0 text-sm text-foreground/60">{t("transcriptRestricted", { level: CALL_TRANSCRIPT_MIN_LEVEL })}</p>
                    ) : (<>
                    <p className="m-0 text-sm text-foreground/60">{t("transcriptNote")}</p>
                    <ol className="m-0 p-0 list-none grid gap-3">
                        {segments.map((seg, i) => {
                            const isChatLine = seg.kind === "chat";
                            return (
                                <li key={i} className={`grid gap-0.5 ${isChatLine ? "text-foreground/70" : ""}`}>
                                    <span className="text-sm">
                                        {isChatLine && (
                                            <span role="img" aria-label={t("chatLine")} title={t("chatLine")}>
                                                💬{" "}
                                            </span>
                                        )}
                                        <strong>{names.get(seg.discordId) ?? seg.name ?? t("unknownSpeaker")}</strong>{" "}
                                        <span className="tabular-nums text-foreground/60">{formatClock(seg.startMs)}</span>
                                    </span>
                                    <span className={isChatLine ? "italic whitespace-pre-wrap break-words" : undefined}>{seg.text}</span>
                                </li>
                            );
                        })}
                    </ol>
                    </>)}
                </section>
            </article>
        </EditorialPage>
    );
}
