"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Flag = { id: string; severity: "high" | "medium" | "low" | "info" };
type Item = {
    id: string;
    title: string;
    requesterLabel: string;
    kind: string;
    status: string;
    lane: string;
    amountUsd: number;
    riskScore: number;
    flags: Flag[];
    createdAt: string;
    dueAt: string;
    overdue: boolean;
    approvals: number;
    approvalsNeeded: number;
};
type Data = {
    items: Item[];
    total: number;
    hashConfigured: boolean;
    canMarkPaid: boolean;
    isDpr: boolean;
    degraded: boolean;
    ingest: { enabled: boolean; status: { at: string; ok: boolean; error?: string; warning?: string; created: number } | null; sheetConfigured?: boolean };
};

const LANE_LABEL: Record<string, string> = { FAST: "Fast", STANDARD: "Standard", HIGH_RISK: "High risk", VOTE_REQUIRED: "Needs vote" };
const SEV_CLASS: Record<string, string> = {
    high: "bg-[hsl(var(--tomato)/0.18)] text-tomato",
    medium: "bg-[hsl(var(--butter)/0.4)]",
    low: "bg-[hsl(var(--ink)/0.08)]",
    info: "bg-[hsl(var(--ink)/0.05)]",
};
const FILTERS = [
    ["open", "Open"],
    ["approved", "Approved, to pay"],
    ["closed", "Closed"],
] as const;

