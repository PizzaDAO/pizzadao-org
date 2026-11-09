"use client";

// app/admin/calls/UpdateRecap.tsx
//
// Re-render the recap and edit the Discord message that was already posted (e.g. to add mentions).

import { useState } from "react";
import { useTranslations } from "next-intl";

const REASONS: Record<string, "recapUpdateNoMessage" | "recapUpdateDisabled" | "recapUpdateStale" | "recapUpdateExcluded" | "recapUpdateNotPublished" | "recapUpdateImported" | "recapUpdateNoToken"> = {
    "no-message": "recapUpdateNoMessage",
    disabled: "recapUpdateDisabled",
    "stale-redactions": "recapUpdateStale",
    excluded: "recapUpdateExcluded",
    "not-published": "recapUpdateNotPublished",
    imported: "recapUpdateImported",
    "no-token": "recapUpdateNoToken",
};

export function UpdateRecap({ recordingId }: { recordingId: string }) {
    const t = useTranslations("adminCalls");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    async function run() {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/recap`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const body = (await res.json().catch(() => ({}))) as { result?: string };
            if (!res.ok) {
                const key = REASONS[body.result ?? ""];
                setMessage({ text: key ? t(key) : t("recapUpdateError"), error: true });
                return;
            }
            setMessage({ text: t("recapUpdated"), error: false });
        } catch {
            setMessage({ text: t("recapUpdateError"), error: true });
        } finally {
            setBusy(false);
        }
    }

    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <button type="button" onClick={run} disabled={busy} className="min-h-11 rounded-xl border px-4 font-semibold" style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}>
                {busy ? t("recapUpdating") : t("recapUpdate")}
            </button>
            {message && (
                <span role={message.error ? "alert" : "status"} className={message.error ? "text-tomato text-sm" : "text-foreground/70 text-sm"}>
                    {message.text}
                </span>
            )}
        </span>
    );
}
