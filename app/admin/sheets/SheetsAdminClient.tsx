"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SheetsOverview, RunView } from "@/app/lib/sheets-import/admin";
import type { ImportReport, ParityReport } from "@/app/lib/sheets-import/framework";

type Result = { kind: "report"; report: ImportReport } | { kind: "parity"; parity: ParityReport } | { kind: "error"; message: string };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && !(body && typeof body === "object" && "dataset" in body)) throw new Error(body?.error || `HTTP ${res.status}`);
    return body as T;
}

function Counts({ counts }: { counts: Record<string, number> }) {
    const entries = Object.entries(counts).filter(([, v]) => typeof v === "number");
    return (
        <span className="text-sm">
            {entries.map(([k, v]) => (
                <span key={k} className="mr-3 whitespace-nowrap">
                    {k}: <strong>{v}</strong>
                </span>
            ))}
        </span>
    );
}

function Run({ run, label }: { run: RunView | null; label: string }) {
    if (!run) return <div className="text-sm text-foreground/50">{label}: never</div>;
    return (
        <div className="text-sm">
            <span className="text-foreground/60">{label}: </span>
            {new Date(run.startedAt).toLocaleString()} {run.ok ? "" : <span className="text-red-500">(failed: {run.error})</span>}
            <div>
                <Counts counts={run.counts} />
            </div>
        </div>
    );
}

