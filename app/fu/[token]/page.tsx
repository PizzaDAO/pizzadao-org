// app/fu/[token]/page.tsx
//
// The page a signed follow-up link opens (Telegram buttons, Discord "Open in app"). It only
// LOOKS: nothing changes until the member presses the confirm button (a POST to /api/fu/[token]),
// so link previews and prefetchers cannot mark things done or opt anyone out. Not indexed, no referrer.

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadFollowUpConfig } from "@/app/lib/followups/config";
import { lookupLink } from "@/app/lib/followups/link-actions";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { ActionForm } from "./ActionForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("followupAction");
    return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

type Props = { params: Promise<{ token: string }> };

export default async function FollowUpActionPage({ params }: Props) {
    const { token } = await params;
    const t = await getTranslations("followupAction");
    const view = await lookupLink(token).catch(() => null);

    if (!view || !view.ok) {
        const reason = view && !view.ok && view.reason === "expired" ? "expired" : "invalid";
        return (
            <EditorialPage width="max-w-[560px]">
                <EditorialMasthead overline={t("overline")} title={t(`${reason}.title`)} dek={t(`${reason}.body`)} />
            </EditorialPage>
        );
    }

    const { snoozeDays } = await loadFollowUpConfig().catch(() => ({ snoozeDays: 3 }));
    const action = view.claims.a;
    return (
        <EditorialPage width="max-w-[560px]">
            <EditorialMasthead overline={t("overline")} title={t(`actions.${action}.title`)} dek={t("askIntro")} />
            <section className={`${paperCard} mb-5 grid gap-2 p-5`}>
                <p className="m-0 whitespace-pre-wrap font-bold">{view.ask}</p>
            </section>
            {view.open ? (
                <ActionForm
                    token={token}
                    action={action}
                    labels={{
                        confirm: t(`actions.${action}.confirm`),
                        prompt: t(`actions.${action}.prompt`, { days: snoozeDays }),
                        done: t(`actions.${action}.done`, { days: snoozeDays }),
                        replyLabel: t("replyLabel"),
                        send: t("send"),
                        undo: t("undo"),
                        undone: t("undone"),
                        undoExpired: t("undoExpired"),
                        emptyReply: t("emptyReply"),
                        tooMany: t("tooMany"),
                        error: t("error"),
                        closed: t("closed.body"),
                        working: t("working"),
                    }}
                />
            ) : (
                <p className="m-0">{t("closed.body")}</p>
            )}
        </EditorialPage>
    );
}
