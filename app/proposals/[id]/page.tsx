// app/proposals/[id]/page.tsx — one proposal: the text, the rule it opened under, and the secret vote buttons.
// Imported history (source IMPORTED) shows a record card instead and never any vote UI.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { proposalsEnabled } from "@/app/lib/proposals/constants";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { getProposalDetail, viewerStates, type ProposalDetail } from "@/app/lib/proposals/store";
import { getHistoryDetail, httpUrlOrNull, renderHistoricalBody, type HistoryDetail } from "@/app/lib/proposals/history";
import { explorerTxUrl, parseExplorers } from "@/app/lib/proposals/explorers";
import { getSetting } from "@/app/lib/settings";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { resolvePeople } from "@/app/lib/people";
import { resolveDiscordMentions } from "@/app/lib/discord-mention-resolve";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { VotePanel } from "../_components/VotePanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("proposals");
    return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type T = Awaited<ReturnType<typeof getTranslations>>;

/** The record card for an imported proposal: facts, counts, sources and payments. No vote UI of any kind. */
function HistoryCard({
    p,
    h,
    t,
    day,
    money,
    explorers,
    proposer,
}: {
    p: ProposalDetail;
    h: HistoryDetail;
    t: T;
    day: Intl.DateTimeFormat;
    money: Intl.NumberFormat;
    explorers: Record<string, string>;
    proposer: string | null;
}) {
    const hist = p.historical;
    const needed = p.ayesNeeded;
    const quorum = needed == null ? t("history.noQuorum") : hist?.quorumStated != null ? t("history.quorumStated", { needed }) : t("history.quorumEra", { needed });
    const reactions = hist?.reactions;
    return (
        <div className={`${paperCard} grid gap-2 p-5 text-sm`}>
            <h2 className="m-0 font-display text-lg font-black">{t("history.heading")}</h2>
            <p className="m-0 text-foreground/70">{t("history.imported")}</p>
            {p.proposedAt && (
                <p className="m-0">
                    {t("history.proposedOn")}: {day.format(new Date(p.proposedAt))}
                </p>
            )}
            {proposer && (
                <p className="m-0">
                    {t("history.proposer")}: {proposer}
                </p>
            )}
            {p.city && (
                <p className="m-0">
                    {t("history.city")}: {p.city}
                </p>
            )}
            {p.eventDate ? (
                <p className="m-0">{t("detail.event", { date: day.format(new Date(p.eventDate)) })}</p>
            ) : hist?.eventDateRaw ? (
                <p className="m-0">
                    {t("history.event")}: {hist.eventDateRaw}
                </p>
            ) : null}
            {p.amountUsd == null && hist?.amountRaw && <p className="m-0">{t("rawAmount", { amount: hist.amountRaw })}</p>}
            {p.votes ? (
                <>
                    <p className="m-0">
                        {t("history.counts")}: {t("counts", p.votes)}
                    </p>
                    <p className="m-0">{quorum}</p>
                    {hist?.discussVotes ? <p className="m-0">{t("history.discussNote", { count: hist.discussVotes })}</p> : null}
                </>
            ) : reactions && reactions.length > 0 ? (
                <p className="m-0">
                    {t("history.reactionsNote")} {reactions.map((r) => `${r.emoji} ${r.count}`).join(" ")}
                </p>
            ) : (
                <p className="m-0">{t("countsNone")}</p>
            )}
            <p className="m-0">
                {t("history.source")}: {p.outcomeSource ? t(`history.sources.${p.outcomeSource}` as never) : t("history.sourceNone")}
            </p>
            {h.links.length > 0 && (
                <div>
                    <h3 className="m-0 mb-1 font-semibold">{t("history.links")}</h3>
                    <ul className="m-0 grid list-none gap-1 p-0">
                        {h.links.map((l) => (
                            <li key={l.id}>
                                {httpUrlOrNull(l.url) ? (
                                    <a href={httpUrlOrNull(l.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">
                                        {l.label || t(`linkKinds.${l.kind}` as never)}
                                    </a>
                                ) : (
                                    <span>{l.label || t(`linkKinds.${l.kind}` as never)}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <div>
                <h3 className="m-0 mb-1 font-semibold">{t("history.payments")}</h3>
                {hist?.partlyPaid && p.paidUsd != null && p.amountUsd != null && <p className="m-0 mb-1">{t("partlyPaidLine", { paid: money.format(p.paidUsd), asked: money.format(p.amountUsd) })}</p>}
                {h.payments.length === 0 ? (
                    <p className="m-0">{t("history.noPayments")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr>
                                    <th className="py-1 pr-3">{t("payments.date")}</th>
                                    <th className="py-1 pr-3">{t("payments.amount")}</th>
                                    <th className="py-1 pr-3">{t("payments.chain")}</th>
                                    <th className="py-1 pr-3">{t("payments.usd")}</th>
                                    <th className="py-1">{t("payments.tx")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {h.payments.map((x) => {
                                    const url = explorerTxUrl(x.chain, x.txHash, explorers);
                                    return (
                                        <tr key={x.id}>
                                            <td className="py-1 pr-3">{x.paidAt ?? ""}</td>
                                            <td className="py-1 pr-3">{[x.amount, x.asset].filter(Boolean).join(" ")}</td>
                                            <td className="py-1 pr-3">{x.chain ?? t("payments.offchain")}</td>
                                            <td className="py-1 pr-3">{x.usdValue != null ? money.format(x.usdValue / 100) : ""}</td>
                                            <td className="break-all py-1 font-mono text-xs">
                                                {x.txHash ? (
                                                    url ? (
                                                        <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
                                                            {x.txHash}
                                                        </a>
                                                    ) : (
                                                        x.txHash
                                                    )
                                                ) : (
                                                    (x.offchainRef ?? x.note ?? "")
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fp?: string }> }) {
    const { id } = await params;
    const { fp } = await searchParams;
    const session = await getSession().catch(() => null);
    const viewerId = session?.discordId ?? "";
    const toLogin = (): never => {
        // Keep the key fingerprint from the Discord link through the login round trip, so the browser can still check against it.
        const back = `/proposals/${encodeURIComponent(id)}${fp && /^[0-9a-fA-F ]{32,40}$/.test(fp) ? `?fp=${encodeURIComponent(fp)}` : ""}`;
        redirect(`/login?returnTo=${encodeURIComponent(back)}`);
    };
    const p = await getProposalDetail(id, viewerId);
    // Imported history records are public; everything else (live voting) is for signed-in members.
    if (!viewerId && p?.source !== "IMPORTED") toLogin();
    if (!p) notFound();
    const t = await getTranslations("proposals");
    const locale = await getLocale();
    const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
    const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    // Imported history is a record: it never gets the vote panel, the key fingerprint or an eligibility check,
    // whatever its status says.
    const imported = p.source === "IMPORTED";
    // With the history switched off an imported record does not exist for members either.
    if (imported && !(await toggleEnabled("proposals.historyEnabled").catch(() => false))) notFound();
    // App-run proposals belong to voting: hidden while only the history is switched on.
    if (!imported && !(await proposalsEnabled().catch(() => false))) notFound();
    const isOpen = p.status === "OPEN" && !imported;
    const viewer = isOpen ? (await viewerStates([p.id], viewerId))[p.id] : undefined;

    let hist: HistoryDetail | null = null;
    let proposer: string | null = null;
    let body = p.body;
    let explorers = parseExplorers("");
    if (imported) {
        hist = await getHistoryDetail(p.id).catch(() => null);
        try {
            explorers = parseExplorers(await getSetting("proposals.explorers"));
        } catch {
            /* the code defaults apply */
        }
        const ids = Array.from(new Set(Array.from(p.body.matchAll(/<@!?(\d{15,25})>/g), (m) => m[1])));
        const who = hist?.proposerDiscordId ? [hist.proposerDiscordId] : [];
        const people = await resolvePeople([...ids, ...who]).catch(() => new Map());
        const nameOf = (pid: string): string | undefined => {
            const l = people.get(pid);
            return l && l.source !== "id" ? l.name : undefined;
        };
        proposer = (hist?.proposerDiscordId ? nameOf(hist.proposerDiscordId) : undefined) ?? p.proposerLabel;
        const maps = await resolveDiscordMentions([p.body]).catch(() => ({ channels: {} as Record<string, string>, roles: {} as Record<string, string>, users: {} }));
        body = renderHistoricalBody(p.body, { users: Object.fromEntries(ids.map((x) => [x, nameOf(x) ?? "member"])), channels: maps.channels, roles: maps.roles });
    }

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
                {!imported && (
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
                )}
                {imported && hist && <HistoryCard p={p} h={hist} t={t} day={day} money={money} explorers={explorers} proposer={proposer} />}
                {/* Plain text on purpose: the body is member-written, so it is never rendered as HTML or markdown. */}
                <div className={`${paperCard} whitespace-pre-wrap break-words p-5`}>{body}</div>
                {p.status === "DRAFT" && !imported && <p role="status" className="m-0">{t("detail.opening")}</p>}
                {isOpen && (
                    <VotePanel proposalId={p.id} title={p.title} fingerprint={p.keyFingerprint} open eligible={!!viewer?.eligible} tokenIssued={!!viewer?.tokenIssued} closesAt={p.closesAt} />
                )}
                {isOpen && <p className="m-0 text-sm text-foreground/70">{t("detail.hidden")}</p>}
                {!imported && p.result && (
                    <p className={`${paperCard} m-0 p-5`} role="status">
                        {t("resultLine", { ayes: p.result.ayes, nays: p.result.nays, abstains: p.result.abstains, needed: p.result.ayesNeeded ?? 0 })}
                    </p>
                )}
            </div>
        </EditorialPage>
    );
}
