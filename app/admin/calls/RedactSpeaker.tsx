"use client";

// app/admin/calls/RedactSpeaker.tsx
//
// Remove one speaker's lines from the stored transcript (audio is never touched).

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface RedactLabels {
    redact: string;
    restore: string;
    confirm: string;
    working: string;
    error: string;
}

export function RedactSpeaker({ recordingId, discordId, redacted, labels }: { recordingId: string; discordId: string; redacted: boolean; labels: RedactLabels }) {
    const router = useRouter();
    const [state, setState] = useState<"idle" | "working" | "error">("idle");

    async function redact() {
        if (!redacted && !window.confirm(labels.confirm)) return;
        setState("working");
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/redact`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(redacted ? { discordId, restore: true } : { discordId, confirm: true }),
            });
            if (!res.ok) return setState("error");
            setState("idle");
            router.refresh();
        } catch {
            setState("error");
        }
    }

    return (
        <span className="inline-flex items-center gap-2">
            <button type="button" disabled={state === "working"} onClick={redact} className="underline text-sm">
                {state === "working" ? labels.working : redacted ? labels.restore : labels.redact}
            </button>
            {state === "error" && <span className="text-tomato text-sm">{labels.error}</span>}
        </span>
    );
}
