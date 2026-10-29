"use client";

// app/admin/followups/FollowUpQueue.tsx
//
// The follow-up approval queue. Rows are grouped by call; each shows the person, the channel, an
// editable message, the source quote and the audit timeline. Approving is the only way a message is
// ever sent. All data comes from the call-reviewer-gated /api/admin/followups routes.

import { useCallback, useEffect, useMemo, useState } from "react";

export type QueueLabels = Record<string, string>;

interface EventRow {
    id: number;
    type: string;
    actorId: string | null;
    data: Record<string, unknown> | null;
    createdAt: string;
}

interface Candidate {
    memberId: string;
    name: string;
    discordId: string;
}

interface Item {
    id: string;
    recordingId: string | null;
    ownerName: string;
    ownerDiscordId: string | null;
    ownerMemberId: string | null;
    candidates: Candidate[] | null;
    kind: string;
    ask: string;
    message: string;
    quote: string | null;
    startMs: number | null;
    dueAt: string | null;
    dueText: string | null;
    status: string;
    channel: "DISCORD" | "TELEGRAM" | null;
    escalateOnly: boolean;
    sendAfter: string | null;
    lastReply: string | null;
    error: string | null;
    telegramLinked: boolean;
    telegramDmAllowed: boolean;
    optedOut: boolean;
    call: { id: string; title: string | null; eventName: string | null; crewLabel: string | null; startedAt: string } | null;
    events: EventRow[];
    updatedAt: string;
}

interface Payload {
    items: Item[];
    reach: { people: number; telegram: number };
    sendEnabled: boolean;
    footerTelegram: string;
    footerDiscord: string;
}

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
const EDITABLE = ["DRAFT", "FAILED", "UNREACHABLE"];
const OPEN_FILTER = "DRAFT,APPROVED,FAILED,UNREACHABLE,NEEDS_HELP,REPLIED";
const SENT_FILTER = "SENT,ESCALATED,REPLIED,IN_PROGRESS,NEEDS_HELP,DONE";
const border = { borderColor: "hsl(var(--rule-warm) / 0.55)" };

