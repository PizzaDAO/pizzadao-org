"use client";

// app/admin/calls/ReviewActions.tsx
//
// Edit title/summary/action items/chapters, regenerate the AI summary, and
// publish/unpublish (calzone-30418 phase 2). The API routes enforce Dread
// Pizza Roberts again. The page mounts this with a key that changes whenever the
// row is updated, so the form always shows what is stored after a refresh.
// Publish saves the current fields first.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ReviewLabels {
    title: string;
    summary: string;
    actionItems: string;
    actionItemsHint: string;
    chapters: string;
    chaptersHint: string;
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

export interface ActionItem {
    text: string;
    owner?: string;
}
export interface Chapter {
    startMs: number;
    title: string;
}

function clock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "text | owner" per line. */
export function formatActionItems(items: ActionItem[]): string {
    return items.map((i) => (i.owner ? `${i.text} | ${i.owner}` : i.text)).join("\n");
}
export function parseActionItems(raw: string): ActionItem[] {
    return raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
            const [text, ...owner] = l.split("|");
            const o = owner.join("|").trim();
            return { text: text.trim(), ...(o ? { owner: o } : {}) };
        })
        .filter((i) => i.text);
}
/** "m:ss Title" or "h:mm:ss Title" per line. */
export function formatChapters(chapters: Chapter[]): string {
    return chapters.map((c) => `${clock(c.startMs)} ${c.title}`).join("\n");
}
export function parseChapters(raw: string): Chapter[] {
    const out: Chapter[] = [];
    for (const line of raw.split("\n")) {
        const m = line.trim().match(/^(\d+(?::\d{1,2}){1,2})\s+(.+)$/);
        if (!m) continue;
        const parts = m[1].split(":").map(Number);
        const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
        out.push({ startMs: sec * 1000, title: m[2].trim() });
    }
    return out;
}

export function ReviewActions({
    recordingId,
    status,
    initialTitle,
    initialSummary,
    initialActionItems,
    initialChapters,
    labels,
}: {
    recordingId: string;
    status: string;
    initialTitle: string;
    initialSummary: string;
    initialActionItems: ActionItem[];
    initialChapters: Chapter[];
    labels: ReviewLabels;
}) {
    const router = useRouter();
    const [title, setTitle] = useState(initialTitle);
    const [summary, setSummary] = useState(initialSummary);
    const [actionItems, setActionItems] = useState(formatActionItems(initialActionItems));
    const [chapters, setChapters] = useState(formatChapters(initialChapters));
    const [busy, setBusy] = useState<Busy>(null);
    const [message, setMessage] = useState<"saved" | "error" | null>(null);
    const published = status === "PUBLISHED";
    const base = `/api/admin/calls/${recordingId}`;
    const json = { "Content-Type": "application/json" };
    const canPublish = summary.trim().length > 0;

    const saveRequest = () =>
        fetch(`${base}/summary`, {
            method: "PATCH",
            headers: json,
            body: JSON.stringify({
                title,
                summary,
                actionItems: parseActionItems(actionItems),
                chapters: parseChapters(chapters),
            }),
        });

    async function run(kind: Exclude<Busy, null>, steps: Array<() => Promise<Response>>) {
        setBusy(kind);
        setMessage(null);
        try {
            for (const step of steps) {
                const res = await step();
                if (!res.ok) throw new Error(String(res.status));
            }
            setMessage(kind === "save" ? "saved" : null);
            router.refresh();
        } catch {
            setMessage("error");
        } finally {
            setBusy(null);
        }
    }

    const field = "rounded-xl border p-3 bg-card text-foreground";
    const fieldStyle = { borderColor: "hsl(var(--rule-warm) / 0.65)" };

    return (
        <div className="grid gap-4">
            <label className="grid gap-1">
                <span className="text-sm font-semibold">{labels.title}</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={`min-h-11 ${field}`} style={fieldStyle} />
            </label>
            <label className="grid gap-1">
                <span className="text-sm font-semibold">{labels.summary}</span>
                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={12} maxLength={20000} className={field} style={fieldStyle} />
            </label>
            <label className="grid gap-1">
                <span className="text-sm font-semibold">{labels.actionItems}</span>
                <span className="text-xs text-foreground/60">{labels.actionItemsHint}</span>
                <textarea value={actionItems} onChange={(e) => setActionItems(e.target.value)} rows={5} className={field} style={fieldStyle} />
            </label>
            <label className="grid gap-1">
                <span className="text-sm font-semibold">{labels.chapters}</span>
                <span className="text-xs text-foreground/60">{labels.chaptersHint}</span>
                <textarea value={chapters} onChange={(e) => setChapters(e.target.value)} rows={5} className={field} style={fieldStyle} />
            </label>

            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy !== null} onClick={() => run("save", [saveRequest])} className="btn-pill">
                    {busy === "save" ? labels.saving : labels.save}
                </button>
                <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                        if (window.confirm(labels.regenerateConfirm)) void run("regenerate", [() => fetch(`${base}/regenerate`, { method: "POST" })]);
                    }}
                    className="btn-pill"
                >
                    {busy === "regenerate" ? labels.regenerating : labels.regenerate}
                </button>
                <button
                    type="button"
                    disabled={busy !== null || (!published && !canPublish)}
                    onClick={() =>
                        published
                            ? run("publish", [() => fetch(`${base}/publish`, { method: "POST", headers: json, body: JSON.stringify({ action: "unpublish" }) })])
                            : run("publish", [saveRequest, () => fetch(`${base}/publish`, { method: "POST", headers: json, body: JSON.stringify({ action: "publish" }) })])
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
