import Link from "next/link";
import { getLocale } from "next-intl/server";
import { getDisavowTranslator } from "@/app/lib/disavow/messages";
import { requireDisavowViewerPage } from "@/app/lib/disavow/access";
import { listDisavowals } from "@/app/lib/disavow/detail";
import { EditorialMasthead, EditorialPage, EmptyState, paperCard, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DisavowPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
    const { session, isDPR } = await requireDisavowViewerPage();
    const sp = await searchParams;
    const t = await getDisavowTranslator();
    const locale = await getLocale();
    const data = await listDisavowals(sp.tab, sp.page, isDPR, session.discordId);
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    const tabs = isDPR ? ["listed", "open", "suspended", "closed"] : ["listed"];
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

            {tabs.length > 1 && (
                <div className="mb-5 flex flex-wrap gap-2">
                    {tabs.map((k) => (
                        <Link
                            key={k}
                            href={`/disavow?tab=${k}`}
                            aria-current={data.tab === k ? "page" : undefined}
                            className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-[13px] font-semibold no-underline ${
                                data.tab === k ? "border-foreground bg-foreground text-background" : "border-[hsl(var(--rule-warm)/0.65)] bg-card text-foreground"
                            }`}
                        >
                            {t(`tabs.${k}`)}
                        </Link>
                    ))}
                </div>
            )}

            {data.items.length === 0 ? (
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

            {pages > 1 && (
                <nav className="mt-6 flex items-center gap-3" aria-label={t("page", { page: data.page })}>
                    {data.page > 1 && <Link className={pillOutline} href={`/disavow?tab=${data.tab}&page=${data.page - 1}`}>{t("prev")}</Link>}
                    <span className="text-sm">{t("page", { page: data.page })}</span>
                    {data.page < pages && <Link className={pillOutline} href={`/disavow?tab=${data.tab}&page=${data.page + 1}`}>{t("next")}</Link>}
                </nav>
            )}
        </EditorialPage>
    );
}
