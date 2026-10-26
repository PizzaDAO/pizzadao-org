"use client";

// app/admin/calls/HideLine.tsx
//
// Hide (or restore) one transcript line from the public page and summaries. Non-destructive.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isReviewDirty } from "./reviewDirty";

export interface HideLineLabels {
    hide: string;
    restore: string;
    unsaved: string;
    working: string;
    error: string;
}

export function HideLine({ recordingId, lineKey, hidden, labels }: { recordingId: string; lineKey: string; hidden: boolean; labels: HideLineLabels }) {
    const router = useRouter();
    const [state, setState] = useState<"idle" | "working" | "error">("idle");

    async function toggle() {
        if (isReviewDirty() && !window.confirm(labels.unsaved)) return;
        setState("working");
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/redact-line`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(hidden ? { key: lineKey, restore: true } : { key: lineKey, confirm: true }),
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
            <button type="button" disabled={state === "working"} onClick={toggle} className="underline text-xs text-foreground/60">
                {state === "working" ? labels.working : hidden ? labels.restore : labels.hide}
            </button>
            {state === "error" && <span className="text-tomato text-xs">{labels.error}</span>}
        </span>
    );
}
