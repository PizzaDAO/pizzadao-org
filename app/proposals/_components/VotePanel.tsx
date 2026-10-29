"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { paperCard } from "@/app/ui/shared/Editorial";
import {
    castVote,
    decodeVoteCode,
    encodeVoteCode,
    loadBallot,
    prepareBallot,
    saveBallot,
    type Ballot,
    type Choice,
} from "@/app/lib/proposals/client";

const CHOICES: Array<{ choice: Choice; key: "aye" | "nay" | "abstain" }> = [
    { choice: "AYE", key: "aye" },
    { choice: "NAY", key: "nay" },
    { choice: "ABSTAIN", key: "abstain" },
];

type Props = {
    proposalId: string;
    open: boolean;
    closesAt: string | null;
    eligible: boolean;
    tokenIssued: boolean;
};

export function VotePanel({ proposalId, open, closesAt, eligible, tokenIssued }: Props) {
    const t = useTranslations("proposals.vote");
    const locale = useLocale();
    const [ballot, setBallot] = useState<Ballot | null>(null);
    const [busy, setBusy] = useState<"" | "preparing" | "sending">("");
    const [error, setError] = useState("");
    const [code, setCode] = useState("");
    const [copied, setCopied] = useState(false);
    const [needsCode, setNeedsCode] = useState(false);
    const [ready, setReady] = useState(false);

    const canVote = open && eligible;

    useEffect(() => {
        if (!canVote) return;
        const have = loadBallot(proposalId);
        if (have) {
            setBallot(have);
            setReady(true);
            return;
        }
        if (tokenIssued) {
            // Issued once already (another browser, or this one was cleared): only a vote code helps.
            setNeedsCode(true);
            setReady(true);
            return;
        }
        let cancelled = false;
        prepareBallot(proposalId)
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
    }, [canVote, proposalId, tokenIssued, t]);

    const when = closesAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(closesAt)) : "";

    async function vote(choice: Choice) {
        setError("");
        try {
            let b = ballot;
            if (!b) {
                // The token is not ready yet: wait for it (brief spinner), then finish the vote.
                setBusy("preparing");
                b = await prepareBallot(proposalId);
                if (!b) {
                    setNeedsCode(true);
                    return;
                }
                setBallot(b);
            }
            setBusy("sending");
            const outcome = await castVote(proposalId, b, choice);
            if (outcome === "ok") setBallot({ ...b, choice });
            else setError(outcome === "closed" ? t("closed") : t("error"));
        } catch {
            setError(t("tokenError"));
        } finally {
            setBusy("");
        }
    }

    function useCode() {
        const b = decodeVoteCode(code, proposalId);
        if (!b) {
            setError(t("codeBad"));
            return;
        }
        saveBallot(proposalId, b);
        setBallot(b);
        setNeedsCode(false);
        setCode("");
        setError("");
    }

    async function copy() {
        if (!ballot) return;
        try {
            await navigator.clipboard.writeText(encodeVoteCode(ballot));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard blocked: the code is shown in the box */
        }
    }

    if (!open) return <p className="m-0 text-sm text-foreground/70">{t("closed")}</p>;
    if (!eligible) return <p className="m-0 text-sm text-foreground/70">{t("notEligible")}</p>;

    const choiceLabel = ballot?.choice ? t(CHOICES.find((c) => c.choice === ballot.choice)!.key) : "";

    return (
        <section className={`${paperCard} grid gap-4 p-5`} aria-labelledby="vote-heading">
            <h2 id="vote-heading" className="m-0 font-display text-xl font-black">
                {t("heading")}
            </h2>
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
                                aria-pressed={ballot?.choice === choice}
                                className={`min-h-12 rounded border px-3 text-base font-semibold disabled:opacity-60 ${
                                    ballot?.choice === choice ? "border-foreground bg-foreground text-background" : "bg-card"
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
                    {ballot?.choice && busy === "" && (
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
            {ballot && (
                <details className="text-sm">
                    <summary className="cursor-pointer">{t("yourCode")}</summary>
                    <p className="mt-2 text-foreground/70">{t("codeHelp")}</p>
                    <textarea readOnly className="min-h-20 w-full rounded border bg-card p-2 font-mono text-xs" value={encodeVoteCode(ballot)} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" onClick={copy} className="mt-2 min-h-11 rounded border px-4">
                        {copied ? t("copied") : t("copy")}
                    </button>
                </details>
            )}
        </section>
    );
}
