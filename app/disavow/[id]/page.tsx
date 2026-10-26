import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getDisavowTranslator } from "@/app/lib/disavow/messages";
import { checkKeyedRateLimit } from "@/app/lib/rate-limit";
import { requireDisavowViewerPage } from "@/app/lib/disavow/access";
import { getDisavowDetail } from "@/app/lib/disavow/detail";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { DetailActions } from "../_components/DetailActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DisavowDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { session, isDPR } = await requireDisavowViewerPage();
    const { id } = await params;
    const t = await getDisavowTranslator();
    // Per-user cap on detail views (each one is audit-logged).
    if (!(await checkKeyedRateLimit("disavow-detail", session.discordId)).success) {
        return <EditorialPage width="max-w-[820px]"><p role="alert">{t("form.errorRate")}</p></EditorialPage>;
    }
    const d = await getDisavowDetail(id, { discordId: session.discordId, isDPR });
    if (!d) notFound();
    const locale = await getLocale();
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    const dpr = "rounds" in d ? d : null;
    const openRound = dpr?.rounds.find((r) => r.state === "OPEN") ?? null;

    return (
        <EditorialPage width="max-w-[820px]">
            <EditorialMasthead
                overline={`${t("reasons." + d.reason)} · ${t("statuses." + d.status)}`}
                title={d.displayName}
                dek={d.listedAt ? t("listedOn", { date: date.format(d.listedAt) }) : undefined}
            />
            <Link href="/disavow" className="mb-5 inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">
                {t("back")}
            </Link>
            <p role="note" className={`${paperCard} mb-6 p-4 text-sm`}>{t("banner")}</p>
            {d.redacted && <p className="mb-4 text-sm font-semibold">{t("detail.redacted")}</p>}

            <section className={`${paperCard} mb-5 grid gap-2 p-5`}>
                <h2 className="m-0 text-lg font-black">{t("detail.statement")}</h2>
                <p className="m-0 whitespace-pre-wrap">{d.statement}</p>
                {d.evidenceUrls.length > 0 && (
                    <>
                        <h3 className="m-0 mt-3 text-base font-bold">{t("detail.evidence")}</h3>
                        <ul className="m-0 list-disc pl-5">
                            {d.evidenceUrls.map((u) => (
                                <li key={u} className="break-all">
                                    <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="underline">{u}</a>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
                <p className="m-0 mt-3 text-sm text-foreground/70">
                    {dpr ? `${t("detail.nominator")}: ${dpr.nominatorDiscordId}` : t("detail.nominatedBy")}
                </p>
            </section>

            <section className={`${paperCard} mb-5 grid gap-2 p-5`}>
                <h2 className="m-0 text-lg font-black">{t("detail.response")}</h2>
                <p className="m-0 whitespace-pre-wrap">{d.subjectResponse ?? t("detail.noResponse")}</p>
            </section>

            {dpr && (
                <DetailActions
                    disavowalId={d.id}
                    status={d.status}
                    rounds={dpr.rounds.map((r) => ({
                        id: r.id, kind: r.kind, state: r.state, closesAt: date.format(r.closesAt), tally: r.tally, myVote: r.myVote, comments: r.comments,
                    }))}
                    hasOpenRound={!!openRound}
                />
            )}
            <section className={`${paperCard} mb-5 grid gap-2 p-5`}>
                <h2 className="m-0 text-lg font-black">{t("detail.history")}</h2>
                <ol className="m-0 list-none p-0 text-sm">
                    {d.history.map((h, i) => (
                        <li key={i}>{date.format(h.at)} · {t(`detail.events.${h.type}`)}</li>
                    ))}
                </ol>
            </section>
        </EditorialPage>
    );
}
