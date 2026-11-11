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
import { publishedQaForRecording } from "@/app/lib/calls/live-qa";
import AttendeeChips from "@/app/ui/calls/AttendeeChips";
import { loadCallAttendees } from "@/app/lib/calls/attendees";
import PersonLink from "@/app/ui/calls/PersonLink";
import { getSession } from "@/app/lib/session";
import { formatClock } from "@/app/lib/calls/summarize";
import { displaySpeakerName } from "@/app/lib/calls/speaker-labels";
import { sameActionPerson } from "@/app/lib/calls/recap";
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
    const attendees = await loadCallAttendees(rec, speakerText);
    const segments = showTranscript ? asSegments(rec.transcript) : [];
    const actionItems = (!showActionItems ? [] : Array.isArray(rec.actionItems) ? rec.actionItems : []) as Array<{ text?: string; owner?: string; suggestedBy?: string; done?: boolean }>;
    // Live Q&A and poll results of the call: gated like the action items (anonymous askers are never named).
    const qa = showActionItems ? await publishedQaForRecording(id) : null;
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

            {rec.crewId && (
                <Link href={`/crew/${encodeURIComponent(rec.crewId)}`} className="mb-6 inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">
                    {t("crewPage", { crew: rec.crewLabel ?? rec.crewId })}
                </Link>
            )}

            <AttendeeChips attendees={attendees} label={t("attended", { count: attendees.length })} showMore={(n) => t("attendedShowMore", { count: n })} />

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
                        <ul className={`m-0 grid gap-1 ${actionItems.some((a) => a.done) ? "list-none pl-0" : "pl-5"}`}>
                            {actionItems.map((item, i) => (
                                <li key={i} className={actionItems.some((a) => a.done) && !item.done ? "pl-5" : undefined}>
                                    {item.done ? <span role="img" aria-label={t("actionDone")}>{"\u2705"} </span> : null}
                                    {item.text}
                                    {item.owner && item.suggestedBy && sameActionPerson(item.owner, item.suggestedBy) ? (
                                        <span className="text-foreground/60"> {"\u2014"} {t("suggestedAndOwns", { name: item.owner })}</span>
                                    ) : (
                                        <>
                                            {item.owner ? <span className="text-foreground/60"> ({item.owner})</span> : null}
                                            {item.suggestedBy ? <span className="text-foreground/60"> {"\u2014"} {t("suggestedBy", { name: item.suggestedBy })}</span> : null}
                                        </>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {qa && qa.answered.length + qa.unanswered.length > 0 && (
                    <section className="grid gap-3">
                        <h2 className="font-display text-xl font-black m-0">{t("qaTitle")}</h2>
                        {([["qaAnswered", qa.answered], ["qaUnanswered", qa.unanswered]] as const).map(
                            ([label, list]) =>
                                list.length > 0 && (
                                    <div key={label} className="grid gap-1">
                                        <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-foreground/60">{t(label)}</h3>
                                        <ul className="m-0 grid list-none gap-2 p-0">
                                            {list.map((q) => (
                                                <li key={q.id} className="min-w-0 break-words">
                                                    {q.text}
                                                    <span className="block text-sm text-foreground/60">
                                                        {t("qaVotes", { count: q.votes })}
                                                        {q.author?.name && (
                                                            <>
                                                                {" \u00b7 "}
                                                                {t.rich("qaBy", { name: () => <PersonLink key="n" name={q.author!.name!} memberId={q.author!.memberId} /> })}
                                                            </>
                                                        )}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ),
                        )}
                    </section>
                )}

                {qa && qa.polls.length > 0 && (
                    <section className="grid gap-3">
                        <h2 className="font-display text-xl font-black m-0">{t("pollsTitle")}</h2>
                        {qa.polls.map((p) => (
                            <div key={p.id} className="min-w-0">
                                <p className="m-0 break-words font-semibold">{p.question}</p>
                                <ul className="m-0 mt-1 grid list-none gap-1 p-0">
                                    {p.options.map((o, i) => (
                                        <li key={i} className="flex min-w-0 justify-between gap-3">
                                            <span className="min-w-0 break-words">{o.text}</span>
                                            <span className="shrink-0 text-foreground/60">{o.percent}% {"\u00b7"} {o.votes}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="m-0 mt-1 text-sm text-foreground/60">{t("pollTotal", { count: p.total })}</p>
                            </div>
                        ))}
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
