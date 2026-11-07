// app/calls/[id]/page.tsx
//
// Members-only page for ONE published call: title, date and length for any
// signed-in member; the summary, action items, chapters and full transcript
// each need their own member level (admin settings; Dread Pizza Roberts sees all). Signed-out
// visitors are sent to login before anything is looked up. Audio is never
// published and nothing here references it. Unpublished, rejected and unknown
// ids are a 404. Metadata is generic and noindex so nothing leaks to crawlers.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { asSegments, getPublishedRecording } from "@/app/lib/calls/recordings";
import { callSectionAccess } from "@/app/lib/calls/transcript-access";
import { getSession } from "@/app/lib/session";
import { formatClock } from "@/app/lib/calls/summarize";
import { displaySpeakerName } from "@/app/lib/calls/speaker-labels";
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
    // One level lookup (and at most one role lookup) decides every gated section; failures hide them.
    const access = await callSectionAccess(session.discordId).catch(() => null);
    const showTranscript = access?.transcript.visible ?? false;
    const showSummary = access?.summary.visible ?? false;
    const showActionItems = access?.actionItems.visible ?? false;
    const showChapters = access?.chapters.visible ?? false;
    const minLevel = access?.transcript.minLevel ?? 10;

    const t = await getTranslations("callsPage.recording");
    const locale = await getLocale();
    const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(rec.startedAt);
    // Unlabelled speakers of an imported call show as "Speaker N"; the source link and linked member ids are never public.
    const speakerText = { speakerN: (n: number) => t("speakerN", { n }), fallback: t("unknownSpeaker") };
    const names = new Map(rec.speakers.map((s) => [s.discordId, displaySpeakerName(s.discordId, s.displayName, speakerText)]));
    const segments = showTranscript ? asSegments(rec.transcript) : [];
    const actionItems = (!showActionItems ? [] : Array.isArray(rec.actionItems) ? rec.actionItems : []) as Array<{ text?: string; owner?: string }>;
    const chapters = (!showChapters ? [] : Array.isArray(rec.chapters) ? rec.chapters : []) as Array<{ startMs?: number; title?: string }>;

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
                {rec.source !== "DISCORD" && <p className="m-0 text-sm text-foreground/60">{t("importedNote")}</p>}

                {!showSummary ? (
                    <section className={`${paperCard} p-5 grid gap-3`}>
                        <h2 className="font-display text-xl font-black m-0">{t("summary")}</h2>
                        <p className="m-0 text-sm text-foreground/60">{t("summaryRestricted", { level: access?.summary.minLevel ?? 10 })}</p>
                    </section>
                ) : rec.summary && (
                    <section className={`${paperCard} p-5 grid gap-3`}>
                        <h2 className="font-display text-xl font-black m-0">{t("summary")}</h2>
                        <div className="whitespace-pre-wrap leading-relaxed">{rec.summary}</div>
                    </section>
                )}

                {!showActionItems && (
                    <section className="grid gap-2">
                        <h2 className="font-display text-xl font-black m-0">{t("actionItems")}</h2>
                        <p className="m-0 text-sm text-foreground/60">{t("actionItemsRestricted", { level: access?.actionItems.minLevel ?? 10 })}</p>
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

                {!showChapters && (
                    <section className="grid gap-2">
                        <h2 className="font-display text-xl font-black m-0">{t("chapters")}</h2>
                        <p className="m-0 text-sm text-foreground/60">{t("chaptersRestricted", { level: access?.chapters.minLevel ?? 10 })}</p>
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
                        <p className="m-0 text-sm text-foreground/60">{t("transcriptRestricted", { level: minLevel })}</p>
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
                                        <strong>{names.get(seg.discordId) ?? seg.name ?? displaySpeakerName(seg.discordId, null, speakerText)}</strong>{" "}
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
