// app/admin/followups/page.tsx
//
// Approval queue for follow-up messages drafted from calls (plans/metalhead-followups.md).
// Dread Pizza Roberts only (the call-review gate); the API routes enforce the same check.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { canReviewCalls } from "@/app/lib/calls/access";
import { FollowUpQueue, type QueueLabels } from "./FollowUpQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("adminFollowups");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

const STATUSES = ["DRAFT", "APPROVED", "SENT", "FAILED", "UNREACHABLE", "ESCALATED", "REPLIED", "IN_PROGRESS", "NEEDS_HELP", "DONE", "DISMISSED"] as const;
const EVENTS = ["drafted", "edited", "approved", "sent", "failed", "deferred", "unreachable", "escalated", "reply", "button", "optout", "dismissed", "reresolved", "snooze", "telegram-undeliverable", "optout-undone"] as const;
const FALLBACKS = ["off", "no-link", "not-started", "blocked", "bad-request"] as const;
const PLAIN = [
    "sendingOn", "sendingOff", "empty", "untitledCall", "loadError", "errorGeneric", "working", "unresolved", "ambiguous", "optedOut",
    "pickPerson", "searchPlaceholder", "reresolve", "message", "channel", "channelDiscord", "channelTelegram", "due", "openCall", "reply",
    "approve", "approveEscalate", "save", "dismiss", "copy", "copied", "timeline", "hideTimeline",
] as const;

export default async function AdminFollowUpsPage() {
    const t = await getTranslations("adminFollowups");
    const session = await getSession();
    const allowed = session?.discordId ? await canReviewCalls(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">{t("deniedTitle")}</h1>
                    <p className="text-foreground/60">{session ? t("denied") : t("loginPrompt")}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/followups" className="inline-block mt-4 underline">
                            {t("login")}
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const labels: QueueLabels = {};
    for (const k of PLAIN) labels[k] = t(k);
    // Templates keep their {placeholders} for the client to fill.
    labels.reach = t("reach", { telegram: "{telegram}", linked: "{linked}", people: "{people}" });
    labels.fallbackNote = t("fallbackNote", { reason: "{reason}" });
    labels.snoozedUntil = t("snoozedUntil", { when: "{when}" });
    for (const f of FALLBACKS) labels[`fallback.${f}`] = t(`fallback.${f}`);
    labels.footerNote = t("footerNote", { footer: "{footer}" });
    labels.channelDefault = t("channelDefault", { channel: "{channel}" });
    labels.scheduled = t("scheduled", { when: "{when}" });
    for (const s of STATUSES) labels[`status.${s}`] = t(`status.${s}`);
    for (const e of EVENTS) labels[`event.${e}`] = t(`event.${e}`);
    labels["filter.open"] = t("filterOpen");
    labels["filter.sent"] = t("filterSent");
    labels["filter.all"] = t("filterAll");

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-4xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{t("title")}</h1>
                    <p className="m-0 text-foreground/70">{t("description")}</p>
                    <p className="m-0 flex gap-4 text-sm">
                        <Link href="/admin/calls" className="underline">{t("linkCalls")}</Link>
                        <Link href="/admin/settings" className="underline">{t("linkSettings")}</Link>
                    </p>
                </header>
                <FollowUpQueue labels={labels} />
            </div>
        </main>
    );
}
