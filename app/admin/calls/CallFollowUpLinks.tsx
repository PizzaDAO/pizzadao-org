"use client";

// app/admin/calls/CallFollowUpLinks.tsx
//
// Which action item each follow-up of this call is about, and its finished-work link. Linked
// follow-ups drive the in-progress / done marks in the recap; a reviewer can relink, unlink (the
// override when a member's status is wrong) and clear a link that was added.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface LinkRow {
    id: string;
    owner: string;
    ask: string;
    /** Translated status text. */
    status: string;
    actionKey: string | null;
    doneUrl: string | null;
}
export interface LinkItem {
    key: string;
    /** "A1", "A2", ... (the label the drafting model was given). */
    label: string;
    text: string;
}
export interface LinkLabels {
    actionItem: string;
    none: string;
    doneUrl: string;
    save: string;
    clear: string;
    working: string;
    error: string;
    saved: string;
}

const border = { borderColor: "hsl(var(--rule-warm) / 0.65)" };

/** The fields that differ from what is stored, as the PATCH body (empty when nothing changed). */
export function linkPatch(row: Pick<LinkRow, "actionKey" | "doneUrl">, actionKey: string, doneUrl: string): Record<string, string | null> {
    const patch: Record<string, string | null> = {};
    if ((actionKey || null) !== row.actionKey) patch.actionKey = actionKey || null;
    if ((doneUrl.trim() || null) !== row.doneUrl) patch.doneUrl = doneUrl.trim() || null;
    return patch;
}

function Row({ row, items, labels }: { row: LinkRow; items: LinkItem[]; labels: LinkLabels }) {
    const router = useRouter();
    const [actionKey, setActionKey] = useState(row.actionKey ?? "");
    const [doneUrl, setDoneUrl] = useState(row.doneUrl ?? "");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    async function send(body: Record<string, string | null>) {
        if (Object.keys(body).length === 0) return;
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/admin/followups/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
                setMessage({ text: data.error || labels.error, error: true });
                return;
            }
            setMessage({ text: labels.saved, error: false });
            router.refresh();
        } catch {
            setMessage({ text: labels.error, error: true });
        } finally {
            setBusy(false);
        }
    }

    return (
        <li className="grid gap-2 rounded-xl border p-3" style={border}>
            <p className="m-0 text-sm">
                <strong>{row.owner}</strong> <span className="text-foreground/60">({row.status})</span>
            </p>
            <p className="m-0 text-sm text-foreground/70">{row.ask}</p>
            <label className="grid gap-1 text-sm">
                <span className="font-semibold">{labels.actionItem}</span>
                <select value={actionKey} onChange={(e) => setActionKey(e.target.value)} className="min-h-11 rounded-xl border bg-card p-2" style={border}>
                    <option value="">{labels.none}</option>
                    {items.map((it) => (
                        <option key={it.key} value={it.key}>
                            {it.label}: {it.text.slice(0, 80)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="grid gap-1 text-sm">
                <span className="font-semibold">{labels.doneUrl}</span>
                <input type="url" value={doneUrl} onChange={(e) => setDoneUrl(e.target.value)} maxLength={500} className="min-h-11 rounded-xl border bg-card p-2" style={border} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => send(linkPatch(row, actionKey, doneUrl))} className="min-h-11 rounded-xl border px-4 font-semibold" style={border}>
                    {busy ? labels.working : labels.save}
                </button>
                {row.doneUrl && (
                    <button type="button" disabled={busy} onClick={() => send({ doneUrl: null })} className="min-h-11 rounded-xl border px-4 font-semibold" style={border}>
                        {labels.clear}
                    </button>
                )}
                {message && (
                    <span role={message.error ? "alert" : "status"} className={message.error ? "text-tomato text-sm" : "text-foreground/70 text-sm"}>
                        {message.text}
                    </span>
                )}
            </div>
        </li>
    );
}

export function CallFollowUpLinks({ rows, items, labels }: { rows: LinkRow[]; items: LinkItem[]; labels: LinkLabels }) {
    return (
        <ul className="m-0 grid list-none gap-3 p-0">
            {rows.map((r) => (
                <Row key={`${r.id}:${r.actionKey ?? ""}:${r.doneUrl ?? ""}`} row={r} items={items} labels={labels} />
            ))}
        </ul>
    );
}
