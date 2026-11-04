"use client";

// app/admin/calls/ProposeTaskUpdates.tsx
//
// Propose (or re-propose, e.g. after editing the summary) crew task updates for one call. Existing
// proposals are kept; only new ones are added. Proposals only: no task changes without a lead's click.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function ProposeTaskUpdates({ recordingId }: { recordingId: string }) {
    const t = useTranslations("adminCalls");
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    async function run() {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/task-proposals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const body = (await res.json().catch(() => ({}))) as { created?: number; error?: string };
            if (!res.ok) throw new Error(body.error || String(res.status));
            setMessage({ text: t("tasksProposed", { count: body.created ?? 0 }), error: false });
            router.refresh();
        } catch {
            setMessage({ text: t("proposeTasksError"), error: true });
        } finally {
            setBusy(false);
        }
    }

    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <button type="button" onClick={run} disabled={busy} className="min-h-11 rounded-xl border px-4 font-semibold" style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}>
                {busy ? t("proposingTasks") : t("proposeTasks")}
            </button>
            {message && (
                <span role={message.error ? "alert" : "status"} className={message.error ? "text-tomato text-sm" : "text-foreground/70 text-sm"}>
                    {message.text}
                </span>
            )}
        </span>
    );
}
