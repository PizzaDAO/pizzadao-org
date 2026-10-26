"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { paperCard, pillInk, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";

interface RoundView {
    id: string;
    kind: "LIST" | "REMOVE" | "REAFFIRM";
    state: string;
    closesAt: string;
    tally: { yes: number; no: number; abstain: number; recused: number };
    myVote: string | null;
    comments: Array<{ choice: string; comment: string | null }>;
}

/** DPR voting panel and moderation buttons. */
export function DetailActions({
    disavowalId, status, rounds, hasOpenRound,
}: {
    disavowalId: string;
    status: string;
    rounds: RoundView[];
    hasOpenRound: boolean;
}) {
    const t = useTranslations("disavow");
    const router = useRouter();
    const [comment, setComment] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function post(path: string, body?: unknown): Promise<boolean> {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/disavow/${disavowalId}/${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body ?? {}),
            });
            if (!res.ok) {
                setMessage(path === "vote" ? (res.status === 409 ? t("vote.closed") : t("vote.error")) : t("vote.actionError"));
                return false;
            }
            router.refresh();
            return true;
        } catch {
            setMessage(t("vote.actionError"));
            return false;
        } finally {
            setBusy(false);
        }
    }

    const open = rounds.filter((r) => r.state === "OPEN");
    return (
        <section className={`${paperCard} mb-5 grid gap-4 p-5`} aria-live="polite">
            <h2 className="m-0 text-lg font-black">{t("vote.title")}</h2>
            {rounds.map((r) => (
                <div key={r.id} className="grid gap-2">
                    <p className="m-0 font-semibold">{t(`vote.round.${r.kind}`)} · {r.state}</p>
                    <p className="m-0 text-sm">{t("vote.tally", r.tally)}</p>
                    {r.state === "OPEN" && (
                        <>
                            <p className="m-0 text-sm text-foreground/70">{t("vote.rule", { date: r.closesAt })}</p>
                            {r.myVote && <p className="m-0 text-sm">{t("vote.mine", { choice: r.myVote })}</p>}
                            <label className="grid gap-1 text-sm">
                                {t("vote.comment")}
                                <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)}
                                    className="rounded-[--radius] border border-[hsl(var(--rule-warm)/0.65)] bg-background px-3 py-2 text-base" />
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {(["YES", "NO", "ABSTAIN", "RECUSE"] as const).map((c) => (
                                    <button key={c} type="button" disabled={busy} className={`${c === "YES" ? pillTomato : pillOutline} cursor-pointer`}
                                        onClick={async () => {
                                            if (await post("vote", { roundId: r.id, choice: c, comment })) setMessage(t("vote.saved"));
                                        }}>
                                        {t(`vote.${c.toLowerCase()}`)}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {r.comments.length > 0 && (
                        <div className="text-sm">
                            <p className="m-0 font-semibold">{t("vote.comments")}</p>
                            <ul className="m-0 list-disc pl-5">{r.comments.map((c, i) => <li key={i}>{c.choice}: {c.comment}</li>)}</ul>
                        </div>
                    )}
                </div>
            ))}
            <div className="flex flex-wrap gap-2">
                {status === "LISTED" && (
                    <button type="button" disabled={busy} className={`${pillInk} cursor-pointer`} onClick={() => post("suspend")}>{t("vote.suspend")}</button>
                )}
                {status === "SUSPENDED" && (
                    <button type="button" disabled={busy} className={`${pillInk} cursor-pointer`} onClick={() => post("unsuspend")}>{t("vote.unsuspend")}</button>
                )}
                {(status === "LISTED" || status === "SUSPENDED") && !hasOpenRound && open.length === 0 && (
                    <button type="button" disabled={busy} className={`${pillOutline} cursor-pointer`} onClick={() => post("rounds")}>{t("vote.openRemove")}</button>
                )}
            </div>
            {message && <p role="status" className="m-0 text-sm">{message}</p>}
        </section>
    );
}
