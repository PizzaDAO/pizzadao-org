"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { paperCard } from "@/app/ui/shared/Editorial";
import {
    decodeVoteCode,
    encodeVoteCode,
    flushQueuedVotes,
    loadBallot,
    prepareBallot,
    saveBallot,
    shareVoteCode,
    submitVote,
    type Ballot,
    type Choice,
} from "@/app/lib/proposals/client";

// The wallet libraries only load when a member opens the backup section.
const WalletBackup = dynamic(() => import("./WalletBackup").then((m) => ({ default: m.WalletBackup })), { ssr: false });

const CHOICES: Array<{ choice: Choice; key: "aye" | "nay" | "abstain" }> = [
    { choice: "AYE", key: "aye" },
    { choice: "NAY", key: "nay" },
    { choice: "ABSTAIN", key: "abstain" },
];

type Props = {
    proposalId: string;
    title: string;
    open: boolean;
    closesAt: string | null;
    eligible: boolean;
    tokenIssued: boolean;
    /** The voting-key fingerprint the server rendered on this page; the browser checks the key it fetches against it. */
    fingerprint: string | null;
};

export function VotePanel({ proposalId, title, open, closesAt, eligible, tokenIssued, fingerprint }: Props) {
    const t = useTranslations("proposals.vote");
    const locale = useLocale();
    const [ballot, setBallot] = useState<Ballot | null>(null);
    const [busy, setBusy] = useState<"" | "preparing" | "sending">("");
    const [error, setError] = useState("");
    const [code, setCode] = useState("");
    const [saved, setSaved] = useState<"" | "shared" | "copied" | "failed">("");
    const [needsCode, setNeedsCode] = useState(false);
    const [ready, setReady] = useState(false);
    const [showBackup, setShowBackup] = useState(false);

    const canVote = open && eligible;

    useEffect(() => {
        if (!canVote) return;
        flushQueuedVotes().then(() => setBallot(loadBallot(proposalId))).catch(() => {});
        const have = loadBallot(proposalId);
        if (have) {
            setBallot(have);
            setReady(true);
            return;
        }
        if (tokenIssued) {
            // Issued once already (another browser, or this one was cleared): a vote code or the wallet backup is the way back.
            setNeedsCode(true);
            setReady(true);
            return;
        }
        let cancelled = false;
        prepareBallot(proposalId, fingerprint)
            .then((b) => {
                if (cancelled) return;
                if (b) setBallot(b);
                else setNeedsCode(true);
            })
            .catch(() => !cancelled && setError(t("tokenError")))
            .finally(() => !cancelled && setReady(true));
        return () => {
            cancelled = true;
        };
    }, [canVote, proposalId, tokenIssued, fingerprint, t]);

    const when = closesAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(closesAt)) : "";

    async function vote(choice: Choice) {
        setError("");
        try {
            let b = ballot;
            if (!b) {
                // The token is not ready yet: wait for it (brief spinner), then finish the vote.
                setBusy("preparing");
                b = await prepareBallot(proposalId, fingerprint);
                if (!b) {
                    setNeedsCode(true);
                    return;
                }
                setBallot(b);
            }
            setBusy("sending");
            const r = await submitVote(proposalId, b, choice, closesAt);
            if (r.outcome === "ok" || r.outcome === "queued") setBallot(r.ballot);
            else setError(r.outcome === "closed" ? t("closed") : t("error"));
        } catch {
            setError(t("tokenError"));
        } finally {
            setBusy("");
        }
    }

    function adopt(b: Ballot) {
        saveBallot(proposalId, b);
        setBallot(b);
        setNeedsCode(false);
        setError("");
    }

    function useCode() {
        const b = decodeVoteCode(code, proposalId);
        if (!b) {
            setError(t("codeBad"));
            return;
        }
        adopt(b);
        setCode("");
    }

    async function saveCode() {
        if (ballot) setSaved(await shareVoteCode(ballot, title));
    }

    if (!open) return <p className="m-0 text-sm text-foreground/70">{t("closed")}</p>;
    if (!eligible) return <p className="m-0 text-sm text-foreground/70">{t("notEligible")}</p>;

    const current = ballot?.queued?.choice ?? ballot?.choice;
    const choiceLabel = current ? t(CHOICES.find((c) => c.choice === current)!.key) : "";

    return (
        <section className={`${paperCard} grid gap-4 p-5`} aria-labelledby="vote-heading">
            <h2 id="vote-heading" className="m-0 font-display text-xl font-black">
                {t("heading")}
            </h2>
            {ballot && (
                <div className="grid gap-2 rounded border border-[hsl(var(--tomato)/0.5)] p-3" role="note">
                    <p className="m-0 font-semibold">{t("saveTitle")}</p>
                    <p className="m-0 text-sm">{t("saveHelp")}</p>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={saveCode} className="min-h-11 rounded bg-foreground px-4 text-background">
                            {t("saveCode")}
                        </button>
                        <button type="button" onClick={() => setShowBackup((v) => !v)} className="min-h-11 rounded border px-4" aria-expanded={showBackup}>
                            {t("backupWallet")}
                        </button>
                    </div>
                    {saved && (
                        <p role="status" className="m-0 text-sm">
                            {saved === "failed" ? t("saveFailed") : saved === "shared" ? t("saveShared") : t("copied")}
                        </p>
                    )}
                </div>
            )}
            {(showBackup || (needsCode && !ballot)) && <WalletBackup proposalId={proposalId} ballot={ballot} onRestored={adopt} />}
            {needsCode && !ballot ? (
                <div className="grid gap-2">
                    <p className="m-0 text-sm">{t("needsCode")}</p>
                    <label className="grid gap-1 text-sm">
                        {t("codeLabel")}
                        <textarea
                            className="min-h-20 w-full rounded border bg-card p-2 font-mono text-xs"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            spellCheck={false}
                            autoComplete="off"
                        />
                    </label>
                    <button type="button" onClick={useCode} disabled={!code.trim()} className="min-h-11 w-fit rounded bg-foreground px-5 text-background disabled:opacity-50">
                        {t("codeUse")}
                    </button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("heading")}>
                        {CHOICES.map(({ choice, key }) => (
                            <button
                                key={choice}
                                type="button"
                                onClick={() => vote(choice)}
                                disabled={busy !== ""}
                                aria-pressed={current === choice}
                                className={`min-h-12 rounded border px-3 text-base font-semibold disabled:opacity-60 ${
                                    current === choice ? "border-foreground bg-foreground text-background" : "bg-card"
                                }`}
                            >
                                {t(key)}
                            </button>
                        ))}
                    </div>
                    {(busy !== "" || !ready) && (
                        <p role="status" className="m-0 text-sm text-foreground/70">
                            {busy === "sending" ? t("working") : t("preparing")}
                        </p>
                    )}
                    {ballot?.queued && busy === "" && (
                        <p role="status" className="m-0 text-sm">
                            {t("queued", { choice: choiceLabel })}
                        </p>
                    )}
                    {!ballot?.queued && ballot?.choice && busy === "" && (
                        <p role="status" className="m-0 text-sm">
                            {t("recorded", { choice: choiceLabel, date: when })}
                        </p>
                    )}
                </>
            )}
            {error && (
                <p role="alert" className="m-0 text-tomato">
                    {error}
                </p>
            )}
            <p className="m-0 text-sm text-foreground/70">{t("secret")}</p>
            {fingerprint && <p className="m-0 break-words font-mono text-xs text-foreground/70">{t("fingerprint", { fp: fingerprint })}</p>}
            {ballot && (
                <details className="text-sm">
                    <summary className="cursor-pointer">{t("yourCode")}</summary>
                    <p className="mt-2 text-foreground/70">{t("codeHelp")}</p>
                    <textarea readOnly className="min-h-20 w-full rounded border bg-card p-2 font-mono text-xs" value={encodeVoteCode(ballot)} onFocus={(e) => e.currentTarget.select()} />
                </details>
            )}
        </section>
    );
}
