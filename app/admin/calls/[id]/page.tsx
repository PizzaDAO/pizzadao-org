// app/admin/calls/[id]/page.tsx
//
// One recording (calzone-30418): reviewer-only audio player, speakers, and the
// reserved transcript/summary area. Dread Pizza Roberts only.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { canReviewCalls } from "@/app/lib/calls/access";
import { asSegments, getRecording } from "@/app/lib/calls/recordings";
import { loadPostFilter } from "@/app/lib/calls/post-filters";
import { buildRecapText, recapCrewExcluded, recapFilteredCount, recapPostingEnabled, redactionsNewerThanSummary, resolveRecapChannel } from "@/app/lib/calls/recap";
import { formatClock } from "@/app/lib/calls/summarize";
import { CallAudioPlayer } from "../CallAudioPlayer";
import { RemoveRecording } from "../RemoveRecording";
import { ReviewActions } from "../ReviewActions";
import { RedactSpeaker } from "../RedactSpeaker";
import { RetryTranscription } from "../RetryTranscription";
import { DraftFollowUps } from "../DraftFollowUps";
import { prisma } from "@/app/lib/db";
import { PERMANENT_TRANSCRIBE_ERRORS, PROGRESS } from "@/app/lib/calls/transcribe";
import { HideLine } from "../HideLine";
import { segmentKey } from "@/app/lib/calls/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminCallDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
                </div>
            </main>
        );
    }

    const { id } = await params;
    const rec = await getRecording(id);
    if (!rec) notFound();

    const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" });
    const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    const segments = asSegments(rec.transcript);
    const redacted = new Set(rec.redactedSpeakerIds);
    const hiddenLines = new Set(rec.redactedSegmentIds);
    const names = new Map(rec.speakers.map((sp) => [sp.discordId, sp.displayName ?? sp.discordId]));
    const actionItems = (Array.isArray(rec.actionItems) ? rec.actionItems : []) as Array<{ text?: string; owner?: string }>;
    const chapters = (Array.isArray(rec.chapters) ? rec.chapters : []) as Array<{ startMs?: number; title?: string }>;
    // Preview of the Discord recap that publishing triggers (text from the saved title/summary/action items).
    const postFilter = await loadPostFilter().catch(() => null);
    const recapText =
        postFilter && (rec.status === "IN_REVIEW" || rec.status === "PUBLISHED") && rec.summary?.trim()
            ? buildRecapText({ id: rec.id, title: rec.title, eventName: rec.eventName, crewLabel: rec.crewLabel, summary: rec.summary, actionItems: rec.actionItems, chapters: rec.chapters }, undefined, postFilter)
            : null;
    const recapChannel = recapText ? await resolveRecapChannel(rec.crewId).catch(() => null) : null;
    const recapEnabled = await recapPostingEnabled();
    const recapExcluded = postFilter ? recapCrewExcluded(rec, postFilter) : false;
    const recapOmitted = postFilter ? recapFilteredCount(rec, postFilter) : 0;
    const recapStale = redactionsNewerThanSummary(rec);
    const transcribeGaveUp = !rec.transcribedAt && rec.transcribeAttempts >= 3 && !PERMANENT_TRANSCRIBE_ERRORS.includes(rec.transcribeError ?? "");
    // A run that stopped mid-track after a failed chunk leaves the (sanitized) error here; the next run resumes.
    const progressError =
        !rec.transcribedAt && rec.transcribeError === PROGRESS
            ? ((rec.transcribeStats as { _progress?: { lastError?: unknown } } | null)?._progress?.lastError as string | undefined) ?? null
            : null;
    const followUpCount = await prisma.followUp.count({ where: { recordingId: rec.id } }).catch(() => 0);
    const canDraftFollowUps = (rec.status === "IN_REVIEW" || rec.status === "PUBLISHED") && !!rec.summary?.trim();
    const hasAudio =!!rec.mixKey || rec.speakers.some((s) => s.trackKey);

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-3xl grid gap-6">
                <Link href="/admin/calls" className="underline text-sm">
                    {t("back")}
                </Link>

                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">
                        {rec.crewLabel ?? t("noCrew")} · {t(`status.${rec.status}`)}
                        {rec.partial ? ` · ${t("partial")}` : ""}
                    </p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{rec.title ?? rec.eventName ?? t("title")}</h1>
                    <p className="m-0 text-foreground/70">
                        {when.format(rec.startedAt)} · {t("minutes", { count: Math.max(1, Math.round(rec.durationSec / 60)) })}
                        {rec.endReason ? ` · ${t("endReason", { reason: rec.endReason })}` : ""}
                    </p>
                </header>

                <section className="grid gap-3">
                    <h2 className="text-xl font-bold m-0">{t("audioHeading")}</h2>
                    {hasAudio ? (
                        <CallAudioPlayer
                            recordingId={rec.id}
                            labels={{
                                load: t("loadAudio"),
                                loading: t("loadingAudio"),
                                mix: t("mix"),
                                tracks: t("tracks"),
                                expires: t("audioExpires", { minutes: 15 }),
                                gone: t("audioGone"),
                                error: t("audioError"),
                            }}
                        />
                    ) : (
                        <p className="text-foreground/60 m-0">{t("noAudio")}</p>
                    )}
                </section>

                {rec.summaryError && !rec.summary && (
                    <p className="m-0 text-tomato">{t("summaryFailed", { count: rec.summaryAttempts, error: rec.summaryError })}</p>
                )}

                {progressError && <p className="m-0 text-foreground/70">{t("transcribeProgressError", { error: progressError })}</p>}

                {transcribeGaveUp && (
                    <section className="grid gap-2">
                        <p className="m-0 text-tomato">{t("transcribeFailed", { count: rec.transcribeAttempts, error: rec.transcribeError ?? "" })}</p>
                        <RetryTranscription recordingId={rec.id} labels={{ retry: t("transcribeRetry"), working: t("working"), error: t("reviewError") }} />
                    </section>
                )}

                {canDraftFollowUps && (
                    <section className="grid gap-2">
                        <h2 className="text-xl font-bold m-0">
                            {t("followUpsHeading")}
                            {followUpCount > 0 ? ` (${followUpCount})` : ""}
                        </h2>
                        <p className="m-0 text-foreground/70 text-sm">{t("followUpsHelp")}</p>
                        <div className="flex flex-wrap items-center gap-4">
                            <DraftFollowUps recordingId={rec.id} />
                            <Link href="/admin/followups" className="underline text-sm">
                                {t("followUpsLink")}
                            </Link>
                        </div>
                    </section>
                )}

                <section className="grid gap-3">
                    <h2 className="text-xl font-bold m-0">{t("speakersHeading")}</h2>
                    {rec.speakers.length === 0 ? (
                        <p className="text-foreground/60 m-0">{t("noSpeakers")}</p>
                    ) : (
                        <ul className="m-0 pl-5 grid gap-1">
                            {rec.speakers.map((s) => {
                                const lines = segments.filter((seg) => seg.discordId === s.discordId).length;
                                const speechLines = segments.filter((seg) => seg.discordId === s.discordId && seg.kind !== "chat").length;
                                const missing = rec.status !== "PROCESSING" && s.talkTimeSec >= 10 && speechLines === 0;
                                return (
                                    <li key={s.id}>
                                        {s.displayName ?? s.discordId}{" "}
                                        <span className="text-foreground/60">
                                            ({t("talkTime", { time: clock(s.talkTimeSec) })}
                                            {segments.length > 0 ? `, ${t("lines", { count: lines })}` : ""})
                                        </span>
                                        {redacted.has(s.discordId) && <span className="text-tomato"> {t("redactedBadge")}</span>}
                                        {missing && <span className="text-tomato"> {t("noLinesWarning")}</span>}
                                        {(lines > 0 || redacted.has(s.discordId)) && rec.status !== "REJECTED" && rec.status !== "PROCESSING" && (
                                            <>
                                                {" "}
                                                <RedactSpeaker
                                                    recordingId={rec.id}
                                                    discordId={s.discordId}
                                                    redacted={redacted.has(s.discordId)}
                                                    labels={{ redact: t("redactLines"), restore: t("restoreLines"), confirm: t("redactConfirm"), unsaved: t("unsavedWarning"), working: t("working"), error: t("reviewError") }}
                                                />
                                            </>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                <section className="grid gap-2">
                    {rec.status === "REJECTED" ? (
                        <p className="text-foreground/60 m-0">{t("removedNote")}</p>
                    ) : (
                        <RemoveRecording
                            recordingId={rec.id}
                            labels={{
                                remove: t("remove"),
                                confirm: t("removeConfirm"),
                                confirmYes: t("removeYes"),
                                cancel: t("cancel"),
                                working: t("removing"),
                                error: t("removeError"),
                            }}
                        />
                    )}
                </section>

                {rec.status !== "REJECTED" && (
                    <section className="grid gap-3">
                        <h2 className="text-xl font-bold m-0">{t("reviewHeading")}</h2>
                        {rec.status === "PROCESSING" ? (
                            <p className="text-foreground/60 m-0">{t("processingNote")}</p>
                        ) : segments.length === 0 ? (
                            <p className="text-foreground/60 m-0">{t("transcriptPending")}</p>
                        ) : (
                            <ReviewActions
                                key={rec.updatedAt.toISOString()}
                                recordingId={rec.id}
                                status={rec.status}
                                initialTitle={rec.title ?? ""}
                                initialSummary={rec.summary ?? ""}
                                initialActionItems={actionItems.filter((i): i is { text: string; owner?: string } => !!i.text)}
                                initialChapters={chapters.filter((c): c is { startMs: number; title: string } => !!c.title && typeof c.startMs === "number")}
                                labels={{
                                    title: t("fieldTitle"),
                                    actionItems: t("actionItemsHeading"),
                                    actionItemsHint: t("actionItemsHint"),
                                    tooManyItems: t("tooManyItems"),
                                    tooManyChapters: t("tooManyChapters"),
                                    badChapter: t("badChapter"),
                                    chapters: t("chaptersHeading"),
                                    chaptersHint: t("chaptersHint"),
                                    summary: t("fieldSummary"),
                                    save: t("save"),
                                    saving: t("saving"),
                                    saved: t("saved"),
                                    regenerate: t("regenerate"),
                                    regenerateConfirm: t("regenerateConfirm"),
                                    regenerating: t("regenerating"),
                                    publish: t("publish"),
                                    unpublish: t("unpublish"),
                                    publishNote: t("publishNote"),
                                    publishNeedsContent: t("publishNeedsContent"),
                                    working: t("working"),
                                    error: t("reviewError"),
                                }}
                            />
                        )}
                        {rec.status === "PUBLISHED" && (
                            <Link href={`/calls/${rec.id}`} className="underline text-sm">
                                {t("viewPublic")}
                            </Link>
                        )}
                    </section>
                )}

                {recapText && (
                    <section className="grid gap-2">
                        <h2 className="text-xl font-bold m-0">{t("recapHeading")}</h2>
                        <p className="m-0 text-sm text-foreground/60">{t("recapNote")}</p>
                        <p className="m-0 text-sm">
                            {recapChannel ? t("recapChannel", { channel: recapChannel.label }) : t("recapNoChannel")}
                            {!recapEnabled ? ` ${t("recapDisabled")}` : ""}
                            {rec.recapPostedAt ? ` ${t("recapPosted")}` : ""}
                        </p>
                        {recapExcluded && <p className="m-0 text-sm text-tomato">{t("recapExcluded")}</p>}
                        {recapOmitted > 0 && <p className="m-0 text-sm text-tomato">{t("recapOmitted", { count: recapOmitted })}</p>}
                        {recapStale && <p className="m-0 text-sm text-tomato">{t("recapStale")}</p>}
                        {rec.recapError && <p className="m-0 text-sm text-tomato">{t("recapError", { error: rec.recapError })}</p>}
                        <pre className="m-0 whitespace-pre-wrap break-words rounded-xl border p-3 bg-card text-sm" style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}>
                            {recapText}
                        </pre>
                    </section>
                )}

                {actionItems.length > 0 && (
                    <section className="grid gap-2">
                        <h2 className="text-xl font-bold m-0">{t("actionItemsHeading")}</h2>
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
                        <h2 className="text-xl font-bold m-0">{t("chaptersHeading")}</h2>
                        <ul className="m-0 pl-5 grid gap-1">
                            {chapters.map((c, i) => (
                                <li key={i}>
                                    <span className="tabular-nums text-foreground/60">{formatClock(c.startMs ?? 0)}</span> {c.title}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className="grid gap-2">
                    <h2 className="text-xl font-bold m-0">{t("transcriptHeading")}</h2>
                    {segments.length === 0 ? (
                        <p className="text-foreground/60 m-0">{t("transcriptPending")}</p>
                    ) : (
                        <ol className="m-0 p-0 list-none grid gap-2">
                            {segments.map((seg, i) => {
                                const key = segmentKey(seg);
                                const hidden = redacted.has(seg.discordId) || hiddenLines.has(key);
                                return (
                                    <li key={i} className={hidden ? "opacity-50" : seg.kind === "chat" ? "text-foreground/70" : undefined}>
                                        <span className="tabular-nums text-foreground/60 text-sm">{formatClock(seg.startMs)}</span>{" "}
                                        {seg.kind === "chat" && (
                                            <span role="img" aria-label={t("chatLine")} title={t("chatLine")}>
                                                💬{" "}
                                            </span>
                                        )}
                                        <strong>{names.get(seg.discordId) ?? seg.name ?? seg.discordId}</strong>:{" "}
                                        {hidden ? (
                                            <em className="text-foreground/60">{t("hiddenLine")}</em>
                                        ) : seg.kind === "chat" ? (
                                            <em className="whitespace-pre-wrap break-words">{seg.text}</em>
                                        ) : (
                                            seg.text
                                        )}
                                        {rec.status !== "REJECTED" && rec.status !== "PROCESSING" && !redacted.has(seg.discordId) && (
                                            <>
                                                {" "}
                                                <HideLine
                                                    recordingId={rec.id}
                                                    lineKey={key}
                                                    hidden={hiddenLines.has(key)}
                                                    labels={{ hide: t("hideLine"), restore: t("restoreLine"), unsaved: t("unsavedWarning"), working: t("working"), error: t("reviewError") }}
                                                />
                                            </>
                                        )}
                                    </li>
                                );
                            })}
                            </ol>
                    )}
                </section>
            </div>
        </main>
    );
}
