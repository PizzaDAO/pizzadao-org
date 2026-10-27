"use client";

// app/admin/calls/RetryTranscription.tsx
//
// After the automatic transcription attempts gave up, let a reviewer queue it again
// (the next cron run, within 15 minutes, picks it up).

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryTranscription({ recordingId, labels }: { recordingId: string; labels: { retry: string; working: string; error: string } }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    async function retry() {
        setBusy(true);
        setFailed(false);
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/retry-transcription`, { method: "POST" });
            if (!res.ok) throw new Error(String(res.status));
            router.refresh();
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    }

    return (
        <span className="inline-flex items-center gap-2">
            <button type="button" onClick={retry} disabled={busy} className="min-h-11 rounded-xl border px-4 font-semibold" style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}>
                {busy ? labels.working : labels.retry}
            </button>
            {failed && <span role="alert" className="text-tomato text-sm">{labels.error}</span>}
        </span>
    );
}
