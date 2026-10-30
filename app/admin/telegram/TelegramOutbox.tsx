"use client";

// app/admin/telegram/TelegramOutbox.tsx
//
// The city Telegram mirror outbox: switch status, the last 100 queued posts (with a Skip action for
// waiting ones), warnings about configured city keys, and the rsv.pizza city directory. All data
// comes from the Dread Pizza Roberts-only /api/admin/telegram routes.

import { useCallback, useEffect, useState } from "react";

export type OutboxLabels = Record<string, string>;

interface Row {
    id: string;
    kind: string;
    crewId: string | null;
    cityKey: string;
    text: string;
    status: string;
    code: string | null;
    attempts: number;
    createdAt: string;
    sendAfter: string | null;
    sentAt: string | null;
    expiresAt: string;
}

interface Overview {
    status: {
        keyConfigured: boolean;
        killed: boolean;
        sendAllowed: boolean;
        production: boolean;
        cityPostsOn: boolean;
        recapOn: boolean;
        agendaOn: boolean;
        announceOn: boolean;
        directory: string;
    };
    rows: Row[];
    directory: Array<{ cityKey: string; title: string | null; country: string | null; region: string | null; hasChat: boolean }>;
    warnings: Array<{ source: "crew" | "announce"; crewId?: string; cityKey: string; problem: "unknown" | "no_chat" }>;
}

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

export function TelegramOutbox({ labels }: { labels: OutboxLabels }) {
    const [data, setData] = useState<Overview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/telegram", { cache: "no-store" });
            if (!res.ok) throw new Error(String(res.status));
            setData((await res.json()) as Overview);
            setError(null);
        } catch {
            setError(labels.loadError);
        }
    }, [labels.loadError]);

    useEffect(() => {
        void load();
    }, [load]);

    async function skip(id: string) {
        setBusy(id);
        try {
            const res = await fetch(`/api/admin/telegram/${encodeURIComponent(id)}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "skip" }),
            });
            if (!res.ok && res.status !== 409) throw new Error(String(res.status));
            await load();
        } catch {
            setError(labels.errorGeneric);
        } finally {
            setBusy(null);
        }
    }

    const reason = (code: string | null) => (code ? labels[`code.${code}`] ?? code : "");

    if (!data) return <p className="m-0 text-foreground/70">{error ?? labels.working}</p>;
    const s = data.status;
    const yesNo = (v: boolean) => (v ? labels.on : labels.off);

    return (
        <div className="grid gap-6">
            {error && <p className="m-0 text-tomato">{error}</p>}

            <section className="grid gap-2">
                <h2 className="m-0 text-xl font-black">{labels.statusTitle}</h2>
                <ul className="m-0 grid gap-1 pl-5 text-sm">
                    <li>{fill(labels.statusSend, { value: s.sendAllowed ? labels.sendYes : !s.production ? labels.sendPreview : !s.keyConfigured ? labels.sendNoKey : s.killed ? labels.sendKilled : labels.sendNo })}</li>
                    <li>{fill(labels.statusSwitches, { master: yesNo(s.cityPostsOn), recap: yesNo(s.recapOn), agenda: yesNo(s.agendaOn), announce: yesNo(s.announceOn) })}</li>
                    <li>{fill(labels.statusDirectory, { value: s.directory === "ok" ? labels.dirOk : labels[`code.${s.directory}`] ?? s.directory })}</li>
                </ul>
            </section>

            {data.warnings.length > 0 && (
                <section className="grid gap-2">
                    <h2 className="m-0 text-xl font-black">{labels.warnTitle}</h2>
                    <ul className="m-0 grid gap-1 pl-5 text-sm text-tomato">
                        {data.warnings.map((w, i) => (
                            <li key={i}>
                                {fill(w.problem === "unknown" ? labels.warnUnknown : labels.warnNoChat, {
                                    city: w.cityKey,
                                    where: w.source === "crew" ? fill(labels.warnCrew, { crew: w.crewId ?? "" }) : labels.warnAnnounce,
                                })}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="grid gap-2">
                <h2 className="m-0 text-xl font-black">{labels.outboxTitle}</h2>
                {data.rows.length === 0 ? (
                    <p className="m-0 text-foreground/70">{labels.empty}</p>
                ) : (
                    <ul className="m-0 grid list-none gap-2 p-0">
                        {data.rows.map((r) => (
                            <li key={r.id} className="grid gap-1 rounded border border-foreground/15 p-3 text-sm">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <strong>{r.cityKey}</strong>
                                    <span>{labels[`kind.${r.kind}`] ?? r.kind}</span>
                                    <span>{labels[`status.${r.status}`] ?? r.status}</span>
                                    {r.code && <span className="text-foreground/70">{reason(r.code)}</span>}
                                    <span className="text-foreground/60">{when(r.sentAt ?? r.createdAt)}</span>
                                    {r.status === "PENDING" && (
                                        <button type="button" className="underline" disabled={busy === r.id} onClick={() => skip(r.id)}>
                                            {busy === r.id ? labels.working : labels.skip}
                                        </button>
                                    )}
                                    <button type="button" className="underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                                        {open === r.id ? labels.hideText : labels.showText}
                                    </button>
                                </div>
                                {open === r.id && <pre className="m-0 whitespace-pre-wrap text-foreground/80">{r.text}</pre>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="grid gap-2">
                <h2 className="m-0 text-xl font-black">{labels.directoryTitle}</h2>
                {data.directory.length === 0 ? (
                    <p className="m-0 text-foreground/70">{labels.directoryEmpty}</p>
                ) : (
                    <ul className="m-0 grid gap-1 pl-5 text-sm">
                        {data.directory.map((g) => (
                            <li key={g.cityKey}>
                                {g.cityKey}
                                {g.title ? ` (${g.title})` : ""} {g.hasChat ? "" : `- ${labels.noChat}`}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
