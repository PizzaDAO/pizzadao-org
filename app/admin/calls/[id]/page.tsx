// app/admin/calls/[id]/page.tsx
//
// One recording (calzone-30418): reviewer-only audio player, speakers, and the
// reserved transcript/summary area. Dread Pizza Roberts only.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { callDateTimeFormat } from "@/app/lib/calls/format-call-time";
import { getSession } from "@/app/lib/session";
import { callReviewRole, canActOnCall, heldReason } from "@/app/lib/calls/access";
import { HoldControl } from "../HoldControl";
import { asSegments, getRecording } from "@/app/lib/calls/recordings";
import { loadPostFilter } from "@/app/lib/calls/post-filters";
import { loadSettings } from "@/app/lib/settings";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { buildRecapParts, loadRecapPeople, recapActionViews, recapCrewExcluded, recapLimits, recapFilteredCount, recapPostingEnabled, redactionsNewerThanSummary, resolveRecapChannel } from "@/app/lib/calls/recap";
import { formatClock } from "@/app/lib/calls/summarize";
import { CallAudioPlayer } from "../CallAudioPlayer";
import { RemoveRecording } from "../RemoveRecording";
import { ReviewActions } from "../ReviewActions";
import { RedactSpeaker } from "../RedactSpeaker";
import { RetryTranscription } from "../RetryTranscription";
import { DraftFollowUps } from "../DraftFollowUps";
import { ProposeTaskUpdates } from "../ProposeTaskUpdates";
import { CrewCallUpdates } from "@/app/crew/[crewId]/CrewCallUpdates";
import { crewInAllowlist, loadTaskProposalConfig } from "@/app/lib/call-tasks/config";
import { prisma } from "@/app/lib/db";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { PERMANENT_TRANSCRIBE_ERRORS, PROGRESS } from "@/app/lib/calls/transcribe";
import { readEvidence } from "@/app/lib/calls/evidence";
import { HideLine } from "../HideLine";
import { segmentKey } from "@/app/lib/calls/chat";
import { displaySpeakerName, importedSpeakerNumber } from "@/app/lib/calls/speaker-labels";
import { importedAllowed } from "@/app/lib/calls/imported";
import { SpeakerLabel } from "../SpeakerLabel";
import { UpdateRecap } from "../UpdateRecap";
import { CallFollowUpLinks } from "../CallFollowUpLinks";
import { settingInt } from "@/app/lib/settings/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminCallDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const t = await getTranslations("adminCalls");
    const locale = await getLocale();
    const session = await getSession();
    const role = session?.discordId ? await callReviewRole(session.discordId) : null;
    const allowed = role !== null;
    const isOwner = role === "owner";

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
    // The private filter: the owner sees why a call is held; a capo cannot open a held, auto-held or imported call (404, like the API).
    const holdFilter = await loadPostFilter().catch(() => null);
    if (!canActOnCall(role, "view", rec, holdFilter)) notFound();
    const held = heldReason(rec, holdFilter);
    // Newest review events (who published, held, edited, and from where). Best effort: a failure just hides the strip.
    const capoOn = await toggleEnabled("calls.capoReviewEnabled").catch(() => false);
    const auditRows = !capoOn ? [] : await prisma.callReviewEvent
        .findMany({ where: { recordingId: rec.id }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, actorId: true, action: true, via: true, createdAt: true } })
        .catch(() => []);
    const tAudit = (action: string) =>
        action === "publish" ? t("auditPublish") : action === "unpublish" ? t("auditUnpublish") : action === "reject" ? t("auditReject") : action === "hold" ? t("auditHold") : action === "release" ? t("auditRelease")
        : action === "auto_hold" ? t("auditAuto_hold") : action === "summary_edit" ? t("auditSummary_edit") : action === "regenerate" ? t("auditRegenerate") : action === "redact" ? t("auditRedact") : action === "card_posted" ? t("auditCard_posted") : action;

    const when = callDateTimeFormat(locale, { month: "long" });
    const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    const segments = asSegments(rec.transcript);
    const redacted = new Set(rec.redactedSpeakerIds);
    const hiddenLines = new Set(rec.redactedSegmentIds);
    const imported = rec.source !== "DISCORD";
    const speakerName = (discordId: string, displayName: string | null) =>
        displaySpeakerName(discordId, displayName, { speakerN: (n) => t("speakerN", { n }), fallback: discordId.startsWith("xs:") ? t("unknownSpeaker") : discordId });
    const names = new Map(rec.speakers.map((sp) => [sp.discordId, speakerName(sp.discordId, sp.displayName)]));
    // Labels written after the summary: the summary still has "Speaker N" until it is regenerated.
    const labelsNewerThanSummary =
        imported && !!rec.speakerLabelsUpdatedAt && !!rec.summary && rec.speakerLabelsUpdatedAt.getTime() > Math.max(rec.summaryGeneratedAt?.getTime() ?? 0, rec.summaryEditedAt?.getTime() ?? 0);
    const canLabel = imported && rec.status !== "REJECTED" && rec.status !== "PROCESSING";
    const actionItems = (Array.isArray(rec.actionItems) ? rec.actionItems : []) as Array<{ text?: string; owner?: string; suggestedBy?: string; done?: boolean; evidence?: Array<{ url: string; label?: string }>; key?: string }>;
    const chapters = (Array.isArray(rec.chapters) ? rec.chapters : []) as Array<{ startMs?: number; title?: string }>;
    // Preview of the Discord recap that publishing triggers (text from the saved title/summary/action items).
    const postFilter = holdFilter;
    // An imported call posts no recap (and drafts no follow-ups) unless its switch is on, so there is nothing to preview.
    const [importedRecapOn, importedFollowupsOn] = imported
        ? await Promise.all([importedAllowed("calls.importedRecapPostEnabled"), importedAllowed("calls.importedFollowupsEnabled")])
        : [true, true];
    // Live status (calls.recapLiveStatusEnabled): the preview shows what the recap will show; undefined while it is off.
    const actionViews = postFilter ? await recapActionViews(rec, postFilter).catch(() => undefined) : undefined;
    const settings = await loadSettings();
    const recapParts =
        postFilter && importedRecapOn && (rec.status === "IN_REVIEW" || rec.status === "PUBLISHED") && rec.summary?.trim()
            ? buildRecapParts(
                  { id: rec.id, title: rec.title, eventName: rec.eventName, crewLabel: rec.crewLabel, summary: rec.summary, actionItems: rec.actionItems, chapters: rec.chapters, ...(actionViews ? { actionViews } : {}) },
                  undefined,
                  postFilter,
                  actionViews ? { ...recapLimits(settings), minBullets: settingInt("calls.recapMinBullets", settings) } : recapLimits(settings),
                  await loadRecapPeople({ id: rec.id, source: rec.source, actionItems: rec.actionItems, redactedSpeakerIds: rec.redactedSpeakerIds }),
              )
            : null;
    const recapText = recapParts?.text ?? null;
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
    const followUpRows = followUpCount > 0 ? await prisma.followUp.findMany({ where: { recordingId: rec.id }, orderBy: { createdAt: "asc" }, select: { id: true, ownerName: true, ask: true, status: true, actionKey: true, doneUrl: true } }).catch(() => []) : [];
    const tFollowUps = await getTranslations("adminFollowups");
    // The keyed items, labelled A1.. the way the drafting model saw them; the follow-up state beside each item (live status on only).
    const keyedItems = actionItems.flatMap((a) => (a.text && a.key ? [{ key: a.key, text: a.text }] : []));
    // Items without a key yet are offered as "#N" (their A-label number): the server hands out the keys when a link is saved, so this page never writes.
    const linkItems = actionItems.filter((a) => a.text).map((a, i) => ({ key: a.key ?? `#${i + 1}`, label: `A${i + 1}`, text: a.text as string }));
    const followUpStates: Record<string, "in_progress" | "done"> = {};
    if (actionViews) {
        for (const it of keyedItems) {
            const mine = followUpRows.filter((f) => f.actionKey === it.key);
            if (mine.some((f) => f.status === "IN_PROGRESS" || f.status === "NEEDS_HELP")) followUpStates[it.key] = "in_progress";
            else if (mine.some((f) => f.status === "DONE")) followUpStates[it.key] = "done";
        }
    }
    const canDraftFollowUps = importedFollowupsOn && (rec.status === "IN_REVIEW" || rec.status === "PUBLISHED") && !!rec.summary?.trim();
    // Proposed crew task updates (plans/post-call-agenda-updates.md): shown when the pass is on for this crew or proposals already exist.
    // A call that is not a crew call (the Community Call) routes its new tasks to other crews: one panel per crew.
    const proposalCrewIds = rec.crewId
        ? (await prisma.crewTaskProposal.findMany({ where: { recordingId: rec.id }, select: { crewId: true }, distinct: ["crewId"] }).catch(() => [])).map((r) => r.crewId)
        : [];
    const proposalCount = proposalCrewIds.length;
    const routedCrewIds = proposalCrewIds.filter((c) => c !== rec.crewId).sort();
    const routedCrewLabels = routedCrewIds.length
        ? new Map((await getCrewMappings().then((m) => m.crews).catch(() => [])).map((c) => [c.id, c.label] as const))
        : new Map<string, string>();
    const proposalCfg = await loadTaskProposalConfig();
    const showTaskProposals =
        !!rec.crewId && !imported && (rec.status === "IN_REVIEW" || rec.status === "PUBLISHED") && !!rec.summary?.trim() && ((proposalCfg.enabled && crewInAllowlist(proposalCfg, rec.crewId)) || proposalCount > 0);
    const hasAudio =!!rec.mixKey || rec.speakers.some((s) => s.trackKey);
    // A capo may not publish text newer redactions have outdated: regenerate or edit the summary first (the API refuses it too).
    const capoPublishBlocked = !isOwner && redactionsNewerThanSummary(rec);

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
                        {imported ? ` · ${t("sourceBadgeX")}` : ""}
                    </p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{rec.title ?? rec.eventName ?? t("title")}</h1>
                    <p className="m-0 text-foreground/70">
                        {when.format(rec.startedAt)} · {t("minutes", { count: Math.max(1, Math.round(rec.durationSec / 60)) })}
                        {rec.endReason ? ` · ${t("endReason", { reason: rec.endReason })}` : ""}
                    </p>
                </header>

                {imported && (
                    <section className="grid gap-1">
                        <p className="m-0 text-sm text-foreground/70">{t("importedNote")}</p>
                        {isOwner && rec.sourceUrl && (
                            <p className="m-0 text-sm">
                                <a href={rec.sourceUrl} rel="noreferrer noopener" target="_blank" className="underline">
                                    {t("sourceLink")}
                                </a>
                            </p>
                        )}
                    </section>
                )}

                {isOwner && (
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
                )}

                {rec.reviewHoldAt && (
                    <section className="grid gap-1">
                        <h2 className="text-xl font-bold m-0">{t("holdHeading")}</h2>
                        <p className="m-0 text-tomato">{t("holdHeldNote")}</p>
                        {isOwner && rec.reviewHoldNote && <p className="m-0 text-sm text-foreground/70">{rec.reviewHoldNote}</p>}
                    </section>
                )}
                {isOwner && capoOn && !rec.reviewHoldAt && held && <p className="m-0 text-tomato">{held === "crew" ? t("holdAutoCrew") : held === "term" ? t("holdAutoTerm") : t("holdAutoUnreadable")}</p>}
                {capoOn && rec.status !== "REJECTED" && (
                    <HoldControl
                        recordingId={rec.id}
                        held={!!rec.reviewHoldAt}
                        labels={{ hold: t("holdButton"), confirm: t("holdConfirm"), notePlaceholder: t("holdNotePlaceholder"), release: t("holdRelease"), working: t("holdWorking"), error: t("holdError") }}
                    />
                )}

                {labelsNewerThanSummary && <p className="m-0 text-tomato">{t("labelsChanged")}</p>}

                {rec.summaryError && !rec.summary && (
                    <p className="m-0 text-tomato">{t("summaryFailed", { count: rec.summaryAttempts, error: rec.summaryError })}</p>
                )}

                {progressError && <p className="m-0 text-foreground/70">{t("transcribeProgressError", { error: progressError })}</p>}

                {transcribeGaveUp && (
                    <section className="grid gap-2">
                        <p className="m-0 text-tomato">{t("transcribeFailed", { count: rec.transcribeAttempts, error: rec.transcribeError ?? "" })}</p>
                        {isOwner && <RetryTranscription recordingId={rec.id} labels={{ retry: t("transcribeRetry"), working: t("working"), error: t("reviewError") }} />}
                    </section>
                )}

                {isOwner && canDraftFollowUps && (
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

                {isOwner && followUpRows.length > 0 && (
                    <section className="grid gap-2">
                        <h2 className="text-xl font-bold m-0">{t("followUpLinksHeading")}</h2>
                        <p className="m-0 text-foreground/70 text-sm">{t("followUpLinksHelp")}</p>
                        <CallFollowUpLinks
                            rows={followUpRows.map((f) => ({ id: f.id, owner: f.ownerName, ask: f.ask, status: tFollowUps(`status.${f.status}`), actionKey: f.actionKey, doneUrl: f.doneUrl }))}
                            items={linkItems}
                            labels={{ actionItem: t("followUpLinkItem"), none: t("followUpLinkNone"), doneUrl: t("followUpLinkUrl"), save: t("followUpLinkSave"), clear: t("followUpLinkClear"), working: t("working"), error: t("reviewError"), saved: t("saved") }}
                        />
                    </section>
                )}

                {showTaskProposals && rec.crewId && (
                    <section className="grid gap-2">
                        <h2 className="text-xl font-bold m-0">{t("taskProposalsHeading")}</h2>
                        <p className="m-0 text-foreground/70 text-sm">{t("taskProposalsHelp")}</p>
                        <div className="flex flex-wrap items-center gap-4">
                            {isOwner && <ProposeTaskUpdates recordingId={rec.id} />}
                        </div>
                        {(routedCrewIds.length === 0 || proposalCrewIds.includes(rec.crewId)) && <CrewCallUpdates crewId={rec.crewId} recordingId={rec.id} showEmpty />}
                        {routedCrewIds.map((crewId) => (
                            <div key={crewId} className="grid gap-2">
                                <h3 className="text-lg font-bold m-0">{routedCrewLabels.get(crewId) ?? crewId}</h3>
                                <CrewCallUpdates crewId={crewId} recordingId={rec.id} showEmpty />
                            </div>
                        ))}
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
                                        {names.get(s.discordId) ?? s.discordId}{" "}
                                        <span className="text-foreground/60">
                                            ({t("talkTime", { time: clock(s.talkTimeSec) })}
                                            {segments.length > 0 ? `, ${t("lines", { count: lines })}` : ""})
                                        </span>
                                        {redacted.has(s.discordId) && <span className="text-tomato"> {t("redactedBadge")}</span>}
                                        {missing && <span className="text-tomato"> {t("noLinesWarning")}</span>}
                                        {canLabel && importedSpeakerNumber(s.discordId) !== null && (
                                            <>
                                                {" "}
                                                <SpeakerLabel recordingId={rec.id} speakerId={s.discordId} name={s.displayName} linked={!!s.linkedDiscordId} />
                                            </>
                                        )}
                                        {(lines > 0 || redacted.has(s.discordId)) && (isOwner || !redacted.has(s.discordId)) && rec.status !== "REJECTED" && rec.status !== "PROCESSING" && (
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

                {isOwner && (
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
                )}

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
                                initialActionItems={actionItems.filter((i): i is { text: string; owner?: string; suggestedBy?: string; done?: boolean; evidence?: Array<{ url: string; label?: string }>; key?: string } => !!i.text)}
                                initialChapters={chapters.filter((c): c is { startMs: number; title: string } => !!c.title && typeof c.startMs === "number")}
                                followUpStates={followUpStates}
                                publishBlocked={capoPublishBlocked ? t("capoPublishBlocked") : undefined}
                                labels={{
                                    followUpInProgress: t("followUpStateInProgress"),
                                    followUpDone: t("followUpStateDone"),
                                    title: t("fieldTitle"),
                                    actionItems: t("actionItemsHeading"),
                                    actionItemsHint: t("actionItemsHint"),
                                    actionItemDone: t("actionItemDone"),
                                    actionItemEvidence: t("actionItemEvidence"),
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
                            {recapText.split(/(<@\d{5,25}>)/).map((seg, i) => {
                                const id = /^<@(\d{5,25})>$/.exec(seg)?.[1];
                                return id ? (
                                    <mark key={i} className="rounded px-1" title={t("recapMentionTitle")}>
                                        @{recapParts?.mentions.get(id) ?? "user"}
                                    </mark>
                                ) : (
                                    seg
                                );
                            })}
                        </pre>
                        {isOwner && rec.status === "PUBLISHED" && rec.recapPostedAt && rec.recapMessageId && <UpdateRecap recordingId={rec.id} />}
                    </section>
                )}

                {actionItems.length > 0 && (
                    <section className="grid gap-2">
                        <h2 className="text-xl font-bold m-0">{t("actionItemsHeading")}</h2>
                        <ul className="m-0 pl-5 grid gap-1">
                            {actionItems.map((item, i) => (
                                <li key={i}>
                                    {item.done ? <span role="img" aria-label={t("actionItemDone")}>{"\u2705"} </span> : null}
                                    {item.text}
                                    {item.done ? readEvidence(item.evidence).map((e) => (
                                        <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs underline">{e.label}</a>
                                    )) : null}
                                    {item.owner ? <span className="text-foreground/60"> ({item.owner})</span> : null}
                                    {item.suggestedBy ? <span className="text-foreground/60"> {"\u2014"} {t("suggestedBy", { name: item.suggestedBy })}</span> : null}
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

                {auditRows.length > 0 && (
                    <section className="grid gap-2">
                        <h2 className="text-xl font-bold m-0">{t("auditHeading")}</h2>
                        <ul className="m-0 pl-5 grid gap-1 text-sm">
                            {auditRows.map((e) => (
                                <li key={e.id}>{t("auditLine", { action: tAudit(e.action), actor: e.actorId, via: e.via, time: when.format(e.createdAt) })}</li>
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
                                        <strong>{names.get(seg.discordId) ?? seg.name ?? speakerName(seg.discordId, null)}</strong>:{" "}
                                        {hidden ? (
                                            <em className="text-foreground/60">{t("hiddenLine")}</em>
                                        ) : seg.kind === "chat" ? (
                                            <em className="whitespace-pre-wrap break-words">{seg.text}</em>
                                        ) : (
                                            seg.text
                                        )}
                                        {rec.status !== "REJECTED" && rec.status !== "PROCESSING" && !redacted.has(seg.discordId) && (isOwner || !hiddenLines.has(key)) && (
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
