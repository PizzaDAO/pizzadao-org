// app/admin/telegram/page.tsx
//
// The city Telegram mirror outbox (plans/telegram-shared-bot.md). Dread Pizza Roberts only, the same
// gate as the settings page; the API routes enforce it on every request.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { TelegramOutbox, type OutboxLabels } from "./TelegramOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("adminTelegram");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

const PLAIN = [
    "loadError", "errorGeneric", "working", "empty", "on", "off", "statusTitle", "sendYes", "sendNo", "sendPreview", "sendNoKey", "sendKilled",
    "dirOk", "warnTitle", "outboxTitle", "skip", "showText", "hideText", "directoryTitle", "directoryEmpty", "noChat", "warnAnnounce", "hostMatchTitle", "hostMatchOff",
    "retry", "refresh", "skipConfirm", "skipYes", "skipCancel", "modeProfile", "modeInvite",
] as const;
const TEMPLATES: Record<string, string[]> = {
    statusSend: ["value"],
    sentAt: ["value"],
    createdAt: ["value"],
    sendAfter: ["value"],
    expiresAt: ["value"],
    attempts: ["value"],
    statusSwitches: ["master", "recap", "agenda", "announce"],
    statusDirectory: ["value"],
    warnUnknown: ["city", "where"],
    warnNoChat: ["city", "where"],
    warnCrew: ["crew"],
    hostMatchOn: ["mode", "today", "budget"],
    hostMatchCounts: ["pending", "invited", "confirmed", "declined"],
};
const STATUSES = ["PENDING", "SENT", "SKIPPED", "FAILED", "UNCERTAIN"] as const;
const KINDS = ["recap", "agenda", "announce"] as const;
const CODES = [
    "not_configured", "disabled", "unavailable", "unauthorized", "rate_limited", "no_group", "kicked", "uncertain", "bad_request", "conflict",
    "expired", "filtered", "manual",
] as const;

export default async function AdminTelegramPage() {
    const t = await getTranslations("adminTelegram");
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">{t("deniedTitle")}</h1>
                    <p className="text-foreground/60">{session ? t("denied") : t("loginPrompt")}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/telegram" className="inline-block mt-4 underline">
                            {t("login")}
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const labels: OutboxLabels = {};
    for (const k of PLAIN) labels[k] = t(k);
    // Templates keep their {placeholders} for the client to fill.
    for (const [k, vars] of Object.entries(TEMPLATES)) labels[k] = t(k, Object.fromEntries(vars.map((v) => [v, `{${v}}`])));
    for (const s of STATUSES) labels[`status.${s}`] = t(`status.${s}`);
    for (const k of KINDS) labels[`kind.${k}`] = t(`kind.${k}`);
    for (const c of CODES) labels[`code.${c}`] = t(`code.${c}`);

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-4xl grid gap-5">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">{t("overline")}</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">{t("title")}</h1>
                    <p className="m-0 text-foreground/70">{t("description")}</p>
                    <p className="m-0 flex gap-4 text-sm">
                        <Link href="/admin/settings" className="underline">{t("linkSettings")}</Link>
                    </p>
                </header>
                <TelegramOutbox labels={labels} />
            </div>
        </main>
    );
}
