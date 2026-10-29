"use client";

// app/admin/calls/DraftFollowUps.tsx
//
// Draft (or re-draft, e.g. after editing the summary) the follow-ups of one call. Existing drafts are
// kept; only new items are added. Drafts only: nothing is sent without an approval.

import { useState } from "react";
import { useTranslations } from "next-intl";

export function DraftFollowUps({ recordingId }: { recordingId: string }) {
    const t = useTranslations("adminCalls");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    async function run() {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/followups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const body = (await res.json().catch(() => ({}))) as { created?: number; error?: string };
            if (!res.ok) throw new Error(body.error || String(res.status));
            setMessage({ text: t("followUpsDrafted", { count: body.created ?? 0 }), error: false });
        } catch {
            setMessage({ text: t("followUpsError"), error: true });
        } finally {
            setBusy(false);
        }
    }

    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <button type="button" onClick={run} disabled={busy} className="min-h-11 rounded-xl border px-4 font-semibold" style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}>
                {busy ? t("draftingFollowUps") : t("draftFollowUps")}
            </button>
            {message && (
                <span role={message.error ? "alert" : "status"} className={message.error ? "text-tomato text-sm" : "text-foreground/70 text-sm"}>
                    {message.text}
                </span>
            )}
        </span>
    );
}
