"use client";

// app/admin/calls/ReviewActions.tsx
//
// Edit title/summary, regenerate the AI summary, and publish/unpublish
// (calzone-30418 phase 2). The API routes enforce Dread Pizza Roberts again.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ReviewLabels {
    title: string;
    summary: string;
    save: string;
    saving: string;
    saved: string;
    regenerate: string;
    regenerateConfirm: string;
    regenerating: string;
    publish: string;
    unpublish: string;
    publishNote: string;
    publishNeedsContent: string;
    working: string;
    error: string;
}

type Busy = "save" | "regenerate" | "publish" | null;

export function ReviewActions({
    recordingId,
    status,
    initialTitle,
    initialSummary,
    canPublish,
    labels,
}: {
    recordingId: string;
    status: string;
    initialTitle: string;
    initialSummary: string;
    canPublish: boolean;
    labels: ReviewLabels;
}) {
    const router = useRouter();
    const [title, setTitle] = useState(initialTitle);
    const [summary, setSummary] = useState(initialSummary);
    const [busy, setBusy] = useState<Busy>(null);
    const [message, setMessage] = useState<"saved" | "error" | null>(null);
    const published = status === "PUBLISHED";

    async function call(kind: Exclude<Busy, null>, url: string, init: RequestInit) {
        setBusy(kind);
        setMessage(null);
        try {
            const res = await fetch(url, init);
            if (!res.ok) throw new Error(String(res.status));
            setMessage(kind === "save" ? "saved" : null);
            router.refresh();
        } catch {
            setMessage("error");
        } finally {
            setBusy(null);
        }
    }

    const json = { "Content-Type": "application/json" };
    const base = `/api/admin/calls/${recordingId}`;

    return (
        <div className="grid gap-4">
            <label className="grid gap-1">
                <span className="text-sm font-semibold">{labels.title}</span>
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    className="min-h-11 rounded-xl border px-3 bg-card text-foreground"
                    style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}
                />
            </label>
            <label className="grid gap-1">
                <span className="text-sm font-semibold">{labels.summary}</span>
                <textarea
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    rows={12}
                    maxLength={20000}
                    className="rounded-xl border p-3 bg-card text-foreground"
                    style={{ borderColor: "hsl(var(--rule-warm) / 0.65)" }}
                />
            </label>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => call("save", `${base}/summary`, { method: "PATCH", headers: json, body: JSON.stringify({ title, summary }) })}
                    className="btn-pill"
                >
                    {busy === "save" ? labels.saving : labels.save}
                </button>
                <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                        if (window.confirm(labels.regenerateConfirm)) void call("regenerate", `${base}/regenerate`, { method: "POST" });
                    }}
                    className="btn-pill"
                >
                    {busy === "regenerate" ? labels.regenerating : labels.regenerate}
                </button>
                <button
                    type="button"
                    disabled={busy !== null || (!published && !canPublish)}
                    onClick={() =>
                        call("publish", `${base}/publish`, { method: "POST", headers: json, body: JSON.stringify({ action: published ? "unpublish" : "publish" }) })
                    }
                    className="btn-pill"
                    style={published ? undefined : { background: "hsl(var(--tomato))", color: "hsl(var(--cream))" }}
                >
                    {busy === "publish" ? labels.working : published ? labels.unpublish : labels.publish}
                </button>
            </div>
            {!published && !canPublish && <p className="m-0 text-sm text-foreground/60">{labels.publishNeedsContent}</p>}
            {!published && canPublish && <p className="m-0 text-sm text-foreground/60">{labels.publishNote}</p>}
            {message === "saved" && <p className="m-0 text-sm" role="status">{labels.saved}</p>}
            {message === "error" && <p className="m-0 text-sm text-tomato" role="alert">{labels.error}</p>}
        </div>
    );
}
