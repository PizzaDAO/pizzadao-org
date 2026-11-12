"use client";

// app/admin/calls/ReviewActions.tsx
//
// Edit title/summary/action items/chapters, regenerate the AI summary, and
// publish/unpublish (calzone-30418 phase 2). The API routes enforce Dread
// Pizza Roberts again. The page mounts this with a key that changes whenever the
// row is updated, so the form always shows what is stored after a refresh.
// Publish saves the current fields first.

import { parseEvidenceInput, safeEvidenceUrl, MAX_EVIDENCE, type Evidence } from "@/app/lib/calls/evidence";
import { useEffect, useState } from "react";
import { setReviewDirty } from "./reviewDirty";
import { useRouter } from "next/navigation";

export interface ReviewLabels {
    title: string;
    summary: string;
    actionItems: string;
    actionItemsHint: string;
    actionItemDone: string;
    actionItemEvidence: string;
    chapters: string;
    chaptersHint: string;
    tooManyItems: string;
    tooManyChapters: string;
    badChapter: string;
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
    suggestedBy?: string;
    done?: boolean;
    /** Links showing a done item was completed (up to 3). The editor shows them as a trailing " | ev: url url" segment. */
    evidence?: Evidence[];
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

export const MAX_LIST = 30;

const BY = "by: ";
/** A done item's line starts with this marker in the editor; the checkbox under the box toggles it. */
export const DONE = "[x] ";
/** An open item whose own text starts like a marker ("[x] ", "[ ] ", or already-escaped) gets a leading backslash so it is not read back as done. */
const MARKER_LIKE = /^\\*\[[xX ]\]\s/;
function escapeMarker(text: string): string {
    return MARKER_LIKE.test(text) ? `\\${text}` : text;
}
function unescapeMarker(text: string): string {
    return /^\\+\[[xX ]\]\s/.test(text) ? text.slice(1) : text;
}
const EV = " | ev:";
/** The evidence tail of a line ("... | ev: url url", the final segment, every token a valid URL) split off, or null when the line has none. */
function splitEvidence(line: string): { rest: string; evidence: Evidence[] } | null {
    const at = line.lastIndexOf(EV);
    if (at === -1 || line.indexOf(" | ", at + 3) !== -1) return null;
    const tail = line.slice(at + EV.length);
    if (tail && !/^\s/.test(tail)) return null;
    const tokens = tail.split(/\s+/).filter(Boolean);
    if (!tokens.every((t) => safeEvidenceUrl(t))) return null;
    return { rest: line.slice(0, at).trim(), evidence: parseEvidenceInput(tail, false) };
}
/** The line without its evidence tail (unticking an item drops its links). */
export function stripEvidence(line: string): string {
    return splitEvidence(line)?.rest ?? line;
}
/** "text | owner | by: suggester | ev: url url" per line; owner and suggester are optional. A final " | by: NAME" is the suggester, then whatever follows the last " | " is the owner. */
export function formatActionItems(items: ActionItem[]): string {
    return items
        .map((i) => {
            const ev = (i.evidence ?? []).slice(0, MAX_EVIDENCE).map((e) => e.url);
            const body = [escapeMarker(i.text), i.owner, i.suggestedBy ? `${BY}${i.suggestedBy}` : ""].filter(Boolean).join(" | ");
            // Text that already ends like an evidence segment gets an empty "| ev:" so it is not read back as evidence.
            const tail = ev.length ? `${EV} ${ev.join(" ")}` : splitEvidence(body) ? EV : "";
            return (i.done ? DONE : "") + body + tail;
        })
        .join("\n");
}
export function parseActionItems(raw: string): ActionItem[] {
    return raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
            let rest = l;
            const done = /^\[x\]\s/i.test(rest);
            if (done) rest = rest.slice(DONE.length).trim();
            const ev = splitEvidence(rest);
            if (ev) rest = ev.rest;
            let suggestedBy = "";
            const byAt = rest.lastIndexOf(` | ${BY}`);
            // Only the FINAL segment counts as the suggester; a " | by: " followed by more segments is part of the text.
            if (byAt !== -1 && rest.indexOf(" | ", byAt + 3) === -1) {
                suggestedBy = rest.slice(byAt + 3 + BY.length).trim();
                rest = rest.slice(0, byAt).trim();
            }
            const at = rest.lastIndexOf(" | ");
            const owner = at === -1 ? "" : rest.slice(at + 3).trim();
            const text = unescapeMarker((at === -1 ? rest : rest.slice(0, at)).trim());
            return { text, ...(owner ? { owner } : {}), ...(suggestedBy ? { suggestedBy } : {}), ...(done ? { done: true } : {}), ...(ev?.evidence.length ? { evidence: ev.evidence } : {}) };
        })
        .filter((i) => i.text);
}
/** "m:ss Title" or "h:mm:ss Title" per line. */
export function formatChapters(chapters: Chapter[]): string {
    return chapters.map((c) => `${clock(c.startMs)} ${c.title}`).join("\n");
}
const CHAPTER_LINE = /^(\d+(?::\d{1,2}){1,2})\s+(.+)$/;
export function parseChapters(raw: string): Chapter[] {
    const out: Chapter[] = [];
    for (const line of raw.split("\n")) {
        const m = line.trim().match(CHAPTER_LINE);
        if (!m) continue;
        const parts = m[1].split(":").map(Number);
        const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
        out.push({ startMs: sec * 1000, title: m[2].trim() });
    }
    return out;
}
/** Non-empty chapter lines that do not start with a time. */
export function invalidChapterLines(raw: string): string[] {
    return raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !CHAPTER_LINE.test(l));
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
    const [problem, setProblem] = useState<string | null>(null);
    const published = status === "PUBLISHED";
    const base = `/api/admin/calls/${recordingId}`;
    const json = { "Content-Type": "application/json" };
    const canPublish = summary.trim().length > 0;
    const dirty =
        title !== initialTitle ||
        summary !== initialSummary ||
        actionItems !== formatActionItems(initialActionItems) ||
        chapters !== formatChapters(initialChapters);
    useEffect(() => {
        setReviewDirty(dirty);
        return () => setReviewDirty(false);
    }, [dirty]);

    /** Flip the done marker on line i of the action-items box (the checkboxes under it). */
    function toggleDone(i: number) {
        const lines = actionItems.split("\n").filter((l) => l.trim());
        const l = lines[i].trim();
        lines[i] = /^\[x\]\s/i.test(l) ? stripEvidence(l.slice(DONE.length).trim()) : DONE + l;
        setActionItems(lines.join("\n"));
    }

    /** Replace the evidence links on line i (the input under its checkbox). */
    function setEvidence(i: number, raw: string) {
        const lines = actionItems.split("\n").filter((l) => l.trim());
        const items = parseActionItems(actionItems);
        lines[i] = formatActionItems([{ ...items[i], evidence: parseEvidenceInput(raw), done: false }]).split("\n")[0];
        if (items[i].done) lines[i] = DONE + lines[i];
        setActionItems(lines.join("\n"));
    }

    /** A clear message for input we can see is invalid, instead of a generic failure. */
    function validate(): string | null {
        if (parseActionItems(actionItems).length > MAX_LIST) return labels.tooManyItems;
        if (parseChapters(chapters).length > MAX_LIST) return labels.tooManyChapters;
        const bad = invalidChapterLines(chapters);
        if (bad.length > 0) return labels.badChapter.replace("{line}", bad[0]);
        return null;
    }

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
        setProblem(null);
        setMessage(null);
        if (kind === "save" || (kind === "publish" && !published)) {
            const invalid = validate();
            if (invalid) return setProblem(invalid);
        }
        setBusy(kind);
        try {
            for (const step of steps) {
                const res = await step();
                if (!res.ok) {
                    if (res.status === 400) {
                        const body = (await res.json().catch(() => null)) as { error?: string } | null;
                        if (body?.error) setProblem(body.error);
                    }
                    throw new Error(String(res.status));
                }
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
            {parseActionItems(actionItems).length > 0 && (
                <div className="grid gap-1">
                    {parseActionItems(actionItems).map((it, i) => (
                        <div key={i} className="grid gap-1">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={!!it.done} onChange={() => toggleDone(i)} aria-label={`${labels.actionItemDone}: ${it.text}`} />
                                <span className={it.done ? "text-foreground/60" : undefined}>{it.text}</span>
                            </label>
                            {it.done && (
                                <input
                                    key={(it.evidence ?? []).map((e) => e.url).join(" ")}
                                    type="text"
                                    defaultValue={(it.evidence ?? []).map((e) => e.url).join(" ")}
                                    onBlur={(e) => setEvidence(i, e.target.value)}
                                    placeholder={labels.actionItemEvidence}
                                    aria-label={`${labels.actionItemEvidence}: ${it.text}`}
                                    className={`${field} ml-6 text-xs`}
                                    style={fieldStyle}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}
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
            {problem && <p className="m-0 text-sm text-tomato" role="alert">{problem}</p>}
            {message === "error" && !problem && <p className="m-0 text-sm text-tomato" role="alert">{labels.error}</p>}
        </div>
    );
}
