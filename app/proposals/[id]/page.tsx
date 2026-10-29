// app/proposals/[id]/page.tsx — one proposal: the text, the rule it opened under, and the secret vote buttons.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { getProposalDetail, viewerStates } from "@/app/lib/proposals/store";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { VotePanel } from "../_components/VotePanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("proposals");
    return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fp?: string }> }) {
    const { id } = await params;
    const { fp } = await searchParams;
    const session = await getSession().catch(() => null);
    if (!session?.discordId) {
        // Keep the key fingerprint from the Discord link through the login round trip, so the browser can still check against it.
        const back = `/proposals/${encodeURIComponent(id)}${fp && /^[0-9a-fA-F ]{32,40}$/.test(fp) ? `?fp=${encodeURIComponent(fp)}` : ""}`;
        redirect(`/login?returnTo=${encodeURIComponent(back)}`);
    }
    const p = await getProposalDetail(id, session.discordId);
    if (!p) notFound();
    const t = await getTranslations("proposals");
    const locale = await getLocale();
    const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
    const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const isOpen = p.status === "OPEN";
    const viewer = (await viewerStates([p.id], session.discordId))[p.id];

    return (
        <EditorialPage width="max-w-[820px]">
            <EditorialMasthead
                overline={`${t(`status.${p.status}` as never)} · ${t(`kind.${p.kind}` as never)}`}
                title={p.title}
                dek={p.amountUsd != null ? t("amount", { amount: money.format(p.amountUsd) }) : undefined}
                aside={
                    <Link href="/proposals" className="underline">
                        {t("detail.back")}
                    </Link>
                }
            />
            <div className="grid gap-5">
                <div className={`${paperCard} grid gap-2 p-5 text-sm`}>
                    {p.eventDate && <p className="m-0">{t("detail.event", { date: day.format(new Date(p.eventDate)) })}</p>}
                    {p.city && <p className="m-0">{t("detail.city", { city: p.city })}</p>}
                    {p.sponsorLabel && <p className="m-0">{t("detail.sponsor", { sponsor: p.sponsorLabel })}</p>}
                    {p.ayesNeeded != null && <p className="m-0">{t("detail.meta", { needed: p.ayesNeeded })}</p>}
                    {p.keyFingerprint && <p className="m-0 break-words font-mono text-xs">{t("detail.fingerprint", { fp: p.keyFingerprint })}</p>}
                    {p.eligibleCount != null && <p className="m-0">{t("detail.eligible", { count: p.eligibleCount })}</p>}
                    {isOpen && p.closesAt && <p className="m-0">{t("closes", { date: fmt.format(new Date(p.closesAt)) })}</p>}
                    {p.status === "CANCELLED" && <p className="m-0">{t("detail.cancelled")}</p>}
                </div>
                {/* Plain text on purpose: the body is member-written, so it is never rendered as HTML or markdown. */}
                <div className={`${paperCard} whitespace-pre-wrap break-words p-5`}>{p.body}</div>
                {p.status === "DRAFT" && <p role="status" className="m-0">{t("detail.opening")}</p>}
                {isOpen && (
                    <VotePanel proposalId={p.id} title={p.title} fingerprint={p.keyFingerprint} open eligible={!!viewer?.eligible} tokenIssued={!!viewer?.tokenIssued} closesAt={p.closesAt} />
                )}
                {isOpen && <p className="m-0 text-sm text-foreground/70">{t("detail.hidden")}</p>}
                {p.result && (
                    <p className={`${paperCard} m-0 p-5`} role="status">
                        {t("resultLine", { ayes: p.result.ayes, nays: p.result.nays, abstains: p.result.abstains, needed: p.result.ayesNeeded ?? 0 })}
                    </p>
                )}
            </div>
        </EditorialPage>
    );
}