export default function SheetsAdminClient() {
    const [data, setData] = useState<SheetsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [results, setResults] = useState<Record<string, Result>>({});

    const load = useCallback(() => {
        call<SheetsOverview>("/api/admin/sheets-import")
            .then(setData)
            .catch((e) => setError(e.message));
    }, []);
    useEffect(load, [load]);

    async function runImport(key: string, mode: "dry-run" | "apply") {
        if (mode === "apply" && !window.confirm(`Apply the ${key} import? This writes to the database (upserts only; nothing is deleted).`)) return;
        setBusy(`${key}:${mode}`);
        try {
            const report = await call<ImportReport>(`/api/admin/sheets-import/${key}`, { method: "POST", body: JSON.stringify({ mode }) });
            setResults((r) => ({ ...r, [key]: { kind: "report", report } }));
            load();
        } catch (e) {
            setResults((r) => ({ ...r, [key]: { kind: "error", message: (e as Error).message } }));
        } finally {
            setBusy(null);
        }
    }

    async function runParity(key: string) {
        setBusy(`${key}:parity`);
        try {
            const parity = await call<ParityReport>(`/api/admin/sheets-import/${key}/parity`);
            setResults((r) => ({ ...r, [key]: { kind: "parity", parity } }));
        } catch (e) {
            setResults((r) => ({ ...r, [key]: { kind: "error", message: (e as Error).message } }));
        } finally {
            setBusy(null);
        }
    }

    async function snapshot() {
        if (!window.confirm("Copy every tab of every sheet into the database archive?")) return;
        setBusy("snapshot");
        try {
            const r = await call<{ tabs: number; rows: number; failed: string[] }>("/api/admin/sheets-import/snapshot", { method: "POST", body: "{}" });
            window.alert(`Snapshot saved: ${r.tabs} tabs, ${r.rows} rows${r.failed.length ? `; could not read: ${r.failed.join(", ")}` : ""}`);
            load();
        } catch (e) {
            window.alert((e as Error).message);
        } finally {
            setBusy(null);
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-4 sm:p-6">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-2xl font-semibold mb-1">Google Sheets cutover</h1>
                <p className="text-foreground/60 mb-4 text-sm">
                    Import each data set (dry run first: it changes nothing and shows counts only), check parity, then switch its source to
                    &quot;db&quot; on <Link href="/admin/settings" className="underline">settings</Link> (area: Google Sheets cutover). Switching back to
                    &quot;sheet&quot; is the rollback.
                </p>
                {error && <p className="text-red-500">{error}</p>}
                {!data && !error && <p>Loading...</p>}
                {data && (
                    <>
                        <section className="mb-6">
                            <h2 className="text-lg font-semibold mb-2">Sources in force</h2>
                            <ul className="text-sm space-y-1">
                                {data.sources.map((s) => (
                                    <li key={s.key}>
                                        <strong>{s.label}</strong>: {s.effective} <span className="text-foreground/50">({s.reason}; env {s.env})</span>
                                    </li>
                                ))}
                                <li>
                                    <strong>Members copy to sheet</strong>: {data.membersMirror ? "on" : "off"}
                                </li>
                            </ul>
                        </section>

                        <section className="mb-6">
                            <h2 className="text-lg font-semibold mb-2">Imports</h2>
                            {data.datasets.length === 0 && <p className="text-sm text-foreground/60">No importers yet.</p>}
                            <div className="space-y-4">
                                {data.datasets.map((d) => {
                                    const res = results[d.key];
                                    return (
                                        <div key={d.key} className="border border-foreground/20 rounded p-3">
                                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                <h3 className="font-semibold">{d.label}</h3>
                                                <code className="text-xs text-foreground/50">{d.key}</code>
                                            </div>
                                            <p className="text-sm text-foreground/70 mb-2">{d.description}</p>
                                            <Run run={d.lastDryRun} label="Last dry run" />
                                            <Run run={d.lastApply} label="Last apply" />
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                <button className="px-3 py-2 border rounded text-sm" disabled={!!busy} onClick={() => runImport(d.key, "dry-run")}>
                                                    {busy === `${d.key}:dry-run` ? "Running..." : "Dry run"}
                                                </button>
                                                <button className="px-3 py-2 border rounded text-sm" disabled={!!busy} onClick={() => runImport(d.key, "apply")}>
                                                    {busy === `${d.key}:apply` ? "Applying..." : "Apply"}
                                                </button>
                                                {d.hasEditor && (
                                                    <Link className="px-3 py-2 border rounded text-sm" href={`/admin/sheets/edit/${d.key}`}>
                                                        Edit on the website
                                                    </Link>
                                                )}
                                                {d.hasParity && (
                                                    <button className="px-3 py-2 border rounded text-sm" disabled={!!busy} onClick={() => runParity(d.key)}>
                                                        {busy === `${d.key}:parity` ? "Checking..." : "Parity check"}
                                                    </button>
                                                )}
                                            </div>
                                            {res?.kind === "error" && <p className="text-red-500 text-sm mt-2">{res.message}</p>}
                                            {res?.kind === "report" && (
                                                <div className="text-sm mt-2">
                                                    {res.report.ok ? (res.report.applied ? "Applied. " : "No writes. ") : <span className="text-red-500">Failed: {res.report.error} </span>}
                                                    <Counts counts={{ ...res.report.counts, ...res.report.extra }} />
                                                    {res.report.issues.length > 0 && (
                                                        <details className="mt-1">
                                                            <summary>{res.report.issues.length + res.report.issuesTruncated} issues (row numbers)</summary>
                                                            <ul className="text-xs">
                                                                {res.report.issues.map((i, n) => (
                                                                    <li key={n}>
                                                                        {i.scope ? `${i.scope} ` : ""}row {i.row}: {i.code}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </details>
                                                    )}
                                                </div>
                                            )}
                                            {res?.kind === "parity" && (
                                                <div className="text-sm mt-2">
                                                    {res.parity.error ? <span className="text-red-500">{res.parity.error}</span> : null}
                                                    <Counts
                                                        counts={{
                                                            compared: res.parity.compared,
                                                            mismatches: res.parity.mismatches,
                                                            onlyInSheet: res.parity.onlyInSheet,
                                                            onlyInDb: res.parity.onlyInDb,
                                                            ...(res.parity.excluded ? { excluded: res.parity.excluded } : {}),
                                                            ...(res.parity.byScope ?? {}),
                                                        }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <section className="mb-6">
                            <h2 className="text-lg font-semibold mb-2">Archive</h2>
                            <p className="text-sm mb-2">
                                Last snapshot: {data.lastSnapshot ? `${new Date(data.lastSnapshot.takenAt).toLocaleString()} (${data.lastSnapshot.tabs} tabs)` : "never"}
                            </p>
                            <button className="px-3 py-2 border rounded text-sm mb-3" disabled={!!busy} onClick={snapshot}>
                                {busy === "snapshot" ? "Copying..." : "Snapshot every sheet"}
                            </button>
                            <ul className="text-sm space-y-1">
                                {data.archive.map((a) => (
                                    <li key={a.key}>
                                        <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                                            {a.key}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
