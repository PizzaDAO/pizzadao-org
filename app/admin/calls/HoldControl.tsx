"use client";

// app/admin/calls/HoldControl.tsx
//
// Put a call on hold for the owner (a capo or the owner), or release a hold (the owner only: the
// release control is only rendered for the owner and the API enforces it too).

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface HoldLabels {
    hold: string;
    confirm: string;
    notePlaceholder: string;
    release: string;
    working: string;
    error: string;
}

export function HoldControl({ recordingId, held, labels }: { recordingId: string; held: boolean; labels: HoldLabels }) {
    const router = useRouter();
    const [state, setState] = useState<"idle" | "working" | "error">("idle");
    const [note, setNote] = useState("");

    async function send(body: { action: "hold"; note?: string } | { action: "release" }) {
        if (body.action === "hold" && !window.confirm(labels.confirm)) return;
        setState("working");
        try {
            const res = await fetch(`/api/admin/calls/${recordingId}/hold`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok && !(res.status === 404 && body.action === "hold")) return setState("error");
            setState("idle");
            router.refresh();
        } catch {
            setState("error");
        }
    }

    return (
        <div className="grid gap-2 justify-start">
            {held ? (
                <button type="button" disabled={state === "working"} onClick={() => send({ action: "release" })} className="btn-pill justify-self-start">
                    {state === "working" ? labels.working : labels.release}
                </button>
            ) : (
                <>
                    <input
                        type="text"
                        value={note}
                        maxLength={300}
                        placeholder={labels.notePlaceholder}
                        onChange={(e) => setNote(e.target.value)}
                        className="rounded-xl border bg-card p-2 text-sm"
                        style={{ borderColor: "hsl(var(--rule-warm) / 0.55)" }}
                    />
                    <button type="button" disabled={state === "working"} onClick={() => send({ action: "hold", ...(note.trim() ? { note: note.trim() } : {}) })} className="btn-pill justify-self-start">
                        {state === "working" ? labels.working : labels.hold}
                    </button>
                </>
            )}
            {state === "error" && <p className="m-0 text-tomato" role="alert">{labels.error}</p>}
        </div>
    );
}
