"use client";

// app/admin/calls/RemoveRecording.tsx
//
// Takedown button with an explicit confirm step.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface RemoveLabels {
    remove: string;
    confirm: string;
    confirmYes: string;
    cancel: string;
    working: string;
    error: string;
}

export function RemoveRecording({ recordingId, labels }: { recordingId: string; labels: RemoveLabels }) {
    const router = useRouter();
    const [state, setState] = useState<"idle" | "confirm" | "working" | "error">("idle");

    async function remove() {
        setState("working");
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/remove`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm: true }),
            });
            if (!res.ok) return setState("error");
            router.refresh();
            setState("idle");
        } catch {
            setState("error");
        }
    }

    if (state === "idle") {
        return (
            <button type="button" onClick={() => setState("confirm")} className="btn-pill justify-self-start" style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))" }}>
                {labels.remove}
            </button>
        );
    }
    return (
        <div className="grid gap-2 justify-start">
            <p className="m-0">{labels.confirm}</p>
            <div className="flex gap-2">
                <button type="button" disabled={state === "working"} onClick={remove} className="btn-pill" style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))" }}>
                    {state === "working" ? labels.working : labels.confirmYes}
                </button>
                <button type="button" disabled={state === "working"} onClick={() => setState("idle")} className="btn-pill">
                    {labels.cancel}
                </button>
            </div>
            {state === "error" && <p className="m-0 text-tomato">{labels.error}</p>}
        </div>
    );
}
