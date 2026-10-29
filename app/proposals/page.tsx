// app/proposals/page.tsx — open proposals and recent results. Members only; 404 while proposals.enabled is off
// (the layout decides that).

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { listProposals, viewerStates, type ProposalSummary } from "@/app/lib/proposals/store";
import { EditorialMasthead, EditorialPage, EmptyState, paperCard, pillTomato } from "@/app/ui/shared/Editorial";
import { BallotPreparer } from "./_components/BallotPreparer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("proposals");
    return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

function Row({ p, t, fmt, money }: { p: ProposalSummary; t: Awaited<ReturnType<typeof getTranslations>>; fmt: Intl.DateTimeFormat; money: Intl.NumberFormat }) {
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

export default async function ProposalsPage() {
    const session = await getSession().catch(() => null);
    if (!session?.discordId) redirect("/login?returnTo=/proposals");
    const t = await getTranslations("proposals");
    const locale = await getLocale();
    const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const { open, recent } = await listProposals();
    const openIds = open.filter((p) => p.status === "OPEN").map((p) => p.id);
    const states = await viewerStates(openIds, session.discordId);
    // Tokens for proposals this member may vote on and has no ballot for yet are prepared in the background.
    const toPrepare = openIds.filter((id) => states[id]?.eligible && !states[id]?.tokenIssued);

    return (
        <EditorialPage width="max-w-[900px]">
            <BallotPreparer ids={toPrepare} />
            <EditorialMasthead
                overline={t("overline")}
                title={t("title")}
                dek={t("dek")}
                aside={
                    <Link href="/proposals/new" className={pillTomato}>
                        {t("newProposal")}
                    </Link>
                }
            />
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
            <h2 className="mb-3 font-display text-xl font-black">{t("recentHeading")}</h2>
            {recent.length === 0 ? (
                <EmptyState title={t("noRecent")} />
            ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {recent.map((p) => (
                        <Row key={p.id} p={p} t={t} fmt={fmt} money={money} />
                    ))}
                </ul>
            )}
        </EditorialPage>
    );
}
