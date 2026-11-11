// app/proposals/page.tsx — open votes on top, the full proposal history below (app-run and imported). Members only;
// 404 while proposals.enabled is off (the layout decides that). Imported rows are read-only records and never
// get a vote button (plans/proposals-history-import.md).

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { getSetting } from "@/app/lib/settings";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { listOpenProposals, type ProposalSummary } from "@/app/lib/proposals/store";
import { loadPilotState, proposalsEnabledFor } from "@/app/lib/proposals/pilot";
import { listHistory, parseHistoryFilters, type HistoryFilters, type HistoryTotals } from "@/app/lib/proposals/history";
import { EditorialMasthead, EditorialPage, EmptyState, paperCard, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type T = Awaited<ReturnType<typeof getTranslations>>;

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("proposals");
    return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

function Row({ p, t, fmt, money }: { p: ProposalSummary; t: T; fmt: Intl.DateTimeFormat; money: Intl.NumberFormat }) {
    return (
        <li className={`${paperCard} p-4`}>
            <Link href={`/proposals/${p.id}`} className="grid gap-1 no-underline text-foreground">
                <span className="overline text-tomato-readable">
                    {t(`status.${p.status}` as never)} · {t(`kind.${p.kind}` as never)}
                </span>
                <span className="font-display text-lg font-black">{p.title}</span>
                {p.amountUsd != null && <span className="text-sm text-foreground/70">{t("amount", { amount: money.format(p.amountUsd) })}</span>}
                {p.status === "OPEN" && p.closesAt && <span className="text-sm text-foreground/70">{t("closes", { date: fmt.format(new Date(p.closesAt)) })}</span>}
                {p.result && (
                    <span className="text-sm text-foreground/70">
                        {t("resultLine", { ayes: p.result.ayes, nays: p.result.nays, abstains: p.result.abstains, needed: p.result.ayesNeeded ?? 0 })}
                    </span>
                )}
            </Link>
        </li>
    );
}

function countLine(p: ProposalSummary, t: T): string | null {
    if (p.source === "APP") {
        return p.result ? t("resultLine", { ayes: p.result.ayes, nays: p.result.nays, abstains: p.result.abstains, needed: p.result.ayesNeeded ?? 0 }) : null;
    }
    if (p.votes) return t("counts", p.votes);
    const reactions = p.historical?.reactions;
    if (reactions && reactions.length > 0) {
        const pick = (e: string) => reactions.find((r) => r.emoji === e)?.count ?? 0;
        return t("reactionsLine", { summary: `👍 ${pick("👍")} 👎 ${pick("👎")}` });
    }
    return t("countsNone");
}

function HistoryRow({ p, t, day, money }: { p: ProposalSummary; t: T; day: Intl.DateTimeFormat; money: Intl.NumberFormat }) {
    const date = p.proposedAt ?? p.closesAt;
    const line = countLine(p, t);
    return (
        <li className={`${paperCard} p-4`}>
            <Link href={`/proposals/${p.id}`} className="grid gap-1 no-underline text-foreground">
                <span className="flex flex-wrap items-center gap-2 overline text-tomato-readable">
                    <span>{t(`status.${p.status}` as never)}</span>
                    {p.paid && <span className="rounded-full border border-current px-2 py-0.5 text-[11px]">{p.historical?.partlyPaid ? t("partlyPaidBadge") : t("paidBadge")}</span>}
                    <span>· {t(`kind.${p.kind}` as never)}</span>
                    {p.source === "IMPORTED" && <span className="text-[11px] text-foreground/60">· {t("imported")}</span>}
                </span>
                <span className="font-display text-lg font-black">{p.title}</span>
                <span className="text-sm text-foreground/70">
                    {[
                        date ? day.format(new Date(date)) : null,
                        p.city,
                        p.amountUsd != null ? t("amount", { amount: money.format(p.amountUsd) }) : p.historical?.amountRaw ? t("rawAmount", { amount: p.historical.amountRaw }) : null,
                    ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
                {line && <span className="text-sm text-foreground/70">{line}</span>}
                {p.historical?.partlyPaid && p.paidUsd != null && p.amountUsd != null && <span className="text-sm text-foreground/70">{t("partlyPaidLine", { paid: money.format(p.paidUsd), asked: money.format(p.amountUsd) })}</span>}
            </Link>
        </li>
    );
}

function href(f: HistoryFilters, over: Partial<HistoryFilters>): string {
    const m = { ...f, ...over };
    const q = new URLSearchParams();
    if (m.year) q.set("year", String(m.year));
    if (m.outcome) q.set("outcome", m.outcome);
    if (m.city) q.set("city", m.city);
    if (m.kind) q.set("kind", m.kind);
    if (m.paid !== null) q.set("paid", m.paid ? "yes" : "no");
    if (m.q) q.set("q", m.q);
    if (m.page > 1) q.set("page", String(m.page));
    const s = q.toString();
    return s ? `/proposals?${s}` : "/proposals";
}

function Totals({ totals, t, money }: { totals: HistoryTotals; t: T; money: Intl.NumberFormat }) {
    const group = (label: string, rows: HistoryTotals["byYear"]) => (
        <details className="mt-2">
            <summary className="cursor-pointer text-sm font-semibold">{label}</summary>
            <div className="overflow-x-auto">
                <table className="mt-2 w-full text-left text-sm">
                    <thead>
                        <tr>
                            <th className="py-1 pr-3">{t("totals.col.group")}</th>
                            <th className="py-1 pr-3">{t("totals.col.count")}</th>
                            <th className="py-1 pr-3">{t("totals.col.asked")}</th>
                            <th className="py-1">{t("totals.col.paid")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.label}>
                                <td className="py-1 pr-3">{r.label}</td>
                                <td className="py-1 pr-3">{r.count}</td>
                                <td className="py-1 pr-3">{money.format(r.passedAskedUsd)}</td>
                                <td className="py-1">{money.format(r.paidUsd)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
    return (
        <section className={`${paperCard} mb-4 grid gap-1 p-4 text-sm`} aria-label={t("totals.heading")}>
            <h3 className="m-0 font-display text-base font-black">{t("totals.heading")}</h3>
            <p className="m-0">{t("totals.proposals", { count: totals.count })} · {t("totals.passedFailed", { passed: totals.passed, failed: totals.failed, unresolved: totals.unresolved })}</p>
            <p className="m-0">{t("totals.asked", { amount: money.format(totals.passedAskedUsd) })} · {t("totals.paid", { amount: money.format(totals.paidUsd) })}</p>
            {totals.byYear.length > 0 && group(t("totals.byYear"), totals.byYear)}
            {totals.byCity.length > 0 && group(t("totals.byCity"), totals.byCity)}
        </section>
    );
}

async function pageSize(): Promise<number> {
    try {
        return await getSetting("proposals.pageSize");
    } catch {
        return 50;
    }
}

async function historyEnabled(): Promise<boolean> {
    try {
        return await toggleEnabled("proposals.historyEnabled");
    } catch {
        return false;
    }
}

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const session = await getSession().catch(() => null);
    const signedIn = !!session?.discordId;
    // The proposal history is public; live voting is for signed-in members.
    if (!signedIn && !(await historyEnabled())) redirect("/login?returnTo=/proposals");
    const t = await getTranslations("proposals");
    const locale = await getLocale();
    const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
    const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const f = parseHistoryFilters(await searchParams);
    // Voting (open proposals, "New proposal") only shows while proposals.enabled is on; the history can be on alone.
    // While a pilot runs, only the listed members see voting, and they also see the test proposals.
    const voting = signedIn && (await proposalsEnabledFor(session?.discordId).catch(() => false));
    const pilot = voting ? (await loadPilotState()).running : false;
    const [open, size, withImported] = await Promise.all([voting ? listOpenProposals({ includeTest: pilot }) : Promise.resolve([]), pageSize(), historyEnabled()]);
    const history = await listHistory(f, size, withImported).catch(() => null);
    const thisYear = new Date().getUTCFullYear();
    const years = Array.from({ length: thisYear - 2020 }, (_, i) => thisYear - i);
    const input = "min-h-9 rounded-md border border-[hsl(var(--rule-warm)/0.65)] bg-card px-2 text-sm";

    return (
        <EditorialPage width="max-w-[900px]">
            <EditorialMasthead
                overline={t("overline")}
                title={t("title")}
                dek={t("dek")}
                aside={
                    voting ? (
                        <Link href="/proposals/new" className={pillTomato}>
                            {t("newProposal")}
                        </Link>
                    ) : undefined
                }
            />
            {voting && (
                <>
                    <h2 className="mb-3 font-display text-xl font-black">{t("openHeading")}</h2>
                    {open.length === 0 ? (
                        <EmptyState title={t("noOpen")} />
                    ) : (
                        <ul className="m-0 mb-8 flex list-none flex-col gap-3 p-0">
                            {open.map((p) => (
                                <Row key={p.id} p={p} t={t} fmt={fmt} money={money} />
                            ))}
                        </ul>
                    )}
                </>
            )}
            <h2 className="mb-1 mt-8 font-display text-xl font-black">{t("historyHeading")}</h2>
            <p className="mb-3 mt-0 text-sm text-foreground/70">{t("historyDek")}</p>
            <form method="get" action="/proposals" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
                <label className="grid gap-1">
                    {t("filters.year")}
                    <select name="year" defaultValue={f.year ?? ""} className={input}>
                        <option value="">{t("filters.any")}</option>
                        {years.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="grid gap-1">
                    {t("filters.outcome")}
                    <select name="outcome" defaultValue={f.outcome ?? ""} className={input}>
                        <option value="">{t("filters.any")}</option>
                        <option value="passed">{t("filters.passed")}</option>
                        <option value="failed">{t("filters.failed")}</option>
                        <option value="unresolved">{t("filters.unresolved")}</option>
                    </select>
                </label>
                <label className="grid gap-1">
                    {t("filters.kind")}
                    <select name="kind" defaultValue={f.kind ?? ""} className={input}>
                        <option value="">{t("filters.any")}</option>
                        <option value="FUNDING">{t("kind.FUNDING")}</option>
                        <option value="GENERAL">{t("kind.GENERAL")}</option>
                    </select>
                </label>
                <label className="grid gap-1">
                    {t("filters.paid")}
                    <select name="paid" defaultValue={f.paid === null ? "" : f.paid ? "yes" : "no"} className={input}>
                        <option value="">{t("filters.any")}</option>
                        <option value="yes">{t("filters.yes")}</option>
                        <option value="no">{t("filters.no")}</option>
                    </select>
                </label>
                <label className="grid gap-1">
                    {t("filters.city")}
                    <input name="city" defaultValue={f.city} maxLength={100} className={input} />
                </label>
                <label className="grid gap-1">
                    {t("filters.search")}
                    <input name="q" defaultValue={f.q} maxLength={100} className={input} />
                </label>
                <button type="submit" className={pillTomato}>
                    {t("filters.apply")}
                </button>
                <Link href="/proposals" className={pillOutline}>
                    {t("filters.clear")}
                </Link>
            </form>
            {history && <Totals totals={history.totals} t={t} money={money} />}
            {!history || history.rows.length === 0 ? (
                <EmptyState title={t("noHistory")} />
            ) : (
                <>
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                        {history.rows.map((p) => (
                            <HistoryRow key={p.id} p={p} t={t} day={day} money={money} />
                        ))}
                    </ul>
                    {history.pages > 1 && (
                        <nav className="mt-4 flex items-center justify-between text-sm" aria-label={t("historyHeading")}>
                            {history.page > 1 ? (
                                <Link href={href(f, { page: history.page - 1 })} className={pillOutline}>
                                    {t("pager.prev")}
                                </Link>
                            ) : (
                                <span />
                            )}
                            <span>{t("pager.page", { page: history.page, pages: history.pages })}</span>
                            {history.page < history.pages ? (
                                <Link href={href(f, { page: history.page + 1 })} className={pillOutline}>
                                    {t("pager.next")}
                                </Link>
                            ) : (
                                <span />
                            )}
                        </nav>
                    )}
                </>
            )}
        </EditorialPage>
    );
}
