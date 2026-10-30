// app/telegram/confirm/[token]/page.tsx
//
// The page the shared bot's confirmation DM links to (plans/telegram-shared-bot.md, part 4). It needs the
// member's own Discord session (the DM link alone is not enough) and only LOOKS: nothing changes until
// the member presses the confirm button (POST /api/telegram/host-match/confirm). Not indexed, no referrer.

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { lookupConfirmation } from "@/app/lib/telegram/host-match-consent";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { ConfirmForm } from "./ConfirmForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("telegramConfirm");
    return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

type Props = { params: Promise<{ token: string }> };

export default async function TelegramConfirmPage({ params }: Props) {
    const { token } = await params;
    const t = await getTranslations("telegramConfirm");
    const session = await getSession();

    if (!session?.discordId) {
        return (
            <EditorialPage width="max-w-[560px]">
                <EditorialMasthead overline={t("overline")} title={t("login.title")} dek={t("login.body")} />
                <Link href={`/login?returnTo=/telegram/confirm/${token}`} className="underline font-bold">
                    {t("login.cta")}
                </Link>
            </EditorialPage>
        );
    }

    const view = await lookupConfirmation(token, session.discordId).catch(() => null);
    if (!view || !view.ok) {
        const reason = view && !view.ok ? view.reason : "invalid";
        return (
            <EditorialPage width="max-w-[560px]">
                <EditorialMasthead overline={t("overline")} title={t(`${reason}.title`)} dek={t(`${reason}.body`)} />
            </EditorialPage>
        );
    }

    return (
        <EditorialPage width="max-w-[560px]">
            <EditorialMasthead overline={t("overline")} title={t("ready.title")} dek={t("ready.body")} />
            {view.handleHint ? (
                <section className={`${paperCard} mb-5 grid gap-2 p-5`}>
                    <p className="m-0 font-bold">{t("ready.hint", { hint: view.handleHint })}</p>
                </section>
            ) : null}
            {view.state === "already" ? (
                <p className="m-0" role="status">{t("already.body")}</p>
            ) : (
                <ConfirmForm
                    token={token}
                    labels={{
                        confirm: t("ready.confirm"),
                        working: t("working"),
                        done: t("done"),
                        error: t("error"),
                        tooMany: t("tooMany"),
                        hasLogin: t("hasLogin"),
                        closed: t("closed.body"),
                    }}
                />
            )}
        </EditorialPage>
    );
}
