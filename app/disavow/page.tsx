import Link from "next/link";
import { getLocale } from "next-intl/server";
import { getDisavowTranslator } from "@/app/lib/disavow/messages";
import { requireDisavowViewerPage } from "@/app/lib/disavow/access";
import { listDisavowals } from "@/app/lib/disavow/detail";
import { listMySubmissions } from "@/app/lib/disavow/store";
import { WithdrawButton } from "./_components/WithdrawButton";
import { EditorialMasthead, EditorialPage, EmptyState, paperCard, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DisavowPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
    const { session, isDPR } = await requireDisavowViewerPage();
    const sp = await searchParams;
    const t = await getDisavowTranslator();
    const locale = await getLocale();
    const mineTab = sp.tab === "mine";
    // The "mine" tab needs no list query at all.
    const data = mineTab
        ? ({ tab: "listed", page: 1, pageSize: 1, total: 0, items: [] } as unknown as Awaited<ReturnType<typeof listDisavowals>>)
        : await listDisavowals(sp.tab, sp.page, isDPR, session.discordId);
    const mine = mineTab ? await listMySubmissions(session.discordId) : [];
    const activeTab = mineTab ? "mine" : data.tab;
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    const tabs = isDPR ? ["listed", "open", "suspended", "closed", "mine"] : ["listed", "mine"];
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

    return (
        <EditorialPage width="max-w-[900px]">
            <EditorialMasthead
                overline={t("overline")}
                title={t("title")}
                dek={t("dek")}
                aside={<Link href="/disavow/new" className={pillTomato}>{t("nominate")}</Link>}
            />
            <p role="note" className={`${paperCard} mb-6 p-4 text-sm`}>{t("banner")}</p>

            {(
                <div className="mb-5 flex flex-wrap gap-2">
                    {tabs.map((k) => (
                        <Link
                            key={k}
                            href={`/disavow?tab=${k}`}
                            aria-current={activeTab === k ? "page" : undefined}
                            className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-[13px] font-semibold no-underline ${
                                activeTab === k ? "border-foreground bg-foreground text-background" : "border-[hsl(var(--rule-warm)/0.65)] bg-card text-foreground"
                            }`}
                        >
                            {t(`tabs.${k}`)}
                        </Link>
                    ))}
                </div>
            )}

            {mineTab ? (
                mine.length === 0 ? (
                    <EmptyState title={t("empty")} />
                ) : (
                    <>
                        <p className="mb-3 text-sm text-foreground/70">{t("mine.dek")}</p>
                        <ul className="m-0 flex list-none flex-col gap-3 p-0">
                            {mine.map((m) => (
                                <li key={m.id} className={`${paperCard} flex flex-wrap items-center justify-between gap-3 p-4`}>
                                    <span className="grid gap-1">
                                        <span className="overline text-tomato-readable">{t(`mine.${m.status}`)}</span>
                                        <span className="font-display text-lg font-black">{m.displayName}</span>
                                        <span className="text-sm text-foreground/70">{t("mine.submittedOn", { date: date.format(m.createdAt) })}</span>
                                    </span>
                                    {m.status === "submitted" && <WithdrawButton submissionId={m.id} />}
                                </li>
                            ))}
                        </ul>
                    </>
                )
            ) : data.items.length === 0 ? (
                <EmptyState title={t("empty")} />
            ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {data.items.map((d) => (
                        <li key={d.id} className={`${paperCard} p-4`}>
                            <Link href={`/disavow/${d.id}`} className="grid gap-1 text-foreground no-underline">
                                <span className="overline text-tomato-readable">
                                    {t(`reasons.${d.reason}`)}
                                    {d.status !== "LISTED" ? ` · ${t(`statuses.${d.status}`)}` : ""}
                                </span>
                                <span className="font-display text-lg font-black">{d.displayName}</span>
                                <span className="text-sm text-foreground/70">
                                    {d.listedAt
                                        ? `${t("listedOn", { date: date.format(d.listedAt) })}${d.reviewDueAt ? ` · ${t("reviewDue", { date: date.format(d.reviewDueAt) })}` : ""}`
                                        : t("nominatedOn", { date: date.format(d.createdAt) })}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {!mineTab && pages > 1 && (
                <nav className="mt-6 flex items-center gap-3" aria-label={t("page", { page: data.page })}>
                    {data.page > 1 && <Link className={pillOutline} href={`/disavow?tab=${data.tab}&page=${data.page - 1}`}>{t("prev")}</Link>}
                    <span className="text-sm">{t("page", { page: data.page })}</span>
                    {data.page < pages && <Link className={pillOutline} href={`/disavow?tab=${data.tab}&page=${data.page + 1}`}>{t("next")}</Link>}
                </nav>
            )}
        </EditorialPage>
    );
}
