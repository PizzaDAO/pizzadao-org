"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

/** The proposer withdraws their own proposal (waiting to open, or open until the window ends). Asks once first. */
export function WithdrawButton({ proposalId }: { proposalId: string }) {
    const t = useTranslations("proposals.withdraw");
    const router = useRouter();
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function withdraw() {
        setBusy(true);
        setError("");
        try {
            const r = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/withdraw`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            if (r.ok) {
                router.refresh();
                return;
            }
            setError(t("error"));
        } catch {
            setError(t("error"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="grid gap-2 text-sm">
            {!asking ? (
                <button type="button" className="min-h-11 w-fit rounded border px-4" onClick={() => setAsking(true)}>
                    {t("button")}
                </button>
            ) : (
                <div className="grid gap-2 rounded border p-3" role="alertdialog" aria-label={t("button")}>
                    <p className="m-0">{t("confirm")}</p>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} className="min-h-11 rounded bg-foreground px-4 text-background disabled:opacity-50" onClick={withdraw}>
                            {busy ? t("working") : t("yes")}
                        </button>
                        <button type="button" disabled={busy} className="min-h-11 rounded border px-4" onClick={() => setAsking(false)}>
                            {t("no")}
                        </button>
                    </div>
                </div>
            )}
            {error && (
                <p role="alert" className="m-0 text-tomato">
                    {error}
                </p>
            )}
        </div>
    );
}
