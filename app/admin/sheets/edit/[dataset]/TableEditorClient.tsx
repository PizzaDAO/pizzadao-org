"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CellValue, EditorColumn, EditorRow, SaveCounts } from "@/app/lib/sheets-import/editor";

interface Loaded {
    label: string;
    help: string;
    columns: EditorColumn[];
    maxRows: number;
    rows: EditorRow[];
    loadedAt?: string;
}

function blankRow(columns: EditorColumn[]): EditorRow {
    return Object.fromEntries(columns.map((c) => [c.key, c.kind === "bool" ? false : c.kind === "int" ? null : ""]));
}

export default function TableEditorClient({ dataset, apiUrl, backHref = "/admin/sheets", backLabel = "Back to sheets cutover" }: { dataset: string; apiUrl?: string; backHref?: string; backLabel?: string }) {
    const endpoint = apiUrl ?? `/api/admin/sheets-data/${encodeURIComponent(dataset)}`;
    const [data, setData] = useState<Loaded | null>(null);
    const [rows, setRows] = useState<EditorRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    async function load(): Promise<Loaded> {
        const res = await fetch(endpoint, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body as Loaded;
    }

    useEffect(() => {
        load()
            .then((d) => {
                setData(d);
                setRows(d.rows);
            })
            .catch((e) => setError(e.message));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint]);

    function setCell(i: number, key: string, value: CellValue) {
        setRows((rs) => rs.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
    }
    function move(i: number, by: number) {
        setRows((rs) => {
            const j = i + by;
            if (j < 0 || j >= rs.length) return rs;
            const next = [...rs];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    }

    async function save() {
        setSaving(true);
        setStatus(null);
        try {
            const res = await fetch(endpoint, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows, loadedAt: data?.loadedAt }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            const c = body.counts as SaveCounts;
            setStatus(`Saved: ${c.created} added, ${c.updated} changed, ${c.deactivated} removed, ${c.unchanged} unchanged.`);
            // Reload what was stored: new row ids, fresh revisions and load time, so the next save neither duplicates new rows nor conflicts with this one.
            try {
                const fresh = await load();
                setData(fresh);
                setRows(fresh.rows);
            } catch {
                setStatus((st) => `${st ?? ""} Reload the page before saving again.`);
            }
        } catch (e) {
            setStatus(`Not saved: ${(e as Error).message}`);
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
                <Link href={backHref} className="text-sm underline">
                    {backLabel}
                </Link>
                {error && <p className="text-red-500 mt-3">{error}</p>}
                {!data && !error && <p className="mt-3">Loading...</p>}
                {data && (
                    <>
                        <h1 className="text-2xl font-semibold mt-2">{data.label}</h1>
                        <p className="text-sm text-foreground/70 mb-3">{data.help}</p>
                        <div className="overflow-x-auto">
                            <table className="text-sm border-collapse">
                                <thead>
                                    <tr>
                                        <th className="p-1" />
                                        {data.columns.filter((c) => !c.hidden).map((c) => (
                                            <th key={c.key} className="text-left p-1 whitespace-nowrap">
                                                {c.label}
                                            </th>
                                        ))}
                                        <th className="p-1" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row, i) => (
                                        <tr key={i} className="border-t border-foreground/10">
                                            <td className="p-1 text-foreground/50">{i + 1}</td>
                                            {data.columns.filter((c) => !c.hidden).map((c) => (
                                                <td key={c.key} className="p-1">
                                                    {c.kind === "bool" ? (
                                                        <input type="checkbox" checked={row[c.key] === true} disabled={c.readOnly} onChange={(e) => setCell(i, c.key, e.target.checked)} />
                                                    ) : (
                                                        <input
                                                            className="border border-foreground/20 rounded px-2 py-1 bg-transparent min-w-[6rem]"
                                                            value={row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key])}
                                                            placeholder={c.placeholder}
                                                            readOnly={c.readOnly}
                                                            maxLength={c.maxLength}
                                                            onChange={(e) => setCell(i, c.key, e.target.value)}
                                                        />
                                                    )}
                                                </td>
                                            ))}
                                            <td className="p-1 whitespace-nowrap">
                                                <button className="px-2" aria-label="Move up" onClick={() => move(i, -1)}>
                                                    ↑
                                                </button>
                                                <button className="px-2" aria-label="Move down" onClick={() => move(i, 1)}>
                                                    ↓
                                                </button>
                                                <button className="px-2 text-red-500" onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}>
                                                    Remove
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                            <button
                                className="px-3 py-2 border rounded text-sm"
                                disabled={rows.length >= data.maxRows}
                                onClick={() => setRows((rs) => [...rs, blankRow(data.columns)])}
                            >
                                Add row
                            </button>
                            <button className="px-3 py-2 border rounded text-sm font-semibold" disabled={saving} onClick={save}>
                                {saving ? "Saving..." : "Save"}
                            </button>
                        </div>
                        {status && <p className="text-sm mt-2">{status}</p>}
                    </>
                )}
            </div>
        </main>
    );
}