export function PaymentsQueue() {
    const [filter, setFilter] = useState<"open" | "approved" | "closed">("open");
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState("");
    const [sheetId, setSheetId] = useState("");
    const [configMsg, setConfigMsg] = useState("");
    const [ingestFrom, setIngestFromValue] = useState("");

    const load = useCallback(async () => {
        setError("");
        try {
            const r = await fetch(`/api/admin/payments?filter=${filter}`, { cache: "no-store" });
            if (!r.ok) throw new Error();
            setData(await r.json());
        } catch {
            setError("Could not load the queue.");
        }
    }, [filter]);

    useEffect(() => {
        void load();
    }, [load]);

    async function saveSheet() {
        setConfigMsg("");
        const r = await fetch("/api/admin/payments/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formSheetId: sheetId }),
        });
        setConfigMsg(r.ok ? (sheetId.trim() ? "Saved." : "Cleared; ingest is off.") : "Could not save (check the id).");
        setSheetId("");
        void load();
    }

    async function saveFrom() {
        setConfigMsg("");
        const r = await fetch("/api/admin/payments/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ingestFrom: new Date(ingestFrom).toISOString() }),
        }).catch(() => null);
        setConfigMsg(r?.ok ? "Saved." : "Could not save (use a valid date).");
    }

    return (
        <section className="grid gap-4">
            {data?.degraded && (
                <p className="m-0 rounded p-3 bg-[hsl(var(--butter)/0.4)]">
                    Settings could not be read cleanly. Nothing is fast-tracked and everything waits for a human.
                </p>
            )}
            {data && !data.hashConfigured && (
                <p className="m-0 rounded p-3 bg-[hsl(var(--butter)/0.4)]">
                    Payee fingerprints are off (no hash secret is set): payees are not stored and reuse of one payee by several people is not checked.
                </p>
            )}
            {data && data.total > data.items.length && (
                <p className="m-0 rounded p-3 bg-[hsl(var(--butter)/0.4)]">
                    Showing the newest {data.items.length} of {data.total}.
                </p>
            )}
            {data?.ingest.status?.ok && data.ingest.status.warning && <p className="m-0 rounded p-3 bg-[hsl(var(--butter)/0.4)]">Form ingest: {data.ingest.status.warning}</p>}
            {data?.ingest.status && !data.ingest.status.ok && (
                <p className="m-0 rounded p-3 bg-[hsl(var(--tomato)/0.15)]">Form ingest: {data.ingest.status.error}</p>
            )}
            <div className="flex flex-wrap gap-2 items-center">
                {FILTERS.map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setFilter(key)}
                        aria-pressed={filter === key}
                        className={`min-h-9 px-3 rounded-full border text-sm ${filter === key ? "bg-foreground text-background" : "bg-card"}`}
                    >
                        {label}
                    </button>
                ))}
                {data?.isDpr && (
                    <Link href="/api/admin/payments/export" prefetch={false} className="ml-auto underline text-sm">
                        Export approved and paid (CSV)
                    </Link>
                )}
            </div>

            {error && <p className="m-0 text-tomato">{error}</p>}
            {!data && !error && <p className="m-0 text-foreground/60">Loading...</p>}
            {data && data.items.length === 0 && <p className="m-0 text-foreground/60">Nothing here.</p>}

            <ul className="m-0 p-0 list-none grid gap-2">
                {data?.items.map((i) => (
                    <li key={i.id}>
                        <Link href={`/admin/payments/${i.id}`} className="block rounded border border-[hsl(var(--rule-warm)/0.55)] bg-card p-3 no-underline text-inherit hover:border-[hsl(var(--tomato)/0.6)]">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <strong>{i.title}</strong>
                                <span className="text-sm text-foreground/70">{i.requesterLabel}</span>
                                <span className="ml-auto tabular-nums">${i.amountUsd.toLocaleString("en-US")}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs items-center">
                                <span className="rounded-full px-2 py-0.5 bg-[hsl(var(--ink)/0.1)]">{LANE_LABEL[i.lane] ?? i.lane}</span>
                                <span>{i.kind.toLowerCase().replace("_", " ")}</span>
                                <span>risk {i.riskScore}</span>
                                <span>
                                    approvals {i.approvals}/{i.approvalsNeeded}
                                </span>
                                {filter === "open" && (
                                    <span className={i.overdue ? "text-tomato font-semibold" : ""}>
                                        {i.overdue ? "overdue since" : "due"} {new Date(i.dueAt).toLocaleString()}
                                    </span>
                                )}
                                {i.flags.map((f) => (
                                    <span key={f.id} className={`rounded px-1.5 py-0.5 ${SEV_CLASS[f.severity]}`}>
                                        {f.id.replace(/_/g, " ")}
                                    </span>
                                ))}
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>

            {data?.isDpr && (
                <details className="rounded border border-[hsl(var(--rule-warm)/0.55)] p-3">
                    <summary className="cursor-pointer">Form ingest setup (top role only)</summary>
                    <div className="mt-3 grid gap-2 text-sm">
                        <p className="m-0">
                            Responses sheet: {data.ingest.sheetConfigured ? "set" : "not set"}. Ingest runs only when the setting &quot;Form ingest on&quot; is 1, the sheet is shared with the service account, and the sheet id is set. The id is stored in the database, never shown again.
                        </p>
                        {data.ingest.status && (
                            <p className="m-0">
                                Last run {new Date(data.ingest.status.at).toLocaleString()}: {data.ingest.status.ok ? `${data.ingest.status.created} new` : data.ingest.status.error}
                            </p>
                        )}
                        <div className="flex gap-2 flex-wrap">
                            <input
                                value={sheetId}
                                onChange={(e) => setSheetId(e.target.value)}
                                placeholder="Sheet id (leave empty to clear)"
                                className="min-h-10 px-3 rounded border flex-1 min-w-[16rem] bg-card"
                                autoComplete="off"
                            />
                            <button type="button" onClick={saveSheet} className="min-h-10 px-4 rounded bg-foreground text-background">
                                Save
                            </button>
                        </div>
                        <p className="m-0">
                            Only responses submitted at or after the &quot;ingest from&quot; moment are imported. If you do not set one, it is the moment ingest first runs.
                        </p>
                        <div className="flex gap-2 flex-wrap">
                            <input type="datetime-local" value={ingestFrom} onChange={(e) => setIngestFromValue(e.target.value)} className="min-h-10 px-3 rounded border bg-card" />
                            <button type="button" onClick={saveFrom} disabled={!ingestFrom} className="min-h-10 px-4 rounded border">
                                Set ingest from
                            </button>
                        </div>
                        {configMsg && <p className="m-0">{configMsg}</p>}
                    </div>
                </details>
            )}
        </section>
    );
}
