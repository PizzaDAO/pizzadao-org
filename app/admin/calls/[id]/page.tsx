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
import { getRecording } from "@/app/lib/calls/recordings";
import { CallAudioPlayer } from "../CallAudioPlayer";
import { RemoveRecording } from "../RemoveRecording";

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
    const hasAudio = !!rec.mixKey || rec.speakers.some((s) => s.trackKey);

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

                <section className="grid gap-3">
                    <h2 className="text-xl font-bold m-0">{t("speakersHeading")}</h2>
                    {rec.speakers.length === 0 ? (
                        <p className="text-foreground/60 m-0">{t("noSpeakers")}</p>
                    ) : (
                        <ul className="m-0 pl-5 grid gap-1">
                            {rec.speakers.map((s) => (
                                <li key={s.id}>
                                    {s.displayName ?? s.discordId}{" "}
                                    <span className="text-foreground/60">({t("talkTime", { time: clock(s.talkTimeSec) })})</span>
                                </li>
                            ))}
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

                <section className="grid gap-2">
                    <h2 className="text-xl font-bold m-0">{t("transcriptHeading")}</h2>
                    <p className="text-foreground/60 m-0">{rec.summary ?? t("transcriptPending")}</p>
                </section>
            </div>
        </main>
    );
}
