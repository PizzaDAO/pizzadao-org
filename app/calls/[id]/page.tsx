// app/calls/[id]/page.tsx
//
// Public page for ONE published call (calzone-30418 phase 2): title, summary,
// chapters, action items and transcript. Audio is never public and nothing
// here references it. Unpublished, rejected and unknown ids are a 404.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { asSegments, getPublishedRecording } from "@/app/lib/calls/recordings";
import { formatClock } from "@/app/lib/calls/summarize";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { id } = await params;
    const rec = await getPublishedRecording(id);
    if (!rec) return { robots: { index: false, follow: false } };
    const title = rec.title ?? rec.eventName ?? "Call";
    const description = rec.summary?.replace(/\s+/g, " ").slice(0, 200);
    return { title, description, openGraph: { title, description, type: "article" } };
}

export default async function PublishedCallPage({ params }: Params) {
    const { id } = await params;
    const rec = await getPublishedRecording(id);
    if (!rec) notFound();

    const t = await getTranslations("callsPage.recording");
    const locale = await getLocale();
    const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(rec.startedAt);
    const names = new Map(rec.speakers.map((s) => [s.discordId, s.displayName ?? t("unknownSpeaker")]));
    const segments = asSegments(rec.transcript);
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
                </section>
            </article>
        </EditorialPage>
    );
}