async function api(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
    });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function Row({ item, labels, footers, onChanged }: { item: Item; labels: QueueLabels; footers: { TELEGRAM: string; DISCORD: string }; onChanged: () => void }) {
    const editable = EDITABLE.includes(item.status);
    const [message, setMessage] = useState(item.message);
    const [due, setDue] = useState(item.dueAt ? item.dueAt.slice(0, 10) : "");
    const [channel, setChannel] = useState<string>(item.channel ?? "");
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [q, setQ] = useState("");
    const [found, setFound] = useState<Candidate[]>([]);
    const [showTimeline, setShowTimeline] = useState(false);

    const dirty = message !== item.message || due !== (item.dueAt ? item.dueAt.slice(0, 10) : "") || channel !== (item.channel ?? "");
    const defaultChannel = item.telegramDmAllowed ? labels.channelTelegram : labels.channelDiscord;
    const effective: "TELEGRAM" | "DISCORD" = channel === "TELEGRAM" || channel === "DISCORD" ? channel : item.telegramDmAllowed ? "TELEGRAM" : "DISCORD";
    const footer = footers[effective];

    async function run(key: string, fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>) {
        setError(null);
        setBusy(key);
        const r = await fn();
        setBusy(null);
        if (!r.ok) return setError(typeof r.data.error === "string" ? r.data.error : labels.errorGeneric);
        onChanged();
    }

    const save = () =>
        run("save", () =>
            api("PATCH", `/api/admin/followups/${item.id}`, {
                message,
                dueAt: due ? new Date(`${due}T12:00:00Z`).toISOString() : null,
                channel: channel || null,
            }),
        );
    const act = (action: string, expectedUpdatedAt?: string) => run(action, () => api("POST", `/api/admin/followups/${item.id}`, { action, expectedUpdatedAt: expectedUpdatedAt ?? item.updatedAt }));
    const pick = (memberId: string) => run("pick", () => api("PATCH", `/api/admin/followups/${item.id}`, { ownerMemberId: memberId }));

    async function approve(action: "approve" | "approve-escalate") {
        // Save pending edits first so what is approved is what the reviewer sees.
        let version = item.updatedAt;
        if (dirty) {
            const r = await api("PATCH", `/api/admin/followups/${item.id}`, { message, dueAt: due ? new Date(`${due}T12:00:00Z`).toISOString() : null, channel: channel || null });
            if (!r.ok) return setError(typeof r.data.error === "string" ? r.data.error : labels.errorGeneric);
            if (typeof r.data.updatedAt === "string") version = r.data.updatedAt;
        }
        await act(action, version);
    }

    async function search(value: string) {
        setQ(value);
        if (value.trim().length < 2) return setFound([]);
        const r = await api("GET", `/api/admin/followups/members?q=${encodeURIComponent(value.trim())}`);
        setFound(r.ok ? ((r.data.members as Candidate[]) ?? []) : []);
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(`${message}\n\n${footer}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable */
        }
    }

    const needsPerson = !item.ownerDiscordId;
    const candidates = item.candidates ?? [];

    return (
        <li className="grid gap-3 rounded-2xl border p-4" style={border}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-base font-bold">
                    {item.ownerName}
                    {item.ownerDiscordId ? "" : <span className="ml-2 rounded bg-tomato/15 px-1.5 py-0.5 text-xs text-tomato">{candidates.length ? labels.ambiguous : labels.unresolved}</span>}
                    {item.optedOut && <span className="ml-2 rounded bg-tomato/15 px-1.5 py-0.5 text-xs text-tomato">{labels.optedOut}</span>}
                </h3>
                <span className="text-xs text-foreground/60">{labels[`status.${item.status}`] ?? item.status}</span>
            </div>
            <p className="m-0 text-sm text-foreground/80">{item.ask}</p>
            {item.quote && (
                <blockquote className="m-0 border-l-2 pl-3 text-sm text-foreground/60" style={border}>
                    {item.quote}
                    {item.call && item.startMs !== null && (
                        <>
                            {" "}
                            <a className="underline" href={`/admin/calls/${item.call.id}`}>{labels.openCall}</a>
                        </>
                    )}
                </blockquote>
            )}

            {editable && needsPerson && (
                <div className="grid gap-2 rounded-xl border p-3 text-sm" style={border}>
                    <strong>{labels.pickPerson}</strong>
                    {candidates.length > 0 && (
                        <span className="flex flex-wrap gap-2">
                            {candidates.map((c) => (
                                <button key={c.memberId} type="button" disabled={!!busy} onClick={() => pick(c.memberId)} className="rounded-lg border px-3 py-1" style={border}>
                                    {c.name}
                                </button>
                            ))}
                        </span>
                    )}
                    <input type="search" value={q} onChange={(e) => void search(e.target.value)} placeholder={labels.searchPlaceholder} aria-label={labels.searchPlaceholder} className="rounded-lg border bg-background px-2 py-1" style={border} />
                    {found.length > 0 && (
                        <span className="flex flex-wrap gap-2">
                            {found.map((c) => (
                                <button key={c.memberId} type="button" disabled={!!busy} onClick={() => pick(c.memberId)} className="rounded-lg border px-3 py-1" style={border}>
                                    {c.name}
                                </button>
                            ))}
                        </span>
                    )}
                    <button type="button" disabled={!!busy} onClick={() => act("reresolve")} className="w-fit rounded-lg border px-3 py-1" style={border}>
                        {labels.reresolve}
                    </button>
                </div>
            )}

            <label className="grid gap-1 text-sm">
                <span className="text-foreground/60">{labels.message}</span>
                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={!editable}
                    rows={4}
                    maxLength={1500}
                    className="w-full rounded-lg border bg-background p-2 disabled:opacity-70"
                    style={border}
                />
            </label>
            <p className="m-0 text-xs text-foreground/50">{fill(labels.footerNote, { footer })}</p>

            <div className="flex flex-wrap items-end gap-4 text-sm">
                <label className="grid gap-1">
                    <span className="text-foreground/60">{labels.channel}</span>
                    <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!editable} className="rounded-lg border bg-background px-2 py-1" style={border}>
                        <option value="">{fill(labels.channelDefault, { channel: defaultChannel })}</option>
                        <option value="DISCORD">{labels.channelDiscord}</option>
                        <option value="TELEGRAM" disabled={!item.telegramDmAllowed}>{labels.channelTelegram}</option>
                    </select>
                </label>
                <label className="grid gap-1">
                    <span className="text-foreground/60">{labels.due}{item.dueText ? ` (${item.dueText})` : ""}</span>
                    <input type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={!editable} className="rounded-lg border bg-background px-2 py-1" style={border} />
                </label>
            </div>

            {item.lastReply && <p className="m-0 rounded-lg bg-foreground/5 p-2 text-sm"><strong>{labels.reply}:</strong> {item.lastReply}</p>}
            {item.error && <p className="m-0 text-sm text-tomato">{item.error}</p>}
            {item.status === "APPROVED" && item.sendAfter && <p className="m-0 text-xs text-foreground/60">{fill(labels.scheduled, { when: new Date(item.sendAfter).toLocaleString() })}</p>}

            <div className="flex flex-wrap items-center gap-2 text-sm">
                {editable && (
                    <>
                        <button type="button" disabled={!!busy || needsPerson} onClick={() => approve("approve")} className="rounded-lg bg-tomato px-3 py-1.5 font-bold text-white disabled:opacity-40">
                            {busy === "approve" ? labels.working : labels.approve}
                        </button>
                        {needsPerson && (
                            <button type="button" disabled={!!busy} onClick={() => approve("approve-escalate")} className="rounded-lg border px-3 py-1.5" style={border}>
                                {labels.approveEscalate}
                            </button>
                        )}
                        <button type="button" disabled={!!busy || !dirty} onClick={save} className="rounded-lg border px-3 py-1.5 disabled:opacity-40" style={border}>
                            {busy === "save" ? labels.working : labels.save}
                        </button>
                    </>
                )}
                <button type="button" onClick={copy} className="rounded-lg border px-3 py-1.5" style={border}>
                    {copied ? labels.copied : labels.copy}
                </button>
                {item.status !== "DISMISSED" && item.status !== "DONE" && (
                    <button type="button" disabled={!!busy} onClick={() => act("dismiss")} className="rounded-lg border px-3 py-1.5" style={border}>
                        {labels.dismiss}
                    </button>
                )}
                <button type="button" onClick={() => setShowTimeline((v) => !v)} className="text-xs underline">
                    {showTimeline ? labels.hideTimeline : labels.timeline}
                </button>
            </div>
            {error && <p role="alert" className="m-0 text-sm text-tomato">{error}</p>}
            {showTimeline && (
                <ul className="m-0 grid list-none gap-1 p-0 text-xs text-foreground/70">
                    {item.events.map((e) => (
                        <li key={e.id}>
                            {new Date(e.createdAt).toLocaleString()} - {labels[`event.${e.type}`] ?? e.type}
                            {typeof e.data?.channel === "string" ? ` (${e.data.channel})` : ""}
                            {typeof e.data?.reason === "string" ? ` (${e.data.reason})` : ""}
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

export function FollowUpQueue({ labels }: { labels: QueueLabels }) {
    const [filter, setFilter] = useState<"open" | "sent" | "all">("open");
    const [data, setData] = useState<Payload | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        const qs = filter === "open" ? `?status=${OPEN_FILTER}` : filter === "sent" ? `?status=${SENT_FILTER}` : "";
        const r = await api("GET", `/api/admin/followups${qs}`);
        if (!r.ok) return setFailed(true);
        setFailed(false);
        setData(r.data as unknown as Payload);
    }, [filter]);

    useEffect(() => {
        void load();
    }, [load]);

    const groups = useMemo(() => {
        const map = new Map<string, { title: string; items: Item[] }>();
        for (const it of data?.items ?? []) {
            const key = it.recordingId ?? "manual";
            const title = it.call ? `${it.call.title ?? it.call.eventName ?? labels.untitledCall}${it.call.crewLabel ? ` - ${it.call.crewLabel}` : ""}` : labels.untitledCall;
            if (!map.has(key)) map.set(key, { title, items: [] });
            map.get(key)!.items.push(it);
        }
        return [...map.entries()];
    }, [data, labels.untitledCall]);

    if (failed) return <p role="alert" className="text-tomato">{labels.loadError}</p>;
    if (!data) return null;

    return (
        <div className="grid gap-5">
            <p className="m-0 rounded-xl border p-3 text-sm font-bold" style={{ borderColor: data.sendEnabled ? "hsl(var(--rule-warm) / 0.55)" : "tomato" }}>
                {data.sendEnabled ? labels.sendingOn : labels.sendingOff}
            </p>
            {data.reach.people > 0 && <p className="m-0 text-sm text-foreground/70">{fill(labels.reach, { telegram: data.reach.telegram, people: data.reach.people })}</p>}
            <div className="flex flex-wrap gap-2 text-sm">
                {(["open", "sent", "all"] as const).map((f) => (
                    <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className="rounded-lg border px-3 py-1" style={{ ...border, fontWeight: filter === f ? 700 : 400 }}>
                        {labels[`filter.${f}`]}
                    </button>
                ))}
            </div>
            {groups.length === 0 && <p className="m-0 text-foreground/60">{labels.empty}</p>}
            {groups.map(([key, g]) => (
                <section key={key} className="grid gap-3">
                    <h2 className="m-0 font-[family-name:var(--font-display)] text-lg font-black">{g.title}</h2>
                    <ul className="m-0 grid list-none gap-3 p-0">
                        {g.items.map((it) => (
                            <Row key={`${it.id}:${it.updatedAt}`} item={it} labels={labels} footers={{ TELEGRAM: data.footerTelegram, DISCORD: data.footerDiscord }} onChanged={load} />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
