"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearFailed, flushDue, flushOnPageHide, listFailed, pruneClosedProposals, QUEUE_EVENT } from "@/app/lib/proposals/vote-queue";
import { clearLegacyUnsaved, noteServerDate, loadBallot, parseMine, prepareBallot } from "@/app/lib/proposals/client";

const CHECKED_KEY = "pizzadao:proposals-checked";
const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Mounted once in the root layout. On any page, for a signed-in member, on devices with a mouse or trackpad, quietly
 * prepares a ballot token for each open proposal the member can vote on, so the token request happens long before any
 * vote (on phones nothing is prepared here; the proposal page does it). It also sends queued votes, forgets ballots of
 * proposals that are no longer open, and shows a compact banner when a vote could not be sent. It shows no
 * save-your-code prompt: the proposal page has a small "Copy vote code" line for that.
 */
export function GlobalBallotPreparer() {
    const t = useTranslations("proposals.banner");
    const pathname = usePathname();
    const [failedIds, setFailedIds] = useState<string[]>([]);
    // Votes that could not be sent (voting closed, refused): a small banner linking to the proposal, until dismissed.
    useEffect(() => {
        const sync = () => setFailedIds(listFailed().map((f) => f.id));
        sync();
        window.addEventListener(QUEUE_EVENT, sync);
        return () => window.removeEventListener(QUEUE_EVENT, sync);
    }, []);

    // Sends queued (randomly delayed) votes that are due, on any page; see vote-queue.ts.
    useEffect(() => {
        void flushDue();
        const iv = window.setInterval(() => void flushDue(), 10000);
        const hide = () => void flushOnPageHide();
        // Only a real pagehide sends early; switching tabs keeps the delay.
        const onVis = () => {
            if (document.visibilityState === "visible") void flushDue();
        };
        window.addEventListener("pagehide", hide);
        document.addEventListener("visibilitychange", onVis);
        return () => {
            window.clearInterval(iv);
            window.removeEventListener("pagehide", hide);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        // Nothing in here may throw or reject: this runs in the root layout on every page, and a failure must be silent.
        (async () => {
            // The check runs at most every few minutes.
            try {
                const last = Number(sessionStorage.getItem(CHECKED_KEY) || 0);
                if (Date.now() - last < CHECK_EVERY_MS) return;
            } catch {
                /* no sessionStorage: check every time */
            }
            const r = await fetch("/api/proposals/mine", { cache: "no-store" }).catch(() => null);
            noteServerDate(r);
            if (!r?.ok || cancelled) return; // logged out, feature off or any error: do nothing
            try {
                sessionStorage.setItem(CHECKED_KEY, String(Date.now()));
            } catch {
                /* no sessionStorage */
            }
            // Only a well-formed answer from an enabled feature is used; anything else (HTML, {}, null, a mock) is ignored.
            const body = await r.json().catch(() => null);
            const proposals = parseMine(body);
            // /api/proposals/mine lists only open proposals: anything else stored in this browser is finished business.
            if ((body as { enabled?: unknown } | null)?.enabled === true) {
                clearLegacyUnsaved();
                pruneClosedProposals(proposals.map((p) => p.id));
            }
            if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) return;
            for (const p of proposals) {
                if (cancelled) return;
                if (p.tokenIssued || loadBallot(p.id)) continue;
                try {
                    await prepareBallot(p.id);
                } catch {
                    /* the proposal page shows its own retry message */
                }
            }
        })().catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    // On the proposal's own page the vote panel shows the same message.
    const failedShown = failedIds.filter((id) => pathname !== `/proposals/${id}`);
    if (failedShown.length === 0) return null;
    return (
        <div className="fixed bottom-2 left-2 right-2 z-50 grid gap-1 sm:right-auto sm:max-w-xs" role="region" aria-label={t("region")}>
            {failedShown.map((id) => (
                <div key={`failed-${id}`} className="flex items-center gap-2 rounded border border-[hsl(var(--tomato)/0.5)] bg-card px-3 py-1 text-xs shadow" role="alert">
                    <p className="m-0 min-w-0 flex-1">{t("voteFailed")}</p>
                    <Link href={`/proposals/${id}`} className="inline-flex min-h-11 items-center px-1 text-foreground underline">
                        {t("open")}
                    </Link>
                    <button type="button" className="min-h-11 min-w-11 rounded" aria-label={t("dismiss")} onClick={() => clearFailed(id)}>
                        &times;
                    </button>
                </div>
            ))}
        </div>
    );
}
