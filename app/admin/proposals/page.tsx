// app/admin/proposals/page.tsx
//
// Waiting and open proposals with a cancel button, and the "stuck drafts" view (plans/voting-golive-and-reminders.md
// H2, H3). Dread Pizza Roberts only, the same gate as the settings page; the cancel route enforces it again.
// Plain English: admin-only, like the settings group names.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { listForAdmin, type AdminProposalRow } from "@/app/lib/proposals/store";
import { CancelProposalButton } from "./CancelProposalButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Proposals admin", robots: { index: false, follow: false } };

const when = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "");

function Table({ rows, cancellable }: { rows: AdminProposalRow[]; cancellable: boolean }) {
    if (rows.length === 0) return <p className="m-0 text-foreground/70">None.</p>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead>
                    <tr>
                        <th className="py-1 pr-3">Title</th>
                        <th className="py-1 pr-3">Status</th>
                        <th className="py-1 pr-3">Created</th>
                        <th className="py-1 pr-3">Closes</th>
                        <th className="py-1 pr-3">Note</th>
                        {cancellable && <th className="py-1" />}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id} className="align-top">
                            <td className="py-1 pr-3">
                                <Link href={`/proposals/${r.id}`} className="underline">
                                    {r.title}
                                </Link>
                            </td>
                            <td className="py-1 pr-3">{r.status.toLowerCase()}</td>
                            <td className="py-1 pr-3">{when(r.createdAt)}</td>
                            <td className="py-1 pr-3">{when(r.closesAt)}</td>
                            <td className="py-1 pr-3">
                                {r.isTest ? "pilot test. " : ""}
                                {r.stuck ? "Stuck: waiting more than 2 hours. " : ""}
                                {r.failureCode ? `Last open failure: ${r.failureCode}.` : ""}
                            </td>
                            {cancellable && (
                                <td className="py-1">
                                    <CancelProposalButton proposalId={r.id} />
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default async function AdminProposalsPage() {
    const session = await getSession();
    const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

    if (!allowed) {
        return (
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
                <div className="text-center">
                    <h1 className="text-2xl mb-3">Not allowed</h1>
                    <p className="text-foreground/60">{session ? "This page is for Dread Pizza Roberts." : "Log in to continue."}</p>
                    {!session && (
                        <Link href="/login?returnTo=/admin/proposals" className="inline-block mt-4 underline">
                            Log in
                        </Link>
                    )}
                </div>
            </main>
        );
    }

    const data = await listForAdmin().catch(() => null);
    const stuck = data?.active.filter((r) => r.stuck) ?? [];

    return (
        <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
            <div className="mx-auto max-w-5xl grid gap-6">
                <header className="grid gap-2">
                    <p className="overline text-tomato m-0">Admin</p>
                    <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Proposals</h1>
                    <p className="m-0 text-foreground/70">
                        Cancelling a proposal never counts its ballots, deletes the pending votes and updates the Discord post to &quot;withdrawn&quot;. A reason is required and
                        is kept in the proposal&apos;s log.
                    </p>
                    <p className="m-0 text-sm">
                        <Link href="/admin/settings" className="underline">Settings (area: Proposals and voting)</Link>
                    </p>
                </header>
                {!data ? (
                    <p role="alert" className="m-0 text-tomato">Could not load the proposals.</p>
                ) : (
                    <>
                        <section className="grid gap-2" aria-label="Stuck drafts">
                            <h2 className="m-0 font-display text-xl font-black">Stuck drafts</h2>
                            <p className="m-0 text-sm text-foreground/70">
                                Drafts that have waited more than 2 hours to open. Usual causes: no Redis in production, the voter role not found, an incomplete guild listing, or a
                                wrap secret shorter than 32 characters (see the failure code).
                            </p>
                            <Table rows={stuck} cancellable />
                        </section>
                        <section className="grid gap-2" aria-label="Waiting and open">
                            <h2 className="m-0 font-display text-xl font-black">Waiting and open</h2>
                            <Table rows={data.active} cancellable />
                        </section>
                        <section className="grid gap-2" aria-label="Recently closed">
                            <h2 className="m-0 font-display text-xl font-black">Recently closed</h2>
                            <Table rows={data.recent} cancellable={false} />
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
